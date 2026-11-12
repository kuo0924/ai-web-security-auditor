import { MemoryRepo } from '../data/memoryRepo';
import { fakeLibrary, makeSeedPhotos } from '../media/fakeLibrary';
import { PlaceService } from '../media/places';
import { SimilarController } from '../similar/controller';
import { fakeImageSource } from '../similar/fakeImageSource';
import { SessionController } from './session';
import type { AppControllers } from './createSession';

/** web 只當預覽：假相簿（含連拍組）＋記憶體資料庫。可用 ?access=partial|denied 預覽權限狀態。 */
export async function createSession(): Promise<AppControllers> {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const access = (params?.get('access') as 'full' | 'partial' | 'denied' | null) ?? 'full';
  const repo = new MemoryRepo();
  const lib = fakeLibrary({ access, photos: makeSeedPhotos(36, undefined, { bursts: true }) });
  const session = new SessionController(repo, lib);
  return { session, similar: new SimilarController(repo, lib, fakeImageSource, session, { restMs: 0 }), places: new PlaceService(lib, 'TW') };
}
