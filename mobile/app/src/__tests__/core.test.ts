import { append, decide, initialDeck, prefetchTargets, resolveSwipe, undo, HISTORY_LIMIT } from '../core/deck';
import { estimateBytes, formatBytes, sectionKey, sectionLabel } from '../core/format';
import { photoAccessFrom } from '../core/photoAccess';
import { makeSeedPhotos } from '../media/fakeLibrary';

const photos = makeSeedPhotos(5);
const size = { width: 400, height: 800 };
const cfg = { horizontal: 0.28, up: 0.22 };

describe('resolveSwipe：右保留、左刪除、上隱藏', () => {
  test('往右拖過 28% → 保留', () => expect(resolveSwipe({ dx: 120, dy: 0, vx: 0, vy: 0 }, size, cfg)).toBe('keep'));
  test('往左拖過 28% → 刪除', () => expect(resolveSwipe({ dx: -120, dy: 10, vx: 0, vy: 0 }, size, cfg)).toBe('delete'));
  test('往上拖過 22% 高度 → 隱藏', () => expect(resolveSwipe({ dx: 10, dy: -200, vx: 0, vy: 0 }, size, cfg)).toBe('hide'));
  test('沒過門檻 → 彈回', () => expect(resolveSwipe({ dx: 60, dy: -80, vx: 100, vy: -100 }, size, cfg)).toBeNull());
  test('快速甩動也算', () => {
    expect(resolveSwipe({ dx: 30, dy: 0, vx: 1200, vy: 0 }, size, cfg)).toBe('keep');
    expect(resolveSwipe({ dx: -30, dy: 0, vx: -1200, vy: 0 }, size, cfg)).toBe('delete');
    expect(resolveSwipe({ dx: 0, dy: -40, vx: 0, vy: -1500 }, size, cfg)).toBe('hide');
  });
  test('斜著往上（角度太大）不算隱藏，避免誤觸', () => {
    // 向右 150、向上 190：角度約 38° > 35°，應判成保留
    expect(resolveSwipe({ dx: 150, dy: -190, vx: 0, vy: 0 }, size, cfg)).toBe('keep');
  });
  test('往下拖不會隱藏', () => expect(resolveSwipe({ dx: 0, dy: 300, vx: 0, vy: 2000 }, size, cfg)).toBeNull());
});

describe('deck', () => {
  test('決定後換下一張，復原會放回最前面', () => {
    let s = initialDeck(photos);
    s = decide(s, 'delete');
    s = decide(s, 'keep');
    expect(s.queue[0].id).toBe(photos[2].id);
    expect(s.counts).toEqual({ keep: 1, delete: 1, hide: 0 });
    const u = undo(s);
    expect(u.undone?.decision).toBe('keep');
    expect(u.state.queue[0].id).toBe(photos[1].id);
    expect(u.state.counts.keep).toBe(0);
  });
  test('空牌堆時決定、復原都不會出錯', () => {
    const s = initialDeck([]);
    expect(decide(s, 'keep')).toBe(s);
    expect(undo(s).undone).toBeUndefined();
  });
  test('復原紀錄最多保留 50 筆', () => {
    let s = initialDeck(makeSeedPhotos(80));
    for (let i = 0; i < 80; i++) s = decide(s, 'keep');
    expect(s.history).toHaveLength(HISTORY_LIMIT);
  });
  test('append 跳過已決定與已在佇列的照片', () => {
    const s = append(initialDeck([photos[0]]), photos, new Set([photos[1].id]));
    expect(s.queue.map((p) => p.id)).toEqual([photos[0], photos[2], photos[3], photos[4]].map((p) => p.id));
  });
});

describe('format', () => {
  test('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB');
  });
  test('estimateBytes：1200 萬像素約 3.4 MB；沒有尺寸當 3 MB', () => {
    expect(estimateBytes(3024, 4032, 'image')).toBeGreaterThan(3 * 1024 ** 2);
    expect(estimateBytes(null, null, 'image')).toBe(3 * 1024 ** 2);
  });
  test('sectionKey／sectionLabel', () => {
    expect(sectionKey(new Date(2024, 2, 5).getTime())).toBe('2024-03');
    expect(sectionKey(null)).toBe('unknown');
    expect(sectionLabel('2024-03')).toBe('2024 年 3 月');
  });
});

