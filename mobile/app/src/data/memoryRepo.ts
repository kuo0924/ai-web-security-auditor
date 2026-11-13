import { estimateBytes } from '../core/format';
import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import type { ArchiveItem, SimilarGroupRow, Stats } from './repo';
import type { HashedPhoto, SimilarGroupDraft } from '../similar/group';
import type { RepoLike } from './types';

/**
 * 只給 web 預覽用（瀏覽器裡沒有 expo-sqlite 的原生資料庫）。行為對齊 Repo，
 * 但正式行為以 SQLite 的 Repo 為準，測試也是測 Repo。
 */
export class MemoryRepo implements RepoLike {
  private decisions = new Map<string, Decision>();
  private items = new Map<string, ArchiveItem & { batch?: string }>();
  private batches = new Map<string, { method: TrashMethod; status: string }>();
  async migrate() {}
  private assets = new Map<string, Photo>();
  private hashes = new Map<string, { phash?: string; dhash?: string; error?: string; attempts: number }>();
  private groups: { id: string; status: 'open' | 'resolved' | 'dismissed'; bestId: string; end: number; members: string[] }[] = [];
  async upsertAssets(photos: Photo[]) {
    for (const p of photos) this.assets.set(p.id, p);
  }
  private undecidedImages() {
    return [...this.assets.values()].filter((a) => a.mediaType === 'image' && !this.decisions.has(a.id));
  }
  async assetsNeedingHash(limit: number) {
    return this.undecidedImages()
      .filter((a) => {
        const h = this.hashes.get(a.id);
        return !h || (h.error && h.attempts < 3);
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, limit)
      .map((a) => ({ asset_id: a.id, modified_at: null }));
  }
  async saveHashes(rows: { id: string; phash?: string; dhash?: string; mtime: number | null; error?: string }[]) {
    for (const r of rows) {
      const prev = this.hashes.get(r.id);
      this.hashes.set(r.id, { phash: r.phash, dhash: r.dhash, error: r.error, attempts: r.error ? (prev?.attempts ?? 0) + 1 : 1 });
    }
  }
  async hashProgress() {
    const imgs = this.undecidedImages();
    return { hashed: imgs.filter((a) => this.hashes.get(a.id)?.phash).length, total: imgs.length };
  }
  async hashedForGrouping(): Promise<HashedPhoto[]> {
    return this.undecidedImages().flatMap((a) => {
      const h = this.hashes.get(a.id);
      return h?.phash && h.dhash ? [{ id: a.id, createdAt: a.createdAt, width: a.width, height: a.height, phash: h.phash, dhash: h.dhash }] : [];
    });
  }
  async dismissedMemberSets() {
    return this.groups.filter((g) => g.status === 'dismissed').map((g) => new Set(g.members));
  }
  async replaceOpenGroups(drafts: SimilarGroupDraft[]) {
    this.groups = this.groups.filter((g) => g.status !== 'open');
    drafts.forEach((d, i) => this.groups.push({ id: `g${Date.now()}-${i}`, status: 'open', bestId: d.bestId, end: d.windowEnd, members: d.memberIds }));
  }
  async openGroups(): Promise<SimilarGroupRow[]> {
    return this.groups
      .filter((g) => g.status === 'open')
      .sort((a, b) => b.end - a.end)
      .map((g) => ({
        id: g.id,
        bestId: g.bestId,
        members: g.members
          .filter((id) => !this.decisions.has(id) && this.assets.has(id))
          .map((id) => {
            const a = this.assets.get(id)!;
            return { id, createdAt: a.createdAt, width: a.width, height: a.height, mediaType: a.mediaType };
          }),
      }))
      .filter((g) => g.members.length >= 2);
  }
  async setGroupStatus(groupId: string, status: 'resolved' | 'dismissed', bestId?: string) {
    const g = this.groups.find((x) => x.id === groupId);
    if (g) (g.status = status), bestId && (g.bestId = bestId);
  }
  async decidedIds() {
    return new Set(this.decisions.keys());
  }
  async decide(photo: Photo, decision: Decision) {
    this.decisions.set(photo.id, decision);
    if (decision === 'delete')
      this.items.set(photo.id, {
        asset_id: photo.id,
        archived_at: Date.now(),
        status: 'archived',
        byte_size: estimateBytes(photo.width, photo.height, photo.mediaType, photo.durationMs),
        media_type: photo.mediaType,
        duration_ms: photo.durationMs ?? null,
      });
  }
  async undecide(id: string) {
    const it = this.items.get(id);
    if (it && it.status !== 'archived') return false;
    this.decisions.delete(id);
    this.items.delete(id);
    return true;
  }
  async archive() {
    return [...this.items.values()].filter((i) => i.status === 'archived').sort((a, b) => b.archived_at - a.archived_at);
  }
  async restore(ids: string[]) {
    for (const id of ids) if (this.items.get(id)?.status === 'archived') (this.items.delete(id), this.decisions.delete(id));
  }
  async updateArchiveSizes(sizes: Record<string, number | null>) {
    for (const [id, s] of Object.entries(sizes)) {
      const it = this.items.get(id);
      if (it && s != null) it.byte_size = s;
    }
  }
  async beginBatch(method: TrashMethod, ids: string[]) {
    const id = `b${this.batches.size + 1}`;
    this.batches.set(id, { method, status: 'pending' });
    for (const a of ids) {
      const it = this.items.get(a);
      if (it) (it.status = 'deleting'), (it.batch = id);
    }
    return id;
  }
  async finishBatch(batchId: string, outcome: TrashOutcome) {
    let bytes = 0;
    const removed = new Set(outcome.removedIds);
    for (const it of this.items.values()) {
      if (it.batch !== batchId) continue;
      if (removed.has(it.asset_id)) (it.status = 'trashed'), (bytes += it.byte_size ?? 0);
      else (it.status = 'archived'), (it.batch = undefined);
    }
    this.batches.get(batchId)!.status = removed.size ? 'confirmed' : 'cancelled';
    return bytes;
  }
  async pendingBatches() {
    return [];
  }
  async stats(): Promise<Stats> {
    const vals = [...this.items.values()];
    const removed = vals.filter((i) => i.status === 'trashed');
    return {
      kept: [...this.decisions.values()].filter((d) => d === 'keep').length,
      hidden: [...this.decisions.values()].filter((d) => d === 'hide').length,
      archived: vals.filter((i) => i.status === 'archived').length,
      removed: removed.length,
      bytesRemoved: removed.reduce((s, i) => s + (i.byte_size ?? 0), 0),
    };
  }
}
