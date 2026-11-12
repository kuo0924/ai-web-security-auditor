import ExpoModulesCore
import Photos
import CoreLocation

/// iOS 版：刪除直接用 expo-media-library（本來就進「最近刪除」），這裡不需要垃圾桶。
/// 檔案大小沒有便宜又正式的 API（architecture §4.4），先回傳 nil，由 JS 依解析度估算。
public class PhotoActionsModule: Module {
  private let geocoder = CLGeocoder()

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

    /// 照片拍攝地點：PHAsset.location（不用讀檔案）
    AsyncFunction("locations") { (ids: [String]) -> [[String: Double]?] in
      let clean = ids.map { $0.hasPrefix("ph://") ? String($0.dropFirst(5)) : $0 }
      let fetched = PHAsset.fetchAssets(withLocalIdentifiers: clean, options: nil)
      var byId: [String: CLLocation] = [:]
      fetched.enumerateObjects { asset, _, _ in
        if let loc = asset.location { byId[asset.localIdentifier] = loc }
      }
      return clean.map { id in
        guard let c = byId[id]?.coordinate else { return nil }
        return ["latitude": c.latitude, "longitude": c.longitude]
      }
    }

    /// 座標 → 地名（CLGeocoder，不需要定位權限）。系統有頻率限制，JS 端會快取。
    AsyncFunction("placeName") { (latitude: Double, longitude: Double, promise: Promise) in
      self.geocoder.reverseGeocodeLocation(CLLocation(latitude: latitude, longitude: longitude)) { placemarks, _ in
        guard let p = placemarks?.first else {
          promise.resolve(nil)
          return
        }
        promise.resolve([
          "city": p.locality ?? p.subAdministrativeArea ?? p.administrativeArea,
          "district": p.subLocality,
          "region": p.administrativeArea,
          "country": p.country,
          "isoCountryCode": p.isoCountryCode,
        ])
      }
    }
  }
}
