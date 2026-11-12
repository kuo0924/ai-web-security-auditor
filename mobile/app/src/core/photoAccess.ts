import type { PhotoAccess } from './types';

type Response = { granted?: boolean; status?: string; accessPrivileges?: 'all' | 'limited' | 'none' };

/** 權限狀態只分三種，整個 App 都用這個判斷（Flutter 原型 BUG-001 的教訓）。 */
export function photoAccessFrom(r: Response): PhotoAccess {
  const granted = r.granted ?? r.status === 'granted';
  if (!granted) return 'denied';
  if (r.accessPrivileges === 'limited') return 'partial';
  if (r.accessPrivileges === 'none') return 'denied';
  return 'full';
}
