import ExpoModulesCore

/// iOS 版：刪除直接用 expo-media-library（本來就進「最近刪除」），這裡不需要垃圾桶。
/// 檔案大小沒有便宜又正式的 API（architecture §4.4），先回傳 nil，由 JS 依解析度估算。
public class PhotoActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoActions")

    Function("trashSupported") { () -> Bool in
      false
    }

    AsyncFunction("trash") { (_: [String]) -> Bool in
      throw Exception(name: "ERR_TRASH_UNSUPPORTED", description: "Use expo-media-library delete on iOS (Recently Deleted)")
    }

    AsyncFunction("fileSizes") { (ids: [String]) -> [Double?] in
      ids.map { _ in nil }
    }
  }
}
