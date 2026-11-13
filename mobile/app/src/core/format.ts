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
export function estimateBytes(
  width: number | null,
  height: number | null,
  mediaType: 'image' | 'video',
  durationMs?: number | null,
): number {
  if (mediaType === 'video') {
    if (!durationMs) return 30 * 1024 * 1024;
    // 手機錄影大約：1080p ≈ 2 MB/秒、4K ≈ 6～7 MB/秒（H.264/HEVC 平均值）。夾在 0.6～8 MB/秒之間
    const mp = width && height ? (width * height) / 1_000_000 : 2;
    const perSec = Math.min(8, Math.max(0.6, mp * 0.85)) * 1024 * 1024;
    return Math.round((durationMs / 1000) * perSec);
  }
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

/** 42000 → "0:42"；3723000 → "1:02:03" */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
