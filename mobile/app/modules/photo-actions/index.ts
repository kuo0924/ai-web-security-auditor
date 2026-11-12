import { requireOptionalNativeModule } from 'expo';

type PhotoActionsNative = {
  /** Android 11+ 才有系統垃圾桶 */
  trashSupported(): boolean;
  /** MediaStore.createTrashRequest：一次確認一批。使用者按允許回傳 true，取消回傳 false */
  trash(uris: string[]): Promise<boolean>;
  /** 檔案大小（位元組）；拿不到就是 null */
  fileSizes(ids: string[]): Promise<(number | null)[]>;
};

/** web／測試環境沒有原生模組時是 null，呼叫端要處理。 */
export const PhotoActions = requireOptionalNativeModule<PhotoActionsNative>('PhotoActions');
