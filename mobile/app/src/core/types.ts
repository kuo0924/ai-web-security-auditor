export type PhotoAccess = 'full' | 'partial' | 'denied';
export type Decision = 'keep' | 'delete' | 'hide';

export type Photo = {
  /** Android：content:// 網址；iOS：PHAsset localIdentifier */
  id: string;
  /** 給 expo-image 顯示用的網址 */
  uri: string;
  width: number | null;
  height: number | null;
  createdAt: number | null;
  mediaType: 'image' | 'video';
  /** 影片長度（毫秒）；照片是 null。expo-media-library 兩個平台回傳的都是毫秒（JSDoc 寫秒是錯的） */
  durationMs?: number | null;
};

/** 滑動牌堆要看什麼：全部（新到舊），或只看影片（最長的先，通常也最佔空間） */
export type DeckFilter = 'all' | 'videos';

export type TrashMethod = 'ios_recently_deleted' | 'android_trash' | 'android_delete' | 'android_legacy_delete';

export type TrashOutcome = {
  status: 'confirmed' | 'cancelled' | 'failed';
  method: TrashMethod;
  /** 確定已離開相簿的 ID（依「刪除後再查一次還在不在」判斷） */
  removedIds: string[];
  error?: string;
};
