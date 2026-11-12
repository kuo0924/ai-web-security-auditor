import { requireOptionalNativeModule } from 'expo';

type PhotoActionsNative = {
  /** Android 11+ 才有系統垃圾桶 */
  trashSupported(): boolean;
  /** MediaStore.createTrashRequest：一次確認一批。使用者按允許回傳 true，取消回傳 false */
  trash(uris: string[]): Promise<boolean>;
  /** 檔案大小（位元組）；拿不到就是 null */
  fileSizes(ids: string[]): Promise<(number | null)[]>;
  /** 照片拍攝地點（Android：content:// 網址；iOS：localIdentifier）；沒有就是 null */
  locations(ids: string[]): Promise<({ latitude: number; longitude: number } | null)[]>;
  /** 座標 → 地名（系統 Geocoder，不需要定位權限；可能需要網路） */
  placeName(latitude: number, longitude: number): Promise<PlaceName | null>;
};

export type PlaceName = {
  city: string | null;
  district: string | null;
  region: string | null;
  country: string | null;
  isoCountryCode: string | null;
};

/** web／測試環境沒有原生模組時是 null，呼叫端要處理。 */
export const PhotoActions = requireOptionalNativeModule<PhotoActionsNative>('PhotoActions');
