import { SIZE } from './hash';

/**
 * 合成的 32×32 灰階場景（測試與 web 預覽用）：漸層＋圓＋方塊。
 * 同一個 seed、不同 variant ＝ 同一場景的連拍（亮度和雜訊有一點差異）。
 */
export function scene(opts: { seed: number; brightness?: number; noise?: number; shift?: number }): Float32Array {
  const { seed, brightness = 0, noise = 0, shift = 0 } = opts;
  // 版面由 seed 決定（mulberry32），不同 seed 不會週期性重複；雜訊用另一條亂數，不影響版面
  const layout = mulberry32(seed + 1);
  const noiseRnd = mulberry32(seed * 7919 + 17);
  const gx = layout() * 160 - 40;
  const gy = layout() * 160 - 80;
  const cx = 4 + layout() * 24;
  const cy = 4 + layout() * 24;
  const r = 4 + layout() * 6;
  const circle = layout() > 0.5 ? 90 : -60;
  const bx = layout() * 22;
  const by = layout() * 22;
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x0 = 0; x0 < SIZE; x0++) {
      const x = Math.min(SIZE - 1, Math.max(0, x0 - shift));
      let v = (x / SIZE) * gx + (y / SIZE) * gy + 110;
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) v += circle;
      if (x > bx && x < bx + 9 && y > by && y < by + 7) v += 70;
      v += brightness + (noiseRnd() - 0.5) * 2 * noise;
      out[y * SIZE + x0] = Math.max(0, Math.min(255, v));
    }
  return out;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
