import { hamming } from './hash';

export type HashedPhoto = {
  id: string;
  createdAt: number | null;
  width: number | null;
  height: number | null;
  phash: string;
  dhash: string;
};

export type SimilarGroupDraft = {
  memberIds: string[];
  /** 每張跟代表照片（時間最早的）的 pHash 距離 */
  distances: Record<string, number>;
  bestId: string;
  windowStart: number;
  windowEnd: number;
};

export const DEFAULT_GROUPING = {
  /** 只跟前後 10 分鐘內的照片比（連拍、重拍幾乎都在這裡面），不做 n² 兩兩比較 */
  windowMs: 10 * 60 * 1000,
  /** pHash 距離上限（64 bit 中最多差幾個） */
  phashMax: 10,
  /** 而且 dHash 距離上限 */
  dhashMax: 12,
};
export type GroupingOptions = typeof DEFAULT_GROUPING;

/** 建議保留哪一張：解析度最高；一樣就選時間最晚的（通常是最後一次重拍） */
export function pickBest(photos: HashedPhoto[]): string {
  return [...photos].sort((a, b) => {
    const pa = (a.width ?? 0) * (a.height ?? 0);
    const pb = (b.width ?? 0) * (b.height ?? 0);
    if (pb !== pa) return pb - pa;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  })[0].id;
}

export function similar(a: HashedPhoto, b: HashedPhoto, o: GroupingOptions = DEFAULT_GROUPING): boolean {
  return hamming(a.phash, b.phash) <= o.phashMax && hamming(a.dhash, b.dhash) <= o.dhashMax;
}

/**
 * 分組：時間窗內相似的用 union-find 串起來；雜湊完全相同（完全重複）不限時間。
 * 時間複雜度 O(n log n + n·k)，k = 時間窗內的照片數。
 */
export function groupSimilar(photos: HashedPhoto[], o: GroupingOptions = DEFAULT_GROUPING): SimilarGroupDraft[] {
  const n = photos.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const idx = photos.map((_, i) => i).filter((i) => photos[i].createdAt != null);
  idx.sort((a, b) => photos[a].createdAt! - photos[b].createdAt!);
  for (let a = 0; a < idx.length; a++) {
    const pa = photos[idx[a]];
    for (let b = a + 1; b < idx.length; b++) {
      const pb = photos[idx[b]];
      if (pb.createdAt! - pa.createdAt! > o.windowMs) break;
      if (similar(pa, pb, o)) union(idx[a], idx[b]);
    }
  }
  // 完全重複：不管時間（例如同一張圖存了兩次、從聊天軟體再存一次）
  const exact = new Map<string, number>();
  photos.forEach((p, i) => {
    const key = p.phash + p.dhash;
    const prev = exact.get(key);
    if (prev === undefined) exact.set(key, i);
    else union(prev, i);
  });

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = buckets.get(r);
    if (list) list.push(i);
    else buckets.set(r, [i]);
  }
  const groups: SimilarGroupDraft[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const ps = members.map((i) => photos[i]).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const rep = ps[0];
    const times = ps.map((p) => p.createdAt ?? 0);
    groups.push({
      memberIds: ps.map((p) => p.id),
      distances: Object.fromEntries(ps.map((p) => [p.id, hamming(rep.phash, p.phash)])),
      bestId: pickBest(ps),
      windowStart: Math.min(...times),
      windowEnd: Math.max(...times),
    });
  }
  // 最新的組在前面（跟滑動牌堆一樣，從近期開始）
  return groups.sort((a, b) => b.windowEnd - a.windowEnd);
}
