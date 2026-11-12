/**
 * 感知雜湊（全部在手機上算，architecture §5）。輸入都是 32×32 的灰階像素（0～255，列優先）。
 * - pHash：32×32 DCT，取左上 8×8 低頻係數，跟中位數比 → 64 bit。對縮放、壓縮、亮度小變化很穩。
 * - dHash：縮成 9×8，比較左右相鄰亮度 → 64 bit。算得快，當第二道確認。
 * 64 bit 存成 16 個 hex 字元（兩個 32 bit 無號整數），JS 的 number 不會溢位。
 */
export const SIZE = 32;
export type Gray32 = ArrayLike<number>; // 長度 1024

const DCT_N = 8;
const COS: number[][] = Array.from({ length: DCT_N }, (_, u) =>
  Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE))),
);

function bitsToHex(bits: boolean[]): string {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 32; i++) if (bits[i]) hi |= 1 << (31 - i);
  for (let i = 0; i < 32; i++) if (bits[32 + i]) lo |= 1 << (31 - i);
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

export function phash(gray: Gray32): string {
  if (gray.length !== SIZE * SIZE) throw new Error(`phash needs ${SIZE * SIZE} pixels, got ${gray.length}`);
  // 先對每一列做 1D DCT（只要前 8 個頻率），再對欄做
  const rows: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const r = new Array<number>(DCT_N).fill(0);
    for (let u = 0; u < DCT_N; u++) {
      let s = 0;
      for (let x = 0; x < SIZE; x++) s += gray[y * SIZE + x] * COS[u][x];
      r[u] = s;
    }
    rows.push(r);
  }
  const coeffs: number[] = [];
  for (let v = 0; v < DCT_N; v++) {
    for (let u = 0; u < DCT_N; u++) {
      let s = 0;
      for (let y = 0; y < SIZE; y++) s += rows[y][u] * COS[v][y];
      coeffs.push(s);
    }
  }
  // 中位數不含 DC（平均亮度），避免整體變亮變暗影響結果
  const ac = coeffs.slice(1).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  return bitsToHex(coeffs.map((c) => c > median));
}

/** 把 32×32 區域平均縮成 w×h（每個目標像素取對應區塊的平均） */
function boxResize(gray: Gray32, w: number, h: number): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < h; ty++) {
    const y0 = (ty * SIZE) / h;
    const y1 = ((ty + 1) * SIZE) / h;
    for (let tx = 0; tx < w; tx++) {
      const x0 = (tx * SIZE) / w;
      const x1 = ((tx + 1) * SIZE) / w;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += gray[y * SIZE + x] * wx * wy;
          area += wx * wy;
        }
      }
      out.push(sum / area);
    }
  }
  return out;
}

export function dhash(gray: Gray32): string {
  const small = boxResize(gray, 9, 8);
  const bits: boolean[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(small[y * 9 + x] < small[y * 9 + x + 1]);
  return bitsToHex(bits);
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** 兩個 16 字元 hex 雜湊之間不同的 bit 數（0～64） */
export function hamming(a: string, b: string): number {
  const hi = (parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0;
  const lo = (parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0;
  return popcount32(hi) + popcount32(lo);
}

/** RGBA（或 RGB）像素轉灰階（ITU-R BT.601 亮度） */
export function toGray(data: ArrayLike<number>, channels: number): Float32Array {
  const n = Math.floor(data.length / channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    out[i] = channels >= 3 ? 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] : data[o];
  }
  return out;
}
