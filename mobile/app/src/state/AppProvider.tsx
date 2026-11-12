import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { createSession } from './createSession';
import type { SessionController } from './session';

const Ctx = createContext<SessionController | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ctrl, setCtrl] = useState<SessionController | null>(null);

  useEffect(() => {
    let alive = true;
    createSession().then(async (c) => {
      if (!alive) return;
      setCtrl(c);
      await c.start();
    });
    return () => {
      alive = false;
    };
  }, []);

  // 每次回到前景都重新檢查權限（從系統設定回來、從系統確認視窗回來）
  useEffect(() => {
    if (!ctrl) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void ctrl.refresh();
    });
    return () => sub.remove();
  }, [ctrl]);

  return <Ctx.Provider value={ctrl}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  const noop = () => () => {};
  const state = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState() ?? null);
  return { ctrl: c, state };
}