describe('photoAccessFrom：只分三種', () => {
  test('all → full', () => expect(photoAccessFrom({ granted: true, accessPrivileges: 'all' })).toBe('full'));
  test('limited → partial', () => expect(photoAccessFrom({ granted: true, accessPrivileges: 'limited' })).toBe('partial'));
  test('沒授權 → denied', () => expect(photoAccessFrom({ granted: false, accessPrivileges: 'none' })).toBe('denied'));
  test('status 字串也認得', () => expect(photoAccessFrom({ status: 'granted' })).toBe('full'));
});

describe('prefetchTargets', () => {
  test('目前這張之後的 5 張', () => {
    const ps = makeSeedPhotos(10);
    expect(prefetchTargets(ps)).toEqual(ps.slice(1, 6).map((p) => p.uri));
    expect(prefetchTargets(ps.slice(0, 2))).toEqual([ps[1].uri]);
    expect(prefetchTargets([])).toEqual([]);
  });
});

import { deviceCountry, formatPlace, formatShotDate, placeKey } from '../core/photoMeta';
import { PlaceService } from '../media/places';

describe('拍攝日期／地點', () => {
  test('日期與上午／下午時間', () => {
    expect(formatShotDate(new Date(2025, 10, 17, 11, 12).getTime())).toEqual({ date: '2025年11月17日', time: '上午 11:12' });
    expect(formatShotDate(new Date(2025, 0, 2, 0, 5).getTime()).time).toBe('上午 12:05');
    expect(formatShotDate(new Date(2025, 0, 2, 12, 0).getTime()).time).toBe('下午 12:00');
    expect(formatShotDate(new Date(2025, 0, 2, 19, 23).getTime()).time).toBe('下午 7:23');
    expect(formatShotDate(null)).toEqual({ date: '沒有拍攝日期', time: '' });
  });
  const tp = { city: '台北市', district: '大安區', region: '台北市', country: '台灣', isoCountryCode: 'TW' };
  test('國內只顯示城市＋區；國外加國家', () => {
    expect(formatPlace(tp, 'TW')).toBe('台北市 大安區');
    expect(formatPlace({ city: '京都市', district: null, region: '京都府', country: '日本', isoCountryCode: 'JP' }, 'TW')).toBe('京都市 · 日本');
    expect(formatPlace({ ...tp, district: null }, 'TW')).toBe('台北市');
    expect(formatPlace({ city: null, district: null, region: null, country: '冰島', isoCountryCode: 'IS' }, 'TW')).toBe('冰島');
    expect(formatPlace(null, 'TW')).toBeNull();
  });
  test('placeKey 約 1 公里內視為同一地點', () => {
    expect(placeKey(25.0331, 121.5612)).toBe(placeKey(25.0349, 121.5649));
    expect(placeKey(25.03, 121.56)).not.toBe(placeKey(25.05, 121.56));
  });
  test('deviceCountry 不會丟錯', () => {
    expect(() => deviceCountry()).not.toThrow();
  });
  test('PlaceService：同一地點只查一次、同時間一次一個、沒有 GPS 回 null', async () => {
    let calls = 0;
    let inflight = 0;
    let maxInflight = 0;
    const svc = new PlaceService(
      {
        locations: async (ids) => ids.map((id) => (id === 'nogps' ? null : { latitude: 25.033 + (id === 'b' ? 0.001 : 0), longitude: 121.565 })),
        placeName: async () => {
          calls++;
          maxInflight = Math.max(maxInflight, ++inflight);
          await new Promise((r) => setTimeout(r, 5));
          inflight--;
          return tp;
        },
      },
      'TW',
    );
    const [a, b, n] = await Promise.all([svc.label('a'), svc.label('b'), svc.label('nogps')]);
    expect(a).toBe('台北市 大安區');
    expect(b).toBe('台北市 大安區');
    expect(n).toBeNull();
    expect(calls).toBe(1);
    expect(maxInflight).toBe(1);
  });
  test('PlaceService：查詢失敗回 null，不會丟錯', async () => {
    const svc = new PlaceService({ locations: async () => [{ latitude: 1, longitude: 1 }], placeName: async () => { throw new Error('offline'); } }, 'TW');
    await expect(svc.label('x')).resolves.toBeNull();
  });
});
