import { estimateBytes } from '../core/format';
import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import type { ArchiveItem, Stats } from './repo';
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
  async upsertAssets(_: Photo[]) {}
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
        byte_size: estimateBytes(photo.width, photo.height, photo.mediaType),
        media_type: photo.mediaType,
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
