import 'package:photo_manager/photo_manager.dart';

/// 相簿權限只分三種，整個 App 都用這個判斷，不要各畫面自己看系統的原始狀態。
enum PhotoAccess {
  /// 可以讀全部照片。
  full,

  /// 只能讀使用者挑過的照片（Android 14+「只允許部分照片」、iOS「有限存取」）。
  partial,

  /// 不能讀（拒絕、受限制、還沒問過）。
  denied,
}

/// 把 photo_manager 的權限狀態轉成三種之一。
PhotoAccess photoAccessFrom(PermissionState state) {
  switch (state) {
    case PermissionState.authorized:
      return PhotoAccess.full;
    case PermissionState.limited:
      return PhotoAccess.partial;
    case PermissionState.denied:
    case PermissionState.restricted:
    case PermissionState.notDetermined:
      return PhotoAccess.denied;
  }
}

/// 請求／檢查權限時用的選項：**只要照片**。
///
/// photo_manager 預設是 [RequestType.common]（照片＋影片）。我們的 AndroidManifest
/// 只宣告 READ_MEDIA_IMAGES，影片權限永遠拿不到，photo_manager 合併兩者時就會
/// 一直回報「部分存取」，即使使用者在設定裡選了「一律允許全部」（BUG-001）。
/// 之後要支援影片，記得同時在 manifest 加 READ_MEDIA_VIDEO 並改這裡。
const PermissionRequestOption photoPermissionOption = PermissionRequestOption(
  androidPermission: AndroidPermission(type: RequestType.image, mediaLocation: false),
);

/// 權限操作。測試時換成假的，正式版用 [PhotoManagerPermissions]。
abstract class PhotoPermissions {
  /// 只檢查目前狀態，不跳任何視窗。
  Future<PhotoAccess> check();

  /// 請求權限（第一次會跳系統視窗）。
  Future<PhotoAccess> request();

  /// 開系統的照片選擇器，讓使用者多選幾張（只在部分存取時有意義）。
  Future<void> pickMore();

  /// 開這個 App 的系統設定頁，讓使用者改成「允許全部」。
  Future<void> openSettings();
}

class PhotoManagerPermissions implements PhotoPermissions {
  const PhotoManagerPermissions();

  @override
  Future<PhotoAccess> check() async => photoAccessFrom(
        await PhotoManager.getPermissionState(requestOption: photoPermissionOption),
      );

  @override
  Future<PhotoAccess> request() async => photoAccessFrom(
        await PhotoManager.requestPermissionExtend(requestOption: photoPermissionOption),
      );

  @override
  Future<void> pickMore() => PhotoManager.presentLimited(type: RequestType.image);

  @override
  Future<void> openSettings() => PhotoManager.openSetting();
}
