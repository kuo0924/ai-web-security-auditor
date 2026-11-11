import 'dart:io';

import 'package:flutter/material.dart';

import '../app_store.dart';
import '../models.dart';
import '../system_trash.dart';
import 'swipe_screen.dart' show showSystemTrashResult;

/// App 垃圾桶。
///
/// 分兩區：
/// 1.「待移除」：右滑刪除後先放這裡，系統相簿裡照片還在，可以直接還原。
/// 2.「已在手機垃圾桶」：已經送到系統的垃圾桶；Android 11+ 可以從這裡救回，
///    iOS 要到「照片」App →「最近刪除」救回。
class TrashScreen extends StatefulWidget {
  const TrashScreen({super.key, required this.store});
  final AppStore store;

  @override
  State<TrashScreen> createState() => _TrashScreenState();
}

class _TrashScreenState extends State<TrashScreen> {
  final Set<String> _selected = {};
  bool _busy = false;
  bool _canRestoreSystem = false;

  AppStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    SystemTrash.canRestore().then((v) {
      if (mounted) setState(() => _canRestoreSystem = v);
    });
  }

  List<TrashItem> _pick(List<TrashItem> from) =>
      _selected.isEmpty ? from : from.where((t) => _selected.contains(t.id)).toList();

  Future<void> _run(Future<void> Function() job) async {
    setState(() => _busy = true);
    try {
      await job();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('操作失敗：$e')));
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _selected.clear();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final pending = store.pendingTrash;
        final inSystem = store.systemTrash;
        _selected.removeWhere((id) => !store.trash.any((t) => t.id == id));
        final selecting = _selected.isNotEmpty;

        return Scaffold(
          appBar: AppBar(
            title: Text(selecting ? '已選 ${_selected.length} 張' : '垃圾桶'),
            leading: selecting
                ? IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(_selected.clear),
                  )
                : null,
          ),
          body: Stack(
            children: [
              if (store.trash.isEmpty)
                const Center(child: Text('垃圾桶是空的'))
              else
                CustomScrollView(
                  slivers: [
                    if (pending.isNotEmpty) ...[
                      _header(
                        '待移除（${pending.length}）',
                        '照片還在手機相簿裡。按下方按鈕才會真的移到手機的垃圾桶。',
                      ),
                      _grid(pending),
                    ],
                    if (inSystem.isNotEmpty) ...[
                      _header(
                        '已在手機垃圾桶（${inSystem.length}）',
                        Platform.isIOS
                            ? '在「照片」App →「最近刪除」裡，30 天內可以救回。'
                            : _canRestoreSystem
                                ? '在系統相簿的「垃圾桶」裡，30 天後系統會自動清除。可以從這裡救回。'
                                : '這台手機沒有系統垃圾桶，這些照片已永久刪除。',
                      ),
                      _grid(inSystem),
                    ],
                    const SliverToBoxAdapter(child: SizedBox(height: 120)),
                  ],
                ),
              if (_busy)
                const ColoredBox(
                  color: Colors.black26,
                  child: Center(child: CircularProgressIndicator()),
                ),
            ],
          ),
          bottomNavigationBar: store.trash.isEmpty ? null : _bottomBar(pending, inSystem),
        );
      },
    );
  }

  Widget _bottomBar(List<TrashItem> pending, List<TrashItem> inSystem) {
    final selPending = _pick(pending);
    final selSystem = _selected.isEmpty
        ? <TrashItem>[]
        : inSystem.where((t) => _selected.contains(t.id)).toList();
    final restorableSystem = selSystem
        .where((t) => t.status == TrashStatus.inSystemTrash)
        .toList();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            if (selPending.isNotEmpty)
              OutlinedButton.icon(
                icon: const Icon(Icons.restore),
                label: Text('還原 ${selPending.length} 張'),
                onPressed: _busy ? null : () => _run(() => store.restorePending(selPending)),
              ),
            if (_canRestoreSystem && restorableSystem.isNotEmpty)
              OutlinedButton.icon(
                icon: const Icon(Icons.settings_backup_restore),
                label: Text('從手機垃圾桶救回 ${restorableSystem.length} 張'),
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          final n = await store.restoreFromSystemTrash(restorableSystem);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(n == 0 ? '已取消' : '已救回 $n 張')),
                            );
                          }
                        }),
              ),
            if (selSystem.isNotEmpty)
              TextButton(
                onPressed: _busy ? null : () => _run(() => store.forget(selSystem)),
                child: const Text('從清單移除'),
              ),
            if (selPending.isNotEmpty)
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Colors.red),
                icon: const Icon(Icons.delete_forever),
                label: Text('移到手機垃圾桶（${selPending.length}）'),
                onPressed: _busy ? null : () => _confirmMove(selPending),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmMove(List<TrashItem> items) async {
    final supported = await SystemTrash.isSupported();
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('移除 ${items.length} 張照片？'),
        content: Text(supported
            ? '照片會移到手機的垃圾桶（${Platform.isIOS ? '「照片」App 的「最近刪除」' : '系統相簿的「垃圾桶」'}），'
                '30 天內都還能救回。\n\n接下來系統會再跳一次確認視窗，請按「允許」。'
            : '這台手機的系統（Android 10 以下）沒有垃圾桶，照片會被「永久刪除」，無法救回！'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(supported ? '移過去' : '永久刪除'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      final r = await store.moveToSystemTrash(items);
      if (mounted) showSystemTrashResult(context, r);
    });
  }

  Widget _header(String title, String subtitle) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      );

  Widget _grid(List<TrashItem> items) => SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        sliver: SliverGrid.builder(
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
          ),
          itemCount: items.length,
          itemBuilder: (context, i) => _tile(items[i]),
        ),
      );

  Widget _tile(TrashItem t) {
    final selected = _selected.contains(t.id);
    final path = t.thumbPath;
    return GestureDetector(
      onTap: () => setState(() => selected ? _selected.remove(t.id) : _selected.add(t.id)),
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: path != null && File(path).existsSync()
                ? Image.file(File(path), fit: BoxFit.cover)
                : const ColoredBox(
                    color: Colors.black12,
                    child: Icon(Icons.image_not_supported_outlined),
                  ),
          ),
          if (t.status == TrashStatus.permanentlyDeleted)
            const Positioned(
              left: 4,
              bottom: 4,
              child: Icon(Icons.block, color: Colors.white, size: 18),
            ),
          if (selected)
            DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: Theme.of(context).colorScheme.primary, width: 3),
                color: Colors.black26,
              ),
              child: const Align(
                alignment: Alignment.topRight,
                child: Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.check_circle, color: Colors.white),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
