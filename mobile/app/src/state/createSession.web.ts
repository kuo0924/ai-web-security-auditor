import { MemoryRepo } from '../data/memoryRepo';
import { fakeLibrary } from '../media/fakeLibrary';
import { SessionController } from './session';

/** web 只當預覽：假相簿（本機產生的色塊）＋記憶體資料庫。可用 ?access=partial|denied 預覽權限狀態。 */
export async function createSession(): Promise<SessionController> {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const access = (params?.get('access') as 'full' | 'partial' | 'denied' | null) ?? 'full';
  return new SessionController(new MemoryRepo(), fakeLibrary({ access }));
}
