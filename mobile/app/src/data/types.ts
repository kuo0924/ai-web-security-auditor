import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import type { ArchiveItem, SimilarGroupRow, Stats } from './repo';
import type { HashedPhoto, SimilarGroupDraft } from '../similar/group';

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
  // 相似照片
  assetsNeedingHash(limit: number): Promise<{ asset_id: string; modified_at: number | null }[]>;
  saveHashes(rows: { id: string; phash?: string; dhash?: string; mtime: number | null; error?: string }[]): Promise<void>;
  hashProgress(): Promise<{ hashed: number; total: number }>;
  hashedForGrouping(): Promise<HashedPhoto[]>;
  dismissedMemberSets(): Promise<Set<string>[]>;
  replaceOpenGroups(drafts: SimilarGroupDraft[]): Promise<void>;
  openGroups(): Promise<SimilarGroupRow[]>;
  setGroupStatus(groupId: string, status: 'resolved' | 'dismissed', bestId?: string): Promise<void>;
}
