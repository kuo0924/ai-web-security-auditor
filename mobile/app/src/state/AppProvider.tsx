import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { createSession, type AppControllers } from './createSession';

const Ctx = createContext<AppControllers | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ctrls, setCtrls] = useState<AppControllers | null>(null);

  useEffect(() => {
    let alive = true;
    createSession().then(async (c) => {
      if (!alive) return;
      setCtrls(c);
      await c.session.start();
      if (c.session.state.access !== 'denied') void c.similar.scan();
    });
    return () => {
      alive = false;
    };
  }, []);

  // 回到前景：重新檢查權限、繼續（或重新）掃描新照片；進背景：暫停掃描
  useEffect(() => {
    if (!ctrls) return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        await ctrls.session.refresh();
        ctrls.similar.resume();
        if (ctrls.session.state.access !== 'denied') void ctrls.similar.scan();
      } else if (s === 'background') {
        ctrls.similar.pause();
      }
    });
    return () => sub.remove();
  }, [ctrls]);

  return <Ctx.Provider value={ctrls}>{children}</Ctx.Provider>;
}

const noop = () => () => {};

export function useSession() {
  const c = useContext(Ctx)?.session ?? null;
  const state = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState() ?? null);
  return { ctrl: c, state };
}

export function useSimilar() {
  const c = useContext(Ctx)?.similar ?? null;
  const state = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState() ?? null);
  return { similar: c, state };
}
