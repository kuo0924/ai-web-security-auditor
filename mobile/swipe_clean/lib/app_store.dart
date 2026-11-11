import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';
import 'system_trash.dart';

/// App 的所有狀態：待整理的照片、已保存清單、App 垃圾桶。
class AppStore extends ChangeNotifier {
  static const _keptKey = 'kept_ids';
  static const _trashKey = 'trash_items';
  static const _pageSize = 60;

  late SharedPreferences _prefs;
  late Directory _thumbDir;

  final Set<String> keptIds = {};
  final List<TrashItem> trash = [];

  /// 還沒滑過的照片（最新的在前面）。
  final List<AssetEntity> queue = [];
  final List<SwipeRecord> _history = [];

  AssetPathEntity? _allPhotos;
  int _nextPage = 0;
  bool _noMorePages = false;
  bool _loadingMore = false;

  PermissionState? permission;
  bool loading = true;
  int totalPhotos = 0;

  /// 系統確認視窗會讓 App 暫停又回來；這段期間不要因為「回到前景」去重讀相簿。
  int _systemOps = 0;
  DateTime _lastSystemOpEnd = DateTime(2000);
  bool get inSystemOp =>
      _systemOps > 0 ||
      DateTime.now().difference(_lastSystemOpEnd) < const Duration(seconds: 3);

  bool _reloading = false;

  bool get canUndo => _history.isNotEmpty;
  List<TrashItem> get pendingTrash =>
      trash.where((t) => t.status == TrashStatus.pending).toList();
  List<TrashItem> get systemTrash =>
      trash.where((t) => t.status != TrashStatus.pending).toList();
  Set<String> get _trashIds => trash.map((t) => t.id).toSet();

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    final docs = await getApplicationDocumentsDirectory();
    _thumbDir = Directory('${docs.path}/trash_thumbs');
    if (!await _thumbDir.exists()) await _thumbDir.create(recursive: true);

