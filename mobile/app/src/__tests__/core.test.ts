import { append, decide, initialDeck, resolveSwipe, undo, HISTORY_LIMIT } from '../core/deck';
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
