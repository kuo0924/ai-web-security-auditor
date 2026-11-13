import type { DeckFilter, Photo, PhotoAccess, TrashMethod, TrashOutcome } from '../core/types';
import type { Place } from '../core/photoMeta';

/**
 * 相簿操作的介面。正式版是 nativeLibrary（expo-media-library＋photo-actions 模組），
 * web 預覽和測試用 fakeLibrary。換實作不需要改任何畫面程式碼。
 */
export interface PhotoLibrary {
  /** 只檢查，不跳視窗 */
  check(): Promise<PhotoAccess>;
  /** 會跳系統權限視窗（只在第一次或使用者按「允許」時） */
  request(): Promise<PhotoAccess>;
  pickMore(): Promise<void>;
  openSettings(): Promise<void>;
  /** offset／limit 分頁。all：照片＋影片，新到舊；videos：只有影片，最長的先 */
  page(offset: number, limit: number, filter?: DeckFilter): Promise<Photo[]>;
  /** 回傳其中「還在相簿裡」的 ID（刪除後對帳用） */
  stillPresent(ids: string[]): Promise<Set<string>>;
  /** 檔案大小；拿不到就是 null（由呼叫端估算） */
  fileSizes(ids: string[]): Promise<Record<string, number | null>>;
  /** 移到系統垃圾桶／最近刪除。一次一批，系統只確認一次 */
  moveToTrash(ids: string[]): Promise<TrashOutcome>;
  /** 給 expo-image 顯示用的網址 */
  uriFor(id: string): string;
  /** 拍攝地點（GPS）；沒有就是 null */
  locations(ids: string[]): Promise<({ latitude: number; longitude: number } | null)[]>;
  /** 座標 → 地名（系統 Geocoder）；查不到就是 null */
  placeName(latitude: number, longitude: number): Promise<Place | null>;
  /** 這台手機會用哪種方式刪除（決定能不能救回、資料庫怎麼記） */
  trashMethod(): TrashMethod;
  /** 這台手機刪掉的照片能不能在 30 天內救回 */
  trashIsRecoverable(): boolean;
}
