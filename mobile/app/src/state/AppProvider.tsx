import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Photo } from '../core/types';
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
      // 先讓使用者開始滑，3 秒後才在背景分析相似照片
      if (c.session.state.access !== 'denied') setTimeout(() => void c.similar.scan(), 3000);
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

/**
 * 滑動畫面只需要「哪張照片屬於哪一組」。只有分組結果改變時才重繪，
 * 分析進度更新不會讓滑動畫面重繪（「滑起來很卡」的主因之一）。
 */
export function useSimilarGroups() {
  const c = useContext(Ctx)?.similar ?? null;
  const groupOf = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState().groupOf ?? EMPTY_MAP);
  const groups = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState().groups ?? EMPTY_LIST);
  return { similar: c, groupOf, groups };
}
const EMPTY_MAP: Record<string, string> = {};
const EMPTY_LIST: never[] = [];

export function useSimilar() {
  const c = useContext(Ctx)?.similar ?? null;
  const state = useSyncExternalStore(c ? c.subscribe : noop, () => c?.getState() ?? null);
  return { similar: c, state };
}

/** 這張照片的地名（非同步查，查到才顯示；同時預先查接下來的照片） */
export function usePlace(photo: Photo | undefined, upcoming: Photo[] = []): string | null {
  const places = useContext(Ctx)?.places ?? null;
  const [label, setLabel] = useState<{ id: string; text: string | null } | null>(null);
  const id = photo?.id;
  useEffect(() => {
    if (!places || !id) return;
    let alive = true;
    void places.label(id).then((text) => alive && setLabel({ id, text }));
    for (const p of upcoming.slice(0, 2)) void places.label(p.id);
    return () => {
      alive = false;
    };
  }, [places, id]); // eslint-disable-line react-hooks/exhaustive-deps
  return label && label.id === id ? label.text : null;
}
