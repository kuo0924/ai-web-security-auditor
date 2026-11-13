/** 卡片上方的拍攝日期／時間／地點（放在上方中間） */

export function formatShotDate(ms: number | null): { date: string; time: string } {
  if (ms == null) return { date: '沒有拍攝日期', time: '' };
  const d = new Date(ms);
  const h = d.getHours();
  const period = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    time: `${period} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

export type Place = {
  city: string | null;
  district: string | null;
  region: string | null;
  country: string | null;
  isoCountryCode: string | null;
};

/** 例如「台北市 大安區」；在國外加國家「京都市 · 日本」 */
export function formatPlace(p: Place | null, homeCountry: string | null): string | null {
  if (!p) return null;
  const local = [p.city ?? p.region, p.district && p.district !== p.city ? p.district : null].filter(Boolean).join(' ');
  const abroad = p.isoCountryCode && homeCountry && p.isoCountryCode.toUpperCase() !== homeCountry.toUpperCase();
  if (!local) return p.country ?? null;
  return abroad && p.country ? `${local} · ${p.country}` : local;
}

/** 快取用的鍵：四捨五入到小數 2 位（約 1 公里），同一個地方拍的照片只查一次 */
export function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** 裝置地區（例如 zh-TW → TW），用來判斷照片是不是在國外拍的 */
export function deviceCountry(): string | null {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale; // e.g. "zh-TW"
    const m = /[-_]([A-Z]{2})\b/.exec(loc);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
