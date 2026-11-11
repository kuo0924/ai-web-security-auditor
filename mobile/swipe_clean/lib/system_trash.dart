import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:photo_manager/photo_manager.dart';

/// 和手機系統相簿垃圾桶打交道的地方。
///
/// - iOS：`deleteWithIds` 會把照片放進「最近刪除」（30 天內可在「照片」App 救回）。
///   系統一定會跳一次確認視窗，App 無法略過。
/// - Android 11+：用 MediaStore 的垃圾桶（`moveToTrash`），系統相簿 App 的「垃圾桶」看得到，
///   30 天後系統自動清除。也可以用 [restore] 從 App 裡救回來。
/// - Android 10 以下：系統沒有垃圾桶，只能永久刪除。
class SystemTrash {
  static int? _sdkInt;

  static Future<int> androidSdk() async {
    if (!Platform.isAndroid) return 0;
    return _sdkInt ??= (await DeviceInfoPlugin().androidInfo).version.sdkInt;
  }

  /// 這台手機有沒有系統垃圾桶。
  static Future<bool> isSupported() async {
    if (Platform.isIOS) return true;
    return await androidSdk() >= 30;
  }

  /// 這台手機能不能從 App 直接還原系統垃圾桶裡的照片。
  static Future<bool> canRestore() async {
    if (!Platform.isAndroid) return false; // iOS 只能到「照片」App 的「最近刪除」還原
    return await androidSdk() >= 30;
  }

  /// 把照片移到系統垃圾桶。回傳真的成功移過去（使用者有按允許）的 id。
  static Future<SystemTrashResult> moveToTrash(List<AssetEntity> assets) async {
    if (assets.isEmpty) return const SystemTrashResult([], permanent: false);
    if (Platform.isAndroid) {
      if (await androidSdk() >= 30) {
        final ids = await PhotoManager.editor.android.moveToTrash(assets);
        return SystemTrashResult(ids, permanent: false);
      }
      final ids = await PhotoManager.editor.deleteWithIds(
        assets.map((a) => a.id).toList(),
      );
      return SystemTrashResult(ids, permanent: true);
    }
    // iOS / macOS：進「最近刪除」
    final ids = await PhotoManager.editor.deleteWithIds(
      assets.map((a) => a.id).toList(),
    );
    return SystemTrashResult(ids, permanent: false);
  }

  /// 從 Android 系統垃圾桶救回。只用 id 與類型就能還原，不需要原本的物件。
  static Future<List<String>> restore(List<AssetEntity> assets) async {
    if (!await canRestore() || assets.isEmpty) return [];
    return PhotoManager.editor.android.restoreFromTrash(assets);
  }
}

class SystemTrashResult {
  const SystemTrashResult(this.ids, {required this.permanent});
  final List<String> ids;

  /// true 代表是永久刪除（舊版 Android），不是進垃圾桶。
  final bool permanent;
}