    keptIds.addAll(_prefs.getStringList(_keptKey) ?? const []);
    final raw = _prefs.getString(_trashKey);
    if (raw != null) {
      final list = jsonDecode(raw) as List;
      trash.addAll(list.map((e) => TrashItem.fromJson(e as Map<String, dynamic>)));
    }
    await requestPermissionAndLoad();
  }

  Future<void> requestPermissionAndLoad() async {
    loading = true;
    notifyListeners();
    permission = await PhotoManager.requestPermissionExtend();
    if (permission!.hasAccess) {
      await reload();
    }
    loading = false;
    notifyListeners();
  }

  /// 重新從系統相簿讀取（例如使用者在系統相簿救回了照片）。
  Future<void> reload() async {
    if (_reloading) return;
    _reloading = true;
    try {
      await _reload();
    } finally {
      _reloading = false;
    }
  }

  Future<void> _reload() async {
    queue.clear();
    _history.clear();
    _nextPage = 0;
    _noMorePages = false;
    final paths = await PhotoManager.getAssetPathList(
      type: RequestType.image,
      onlyAll: true,
    );
    _allPhotos = paths.isEmpty ? null : paths.first;
    totalPhotos = _allPhotos == null ? 0 : await _allPhotos!.assetCountAsync;
    await _syncTrashWithLibrary();
    await _loadMore();
  }

  /// 預先多載一些，保持佇列裡至少有幾張。
  Future<void> ensureQueue() async {
    if (queue.length < 10) await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_allPhotos == null || _noMorePages || _loadingMore) return;
    _loadingMore = true;
    try {
      final skip = {...keptIds, ..._trashIds};
      // 一頁可能全部都已整理過，就繼續往下翻，直到找到新的照片。
      while (queue.length < 10 && !_noMorePages) {
        final page = await _allPhotos!.getAssetListPaged(
          page: _nextPage++,
          size: _pageSize,
        );
        if (page.length < _pageSize) _noMorePages = true;
        final queued = queue.map((a) => a.id).toSet();
        queue.addAll(page.where((a) => !skip.contains(a.id) && !queued.contains(a.id)));
      }
    } finally {
      _loadingMore = false;
    }
    notifyListeners();
  }

  // ───────────────────────── 滑動 ─────────────────────────

  /// 左滑：保存。
  Future<void> keep(AssetEntity asset) async {
    queue.remove(asset);
    keptIds.add(asset.id);
    _history.add(SwipeRecord(asset.id, SwipeAction.keep));
    _pushHistoryCap();
    notifyListeners();
    await _saveKept();
    await ensureQueue();
  }

  /// 右滑：刪除 → 先進 App 垃圾桶。
  Future<void> delete(AssetEntity asset) async {
    queue.remove(asset);
    _history.add(SwipeRecord(asset.id, SwipeAction.delete));
    _pushHistoryCap();
    final item = TrashItem(
      id: asset.id,
      typeInt: asset.typeInt,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createDateTime,
      deletedAt: DateTime.now(),
    );
    trash.insert(0, item);
    notifyListeners();
    // 先存一份縮圖：送進系統垃圾桶後，Android 就讀不到原圖了。
    item.thumbPath = await _cacheThumb(asset);
    if (!trash.contains(item)) await _deleteThumb(item); // 期間被復原了
    notifyListeners();
    await _saveTrash();
    await ensureQueue();
  }

  /// 復原上一次滑動，把照片放回最上面。
  Future<void> undo() async {
    if (_history.isEmpty) return;
    final last = _history.removeLast();
    if (last.action == SwipeAction.keep) {
      keptIds.remove(last.assetId);
      await _saveKept();
    } else {
      final idx = trash.indexWhere((t) => t.id == last.assetId);
      if (idx < 0 || trash[idx].status != TrashStatus.pending) {
        // 已經送進系統垃圾桶了，不能在這裡復原，改到垃圾桶頁還原。
        notifyListeners();
        return;
      }
      await _deleteThumb(trash.removeAt(idx));
      await _saveTrash();
    }
    final asset = await AssetEntity.fromId(last.assetId);
    if (asset != null) queue.insert(0, asset);
    notifyListeners();
  }

  void _pushHistoryCap() {
    if (_history.length > 50) _history.removeAt(0);
  }

  // ───────────────────────── App 垃圾桶 ─────────────────────────

  /// 從 App 垃圾桶還原「還沒送去系統垃圾桶」的照片：放回待整理。
  Future<void> restorePending(List<TrashItem> items) async {
    for (final item in items) {
      trash.remove(item);
      await _deleteThumb(item);
      _history.removeWhere((h) => h.assetId == item.id);
      final asset = await AssetEntity.fromId(item.id);
      if (asset != null) queue.insert(0, asset);
    }
    notifyListeners();
    await _saveTrash();
  }

  /// 把 App 垃圾桶裡的照片一起送到系統垃圾桶（系統只會跳一次確認）。
  /// 回傳成功移過去的數量。
  Future<SystemTrashOutcome> moveToSystemTrash(List<TrashItem> items) async {
    final targets = items.where((t) => t.status == TrashStatus.pending).toList();
    final assets = <AssetEntity>[];
    final missing = <TrashItem>[];
    for (final t in targets) {
      final a = await AssetEntity.fromId(t.id);
      if (a == null) {
        missing.add(t); // 使用者可能已經在系統相簿刪掉了
      } else {
        assets.add(a);
      }
    }
    for (final t in missing) {
      t.status = TrashStatus.inSystemTrash;
    }

    final SystemTrashResult result;
    _systemOps++;
    try {
      result = await SystemTrash.moveToTrash(assets);
    } finally {
      _systemOps--;
      _lastSystemOpEnd = DateTime.now();
    }
    final done = result.ids.toSet();
    for (final t in targets) {
      if (done.contains(t.id)) {
        t.status = result.permanent
            ? TrashStatus.permanentlyDeleted
            : TrashStatus.inSystemTrash;
      }
    }
    _history.removeWhere((h) => done.contains(h.assetId));
    notifyListeners();
    await _saveTrash();
    return SystemTrashOutcome(
      moved: done.length,
      requested: assets.length,
      permanent: result.permanent,
    );
  }

  /// Android 11+：從系統垃圾桶救回，照片回到相簿，並放回待整理。
  Future<int> restoreFromSystemTrash(List<TrashItem> items) async {
    final targets =
        items.where((t) => t.status == TrashStatus.inSystemTrash).toList();
    final List<String> restored;
    _systemOps++;
    try {
      restored = await SystemTrash.restore(targets
          .map((t) => AssetEntity(
                id: t.id,
                typeInt: t.typeInt,
                width: t.width,
                height: t.height,
              ))
          .toList());
    } finally {
      _systemOps--;
      _lastSystemOpEnd = DateTime.now();
    }
    final ok = restored.toSet();
    for (final t in targets.where((t) => ok.contains(t.id)).toList()) {
      trash.remove(t);
      await _deleteThumb(t);
      final asset = await AssetEntity.fromId(t.id);
      if (asset != null) queue.insert(0, asset);
    }
    notifyListeners();
    await _saveTrash();
    return ok.length;
  }

  /// 只刪掉 App 裡的紀錄（不影響系統相簿）。
  Future<void> forget(List<TrashItem> items) async {
    for (final t in items) {
      trash.remove(t);
      await _deleteThumb(t);
    }
    notifyListeners();
    await _saveTrash();
  }

  /// 系統垃圾桶裡的照片若已被系統清掉、或使用者在相簿 App 救回了，
  /// 同步更新 App 垃圾桶。
  Future<void> _syncTrashWithLibrary() async {
    var changed = false;
    // 系統垃圾桶 30 天後會自動清空，App 裡的紀錄放 40 天就清掉。
    final expire = DateTime.now().subtract(const Duration(days: 40));
    for (final t in trash
        .where((t) => t.status != TrashStatus.pending && t.deletedAt.isBefore(expire))
        .toList()) {
      trash.remove(t);
      await _deleteThumb(t);
      changed = true;
    }
    for (final t in trash.where((t) => t.status == TrashStatus.inSystemTrash).toList()) {
      // 一般查詢查得到 → 代表已經被救回相簿
      final a = await AssetEntity.fromId(t.id);
      if (a != null && !a.isTrashed) {
        trash.remove(t);
        await _deleteThumb(t);
        changed = true;
      }
    }
    if (changed) await _saveTrash();
  }

  // ───────────────────────── 已保存 ─────────────────────────

  Future<void> unkeep(String id) async {
    keptIds.remove(id);
    _history.removeWhere((h) => h.assetId == id);
    final asset = await AssetEntity.fromId(id);
    if (asset != null) queue.insert(0, asset);
    notifyListeners();
    await _saveKept();
  }

  Future<void> resetKept() async {
    keptIds.clear();
    await _saveKept();
    await reload();
  }

  // ───────────────────────── 儲存 ─────────────────────────

  Future<String?> _cacheThumb(AssetEntity asset) async {
    try {
      final bytes = await asset.thumbnailDataWithSize(
        const ThumbnailSize.square(300),
        quality: 80,
      );
      if (bytes == null) return null;
      final safeId = asset.id.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
      final file = File('${_thumbDir.path}/$safeId.jpg');
      await file.writeAsBytes(bytes, flush: true);
      return file.path;
    } catch (e) {
      debugPrint('cache thumb failed: $e');
      return null;
    }
  }

  Future<void> _deleteThumb(TrashItem item) async {
    final p = item.thumbPath;
    if (p == null) return;
    try {
      final f = File(p);
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  Future<void> _saveKept() => _prefs.setStringList(_keptKey, keptIds.toList());

  Future<void> _saveTrash() => _prefs.setString(
        _trashKey,
        jsonEncode(trash.map((t) => t.toJson()).toList()),
      );
}

class SystemTrashOutcome {
  SystemTrashOutcome({
    required this.moved,
    required this.requested,
    required this.permanent,
  });
  final int moved;
  final int requested;
  final bool permanent;
}
