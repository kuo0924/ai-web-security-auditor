import type { Decision, Photo } from './types';

/**
 * 滑動牌堆的純邏輯（不碰相簿、不碰資料庫），方便測試。
 * - queue：還沒決定的照片，第一張是目前那張
 * - history：已做的決定（最新的在最後），給「復原」用
 */
export type DeckState = {
  queue: Photo[];
  history: { photo: Photo; decision: Decision }[];
  counts: Record<Decision, number>;
};

export const HISTORY_LIMIT = 50;

export function initialDeck(photos: Photo[]): DeckState {
  return { queue: photos, history: [], counts: { keep: 0, delete: 0, hide: 0 } };
}

export function decide(state: DeckState, decision: Decision): DeckState {
  const [top, ...rest] = state.queue;
  if (!top) return state;
  const history = [...state.history, { photo: top, decision }].slice(-HISTORY_LIMIT);
  return { queue: rest, history, counts: { ...state.counts, [decision]: state.counts[decision] + 1 } };
}

export function undo(state: DeckState): { state: DeckState; undone?: { photo: Photo; decision: Decision } } {
  const last = state.history[state.history.length - 1];
  if (!last) return { state };
  return {
    undone: last,
    state: {
      queue: [last.photo, ...state.queue],
      history: state.history.slice(0, -1),
      counts: { ...state.counts, [last.decision]: Math.max(0, state.counts[last.decision] - 1) },
    },
  };
}

/** 要預先載入縮圖的照片：目前這張之後的 n 張（目前這張和下一張已經在畫面上） */
export function prefetchTargets(queue: Photo[], n = 5): string[] {
  return queue.slice(1, 1 + n).map((p) => p.uri);
}

/** 加入下一頁照片：去掉已在佇列、已做過決定的。 */
export function append(state: DeckState, photos: Photo[], decided: Set<string>): DeckState {
  const seen = new Set(state.queue.map((p) => p.id));
  const fresh = photos.filter((p) => !seen.has(p.id) && !decided.has(p.id));
  return fresh.length ? { ...state, queue: [...state.queue, ...fresh] } : state;
}

/**
 * 依拖曳距離與速度判斷手勢結果。座標：x 向右為正、y 向下為正。
 * 往上要比左右更嚴格（距離門檻＋角度限制），避免誤觸隱藏。
 */
export function resolveSwipe(
  g: { dx: number; dy: number; vx: number; vy: number },
  size: { width: number; height: number },
  cfg: { horizontal: number; up: number; maxUpAngleDeg?: number; flingX?: number; flingUp?: number },
): Decision | null {
  'worklet';
  const flingX = cfg.flingX ?? 900;
  const flingUp = cfg.flingUp ?? 1100;
  const maxAngle = ((cfg.maxUpAngleDeg ?? 35) * Math.PI) / 180;
  const up = -g.dy;
  const upAngleOk = up > 0 && Math.atan2(Math.abs(g.dx), up) <= maxAngle;
  if (upAngleOk && (up > size.height * cfg.up || -g.vy > flingUp)) return 'hide';
  if (g.dx > size.width * cfg.horizontal || g.vx > flingX) return 'keep';
  if (g.dx < -size.width * cfg.horizontal || g.vx < -flingX) return 'delete';
  return null;
}
