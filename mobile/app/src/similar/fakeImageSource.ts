import { scene } from './scenes';
import type { ImageSource } from './imageSource';

/** 假照片的像素：對應 makeSeedPhotos({ bursts: true }) 的連拍組（每 5 張的前 3 張是同一場景）。 */
export const fakeImageSource: ImageSource = {
  async gray32({ id }) {
    const i = Number(id.replace(/^fake-/, '')) - 1;
    if (!Number.isFinite(i) || i < 0) throw new Error(`not a fake photo: ${id}`);
    if (i % 5 < 3) return scene({ seed: 1000 + Math.floor(i / 5), brightness: (i % 5) * 8, noise: i % 5 ? 5 : 0 });
    return scene({ seed: i });
  },
};
