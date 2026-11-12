import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'fast-png';
import { SIZE, toGray } from './hash';

/** 把一張照片變成 32×32 灰階像素。正式版用 expo-image-manipulator，測試／web 用假的。 */
export interface ImageSource {
  gray32(photo: { id: string; uri: string }): Promise<Float32Array>;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/**
 * 解碼時就限制在 64px（不會把 1200 萬像素原圖讀進記憶體），再縮成 32×32、存成 PNG、在 JS 解碼。
 * iOS 的 ph:// 會用 PhotoKit 取縮圖；原圖只在 iCloud 時可能要下載（architecture §4.5）。
 */
export const nativeImageSource: ImageSource = {
  async gray32({ uri }) {
    const ctx = ImageManipulator.manipulate(uri, { maxWidth: 64, maxHeight: 64 });
    ctx.resize({ width: SIZE, height: SIZE });
    const img = await ctx.renderAsync();
    try {
      const saved = await img.saveAsync({ format: SaveFormat.PNG, base64: true });
      if (!saved.base64) throw new Error('no base64 from image manipulator');
      const png = decode(base64ToBytes(saved.base64));
      if (png.width !== SIZE || png.height !== SIZE) throw new Error(`unexpected size ${png.width}x${png.height}`);
      const data = png.depth === 16 ? Array.from(png.data as Uint16Array, (v) => v / 257) : png.data;
      return toGray(data, png.channels);
    } finally {
      ctx.release();
      img.release();
    }
  },
};
