import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import type { ArchiveItem, Stats } from './repo';

/** Repo 的公開介面：正式版是 SQLite 的 Repo，web 預覽用 MemoryRepo。 */
export interface RepoLike {
  migrate(): Promise<void>;
  upsertAssets(photos: Photo[]): Promise<void>;
  decidedIds(): Promise<Set<string>>;
  decide(photo: Photo, decision: Decision, source?: 'swipe' | 'compare' | 'bulk'): Promise<void>;
  undecide(assetId: string): Promise<boolean>;
  archive(): Promise<ArchiveItem[]>;
  restore(ids: string[]): Promise<void>;
  updateArchiveSizes(sizes: Record<string, number | null>): Promise<void>;
  beginBatch(method: TrashMethod, ids: string[]): Promise<string>;
  finishBatch(batchId: string, outcome: TrashOutcome): Promise<number>;
  pendingBatches(): Promise<{ id: string; method: TrashMethod; ids: string[] }[]>;
  stats(): Promise<Stats>;
}
