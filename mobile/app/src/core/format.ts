/** 1536 → "1.5 KB"；用 1024 進位，跟手機「設定 → 儲存空間」一致。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/**
 * 拿不到檔案大小時的估算（iOS 沒有便宜又正式的 API，見 architecture §4.4）。
 * 手機 HEIC／JPEG 大約每百萬像素 0.3 MB；沒有尺寸就當 3 MB。顯示時一律加「約」。
 */
export function estimateBytes(width: number | null, height: number | null, mediaType: 'image' | 'video'): number {
  if (mediaType === 'video') return 30 * 1024 * 1024;
  if (!width || !height) return 3 * 1024 * 1024;
  return Math.round(((width * height) / 1_000_000) * 0.3 * 1024 * 1024);
}

/** 本地時間的月份鍵，例如 '2024-03'；沒有拍攝時間就是 'unknown'。 */
export function sectionKey(createdAt: number | null): string {
  if (createdAt == null) return 'unknown';
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function sectionLabel(key: string): string {
  if (key === 'unknown') return '沒有日期';
  const [y, m] = key.split('-');
  return `${y} 年 ${Number(m)} 月`;
}
