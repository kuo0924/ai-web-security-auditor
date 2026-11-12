import type { Photo, PhotoAccess, TrashOutcome } from '../core/types';
import type { PhotoLibrary } from './library';

/** 假相簿：web 預覽與測試用。照片用 picsum 以外的「本機產生色塊」，不連任何外部網站。 */
/**
 * bursts = true：每 5 張的前 3 張是 20 秒內拍的連拍（給相似照片功能預覽／測試）。
 */
export function makeSeedPhotos(n = 36, start = Date.UTC(2024, 2, 28, 10), opts: { bursts?: boolean } = {}): Photo[] {
  const hues = [12, 32, 48, 140, 170, 200, 220, 260, 290, 330];
  return Array.from({ length: n }, (_, i) => {
    const base = opts.bursts && i % 5 < 3 ? i - (i % 5) : i; // 連拍的照片看起來要像
    const hue = hues[base % hues.length];
    const label = encodeURIComponent(`#${i + 1}`);
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='hsl(${hue},70%25,62%25)'/><stop offset='1' stop-color='hsl(${(hue + 40) % 360},60%25,35%25)'/>` +
      `</linearGradient></defs><rect width='900' height='1200' fill='url(%23g)'/>` +
      `<circle cx='${300 + ((base * 37) % 300) + (i - base) * 18}' cy='${420 + ((base * 53) % 300)}' r='170' fill='rgba(255,255,255,.25)'/>` +
      `<text x='60' y='1130' font-size='72' font-family='sans-serif' fill='white'>${label}</text></svg>`;
    return {
      id: `fake-${i + 1}`,
      uri: `data:image/svg+xml;utf8,${svg}`,
      width: 3024,
      height: 4032,
      createdAt: opts.bursts && i % 5 < 3 ? start - Math.floor(i / 5) * 5 * 9 * 3600 * 1000 - (i % 5) * 20_000 : start - i * 9 * 3600 * 1000,
      mediaType: 'image',
    };
  });
}

const FAKE_SPOTS = [
  { lat: 25.03, lng: 121.56, place: { city: '台北市', district: '大安區', region: '台北市', country: '台灣', isoCountryCode: 'TW' } },
  { lat: 22.62, lng: 120.3, place: { city: '高雄市', district: '鹽埕區', region: '高雄市', country: '台灣', isoCountryCode: 'TW' } },
  { lat: 35.01, lng: 135.77, place: { city: '京都市', district: null, region: '京都府', country: '日本', isoCountryCode: 'JP' } },
  { lat: 24.15, lng: 120.67, place: { city: '台中市', district: '西區', region: '台中市', country: '台灣', isoCountryCode: 'TW' } },
];
const seedCache = new Map<string, string>();
function seedUri(id: string): string {
  if (!seedCache.size) for (const p of makeSeedPhotos(200)) seedCache.set(p.id, p.uri);
  return seedCache.get(id) ?? '';
}

export function fakeLibrary(opts: { photos?: Photo[]; access?: PhotoAccess; cancelTrash?: boolean } = {}): PhotoLibrary & {
  state: { access: PhotoAccess; photos: Photo[]; trashCalls: string[][]; cancelTrash: boolean };
} {
  const state = {
    access: opts.access ?? 'full',
    photos: opts.photos ?? makeSeedPhotos(),
    trashCalls: [] as string[][],
    cancelTrash: opts.cancelTrash ?? false,
  };
  return {
    state,
    check: async () => state.access,
    request: async () => state.access,
    pickMore: async () => {},
    openSettings: async () => {},
    page: async (offset, limit) => (state.access === 'denied' ? [] : state.photos.slice(offset, offset + limit)),
    stillPresent: async (ids) => new Set(ids.filter((id) => state.photos.some((p) => p.id === id))),
    fileSizes: async (ids) => Object.fromEntries(ids.map((id) => [id, 2_400_000])),
    moveToTrash: async (ids): Promise<TrashOutcome> => {
      state.trashCalls.push(ids);
      if (state.cancelTrash) return { status: 'cancelled', method: 'android_trash', removedIds: [] };
      state.photos = state.photos.filter((p) => !ids.includes(p.id));
      return { status: 'confirmed', method: 'android_trash', removedIds: ids };
    },
    uriFor: (id) => state.photos.find((p) => p.id === id)?.uri ?? seedUri(id),
    // 假地點：每 5 張換一個地方，第 4 張沒有 GPS（測試「沒有地點」的顯示）
    locations: async (ids) =>
      ids.map((id) => {
        const i = Number(id.replace(/^fake-/, '')) - 1;
        if (!(i >= 0) || i % 5 === 3) return null;
        const spot = FAKE_SPOTS[Math.floor(i / 5) % FAKE_SPOTS.length];
        return { latitude: spot.lat, longitude: spot.lng };
      }),
    placeName: async (lat, lng) => FAKE_SPOTS.find((s) => s.lat === lat && s.lng === lng)?.place ?? null,
    trashMethod: () => 'android_trash',
    trashIsRecoverable: () => true,
  };
}
