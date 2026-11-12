import { DEFAULT_GROUPING, groupSimilar, pickBest, type HashedPhoto } from '../similar/group';
import { dhash, hamming, phash, toGray } from '../similar/hash';
import { scene } from '../similar/scenes';

describe('pHash／dHash', () => {
  test('同一張圖雜湊相同', () => {
    expect(phash(scene({ seed: 3 }))).toBe(phash(scene({ seed: 3 })));
    expect(dhash(scene({ seed: 3 }))).toBe(dhash(scene({ seed: 3 })));
    expect(phash(scene({ seed: 3 }))).toMatch(/^[0-9a-f]{16}$/);
  });
  test('變亮一點、加一點雜訊（像連拍）→ 距離小', () => {
    for (const seed of [1, 4, 7, 12]) {
      const a = scene({ seed });
      const b = scene({ seed, brightness: 15, noise: 6 });
      expect(hamming(phash(a), phash(b))).toBeLessThanOrEqual(DEFAULT_GROUPING.phashMax);
      expect(hamming(dhash(a), dhash(b))).toBeLessThanOrEqual(DEFAULT_GROUPING.dhashMax);
    }
  });
  test('平移 1 個像素（手晃了一下）→ 仍然算相似', () => {
    const a = scene({ seed: 5 });
    const b = scene({ seed: 5, shift: 1 });
    expect(hamming(phash(a), phash(b))).toBeLessThanOrEqual(DEFAULT_GROUPING.phashMax);
  });
  test('不同的場景 → 距離大', () => {
    let close = 0;
    for (let s = 0; s < 20; s++)
      for (let t = s + 1; t < 20; t++)
        if (hamming(phash(scene({ seed: s })), phash(scene({ seed: t }))) <= DEFAULT_GROUPING.phashMax &&
            hamming(dhash(scene({ seed: s })), dhash(scene({ seed: t }))) <= DEFAULT_GROUPING.dhashMax) close++;
    expect(close).toBe(0); // 190 組不同場景，沒有一組被誤判成相似
  });
  test('hamming', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2);
    expect(hamming('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });
  test('toGray：RGBA 轉灰階', () => {
    expect(Array.from(toGray([255, 255, 255, 255, 0, 0, 0, 255], 4))).toEqual([255, 0]);
  });
  test('像素數不對會丟錯誤，不會悄悄算錯', () => {
    expect(() => phash(new Float32Array(10))).toThrow();
  });
});

const t0 = Date.UTC(2024, 5, 1, 10);
function hp(id: string, seed: number, minutes: number, extra: Partial<HashedPhoto> = {}, variant = 0): HashedPhoto {
  const img = scene({ seed, brightness: variant * 8, noise: variant ? 5 : 0 });
  return { id, createdAt: t0 + minutes * 60_000, width: 3024, height: 4032, phash: phash(img), dhash: dhash(img), ...extra };
}

describe('分組', () => {
  test('同一場景在 10 分鐘內的照片分成一組；其他場景各自獨立', () => {
    const photos = [hp('a1', 2, 0), hp('a2', 2, 0.2, {}, 1), hp('a3', 2, 0.5, {}, 2), hp('b1', 9, 1), hp('c1', 14, 3)];
    const groups = groupSimilar(photos);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(['a1', 'a2', 'a3']);
  });
  test('同一場景、相似但不完全相同、隔了一天 → 不分在一起（不是連拍）', () => {
    const x1 = hp('x1', 6, 0);
    const x2 = hp('x2', 6, 24 * 60, {}, 4);
    expect(x2.phash + x2.dhash).not.toBe(x1.phash + x1.dhash); // 前提：雜湊不完全相同
    expect(groupSimilar([x1, x2])).toHaveLength(0);
  });
  test('完全重複的照片不限時間', () => {
    const a = hp('d1', 8, 0);
    const b = { ...a, id: 'd2', createdAt: t0 + 400 * 24 * 3600_000 };
    expect(groupSimilar([a, b])[0].memberIds.sort()).toEqual(['d1', 'd2']);
  });
  test('A≈B、B≈C 會串成一組（union-find）', () => {
    const g = groupSimilar([hp('p1', 11, 0), hp('p2', 11, 5, {}, 1), hp('p3', 11, 9.5, {}, 2)]);
    expect(g[0].memberIds).toHaveLength(3);
  });
  test('建議保留解析度最高的；一樣就選最後拍的', () => {
    expect(pickBest([hp('s', 1, 0, { width: 1000, height: 1000 }), hp('l', 1, 1)])).toBe('l');
    expect(pickBest([hp('early', 1, 0), hp('late', 1, 2)])).toBe('late');
  });
  test('沒有拍攝時間：相似但不完全相同的不分組；完全重複照樣抓', () => {
    const n1 = hp('n1', 3, 0, { createdAt: null });
    const n2 = hp('n2', 3, 0, { createdAt: null }, 4); // 明顯變亮＋雜訊
    expect(n2.phash + n2.dhash).not.toBe(n1.phash + n1.dhash); // 前提：雜湊不完全相同
    expect(groupSimilar([n1, n2])).toHaveLength(0);
    expect(groupSimilar([n1, { ...n1, id: 'n1-copy' }])).toHaveLength(1);
  });
  test('5000 張照片分組很快（不是 n²）', () => {
    const many: HashedPhoto[] = [];
    for (let i = 0; i < 5000; i++) many.push(hp(`m${i}`, i % 50, i * 3));
    const start = performance.now();
    groupSimilar(many);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
