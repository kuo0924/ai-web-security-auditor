import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import { estimateBytes, sectionKey } from '../core/format';
import type { Db, SqlValue } from './db';
import { SCHEMA_V1 } from './schema.gen';
import type { RepoLike } from './types';

export type ArchiveItem = {
  asset_id: string;
  archived_at: number;
  status: 'archived' | 'deleting' | 'deleted' | 'trashed' | 'restored' | 'missing';
  byte_size: number | null;
  media_type: 'image' | 'video';
};

export type Stats = { kept: number; archived: number; removed: number; bytesRemoved: number; hidden: number };

const now = () => Date.now();
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * 本機資料庫的所有讀寫都在這裡（architecture §2）。畫面不直接寫 SQL。
 * 每一滑都立刻寫進資料庫，離開再回來從同一張接著滑（fixes F3）。
 */
export class Repo implements RepoLike {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private raw: Db, private platform: 'ios' | 'android' | 'web' = 'android') {}

  /**
   * 所有資料庫存取都排隊，一次一個。同一條連線上的交易不能交錯（expo-sqlite 的
   * withTransactionAsync 也不是互斥的）：背景載入在寫 assets 時使用者又滑了一張，
   * 兩個交易交錯就會讓決定寫入失敗。
   */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private run(sql: string, params?: SqlValue[]) {
    return this.serial(() => this.raw.run(sql, params));
  }
  private all<T>(sql: string, params?: SqlValue[]) {
    return this.serial(() => this.raw.all<T>(sql, params));
  }
  /** 交易：fn 拿到的 t 直接打原始連線（整個交易已經在佇列裡佔好位置） */
  private transaction(fn: (t: Db) => Promise<void>): Promise<void> {
    return this.serial(() => this.raw.tx(() => fn(this.raw)));
  }

  async migrate(): Promise<void> {
    const rows = await this.all<{ user_version: number }>('PRAGMA user_version');
    if ((rows[0]?.user_version ?? 0) < 1) {
      await this.serial(() => this.raw.exec(SCHEMA_V1));
      await this.serial(() => this.raw.exec('PRAGMA user_version = 1'));
    }
  }

  /** 把讀到的照片寫進鏡像索引（decisions 有外鍵指向它）。 */
  async upsertAssets(photos: Photo[]): Promise<void> {
    if (!photos.length) return;
    const t = now();
    await this.transaction(async (tx) => {
      for (const p of photos) {
        await tx.run(
          `INSERT INTO assets (asset_id, media_type, width, height, created_at, section_key, first_seen_at, last_seen_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(asset_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, missing_since = NULL`,
          [p.id, p.mediaType, p.width, p.height, p.createdAt, sectionKey(p.createdAt), t, t],
        );
      }
    });
  }

  async decidedIds(): Promise<Set<string>> {
    const rows = await this.all<{ asset_id: string }>('SELECT asset_id FROM decisions');
    return new Set(rows.map((r) => r.asset_id));
  }

  async decide(photo: Photo, decision: Decision, source: 'swipe' | 'compare' | 'bulk' = 'swipe'): Promise<void> {
    const t = now();
    const value = decision === 'delete' ? 'archive' : decision;
    await this.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO decisions (asset_id, decision, source, section_key, decided_at) VALUES (?,?,?,?,?)
         ON CONFLICT(asset_id) DO UPDATE SET decision = excluded.decision, source = excluded.source, decided_at = excluded.decided_at`,
        [photo.id, value, source, sectionKey(photo.createdAt), t],
      );
      if (decision === 'delete') {
        await tx.run(
          `INSERT INTO archive_items (asset_id, archived_at, status, byte_size, media_type) VALUES (?,?, 'archived', ?, ?)
           ON CONFLICT(asset_id) DO UPDATE SET status = 'archived', archived_at = excluded.archived_at, delete_batch_id = NULL, finished_at = NULL`,
          [photo.id, t, estimateBytes(photo.width, photo.height, photo.mediaType), photo.mediaType],
        );
      }
      if (decision === 'hide') {
        // 垂直切片：先記錄成「排隊隱藏」。真正搬進上鎖相簿／設成 iOS 隱藏在下一個里程碑（build-log）。
        await tx.run(
          `INSERT INTO hidden_items (asset_id, store, status, media_type, hidden_at) VALUES (?,?, 'hiding', ?, ?)
           ON CONFLICT(asset_id) DO UPDATE SET status = 'hiding', hidden_at = excluded.hidden_at`,
          [photo.id, this.platform === 'ios' ? 'ios_hidden' : 'android_vault', photo.mediaType, t],
        );
      }
    });
  }

  /** 復原：把這張照片的決定整個拿掉。已經送進系統垃圾桶的不能在這裡復原。 */
  async undecide(assetId: string): Promise<boolean> {
    const rows = await this.all<{ status: string }>('SELECT status FROM archive_items WHERE asset_id = ?', [assetId]);
    if (rows[0] && rows[0].status !== 'archived') return false;
    await this.transaction(async (tx) => {
      await tx.run('DELETE FROM decisions WHERE asset_id = ?', [assetId]);
      await tx.run("DELETE FROM archive_items WHERE asset_id = ? AND status = 'archived'", [assetId]);
      await tx.run("DELETE FROM hidden_items WHERE asset_id = ? AND status = 'hiding'", [assetId]);
    });
    return true;
  }

  async archive(): Promise<ArchiveItem[]> {
    return this.all<ArchiveItem>(
      "SELECT asset_id, archived_at, status, byte_size, media_type FROM archive_items WHERE status = 'archived' ORDER BY archived_at DESC",
    );
  }

  /** 從封存區還原：照片回到待整理。 */
  async restore(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const ph = placeholders(ids.length);
    await this.transaction(async (tx) => {
      await tx.run(`DELETE FROM archive_items WHERE status = 'archived' AND asset_id IN (${ph})`, ids);
      await tx.run(`DELETE FROM decisions WHERE decision = 'archive' AND asset_id IN (${ph})`, ids);
    });
  }

  async updateArchiveSizes(sizes: Record<string, number | null>): Promise<void> {
    await this.transaction(async (tx) => {
      for (const [id, size] of Object.entries(sizes)) {
        if (size != null) await tx.run('UPDATE archive_items SET byte_size = ? WHERE asset_id = ?', [size, id]);
      }
    });
  }

  /** 送出刪除前先記錄批次（App 被殺掉時，下次開啟可以對帳，不會自動重送）。 */
  async beginBatch(method: TrashMethod, ids: string[]): Promise<string> {
    const id = uuid();
    const ph = placeholders(ids.length);
    const bytes = await this.all<{ total: number | null }>(
      `SELECT SUM(byte_size) AS total FROM archive_items WHERE asset_id IN (${ph})`,
      ids,
    );
    await this.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO delete_batches (id, method, requested_count, bytes_estimate, status, created_at) VALUES (?,?,?,?,?,?)',
        [id, method, ids.length, bytes[0]?.total ?? 0, 'pending', now()],
      );
      await tx.run(`UPDATE archive_items SET status = 'deleting', delete_batch_id = ? WHERE asset_id IN (${ph})`, [id, ...ids]);
    });
    return id;
  }

  /** 記錄結果：確定離開相簿的標成 trashed／deleted，其餘退回封存區。回傳這批實際移除的位元組數。 */
  async finishBatch(batchId: string, outcome: TrashOutcome): Promise<number> {
    const removed = new Set(outcome.removedIds);
    const items = await this.all<{ asset_id: string; byte_size: number | null }>(
      'SELECT asset_id, byte_size FROM archive_items WHERE delete_batch_id = ?',
      [batchId],
    );
    const finalStatus = outcome.method === 'android_delete' || outcome.method === 'android_legacy_delete' ? 'deleted' : 'trashed';
    const t = now();
    let bytes = 0;
    await this.transaction(async (tx) => {
      for (const it of items) {
        if (removed.has(it.asset_id)) {
          bytes += it.byte_size ?? 0;
          await tx.run('UPDATE archive_items SET status = ?, finished_at = ? WHERE asset_id = ?', [finalStatus, t, it.asset_id]);
        } else {
          await tx.run("UPDATE archive_items SET status = 'archived', delete_batch_id = NULL WHERE asset_id = ?", [it.asset_id]);
        }
      }
      const status =
        removed.size === 0 ? (outcome.status === 'failed' ? 'failed' : 'cancelled') : removed.size < items.length ? 'partial' : 'confirmed';
      await tx.run('UPDATE delete_batches SET status = ?, confirmed_count = ?, error = ?, finished_at = ? WHERE id = ?', [
        status,
        removed.size,
        outcome.error ?? null,
        t,
        batchId,
      ]);
    });
    return bytes;
  }

  /** 上次 App 在刪除途中被關掉：還在 deleting 的批次交給呼叫端對帳。 */
  async pendingBatches(): Promise<{ id: string; method: TrashMethod; ids: string[] }[]> {
    const batches = await this.all<{ id: string; method: TrashMethod }>("SELECT id, method FROM delete_batches WHERE status = 'pending'");
    const out = [];
    for (const b of batches) {
      const rows = await this.all<{ asset_id: string }>('SELECT asset_id FROM archive_items WHERE delete_batch_id = ?', [b.id]);
      out.push({ ...b, ids: rows.map((r) => r.asset_id) });
    }
    return out;
  }

  async stats(): Promise<Stats> {
    const [d] = await this.all<{ kept: number; hidden: number }>(
      "SELECT SUM(decision = 'keep') AS kept, SUM(decision = 'hide') AS hidden FROM decisions",
    );
    const [a] = await this.all<{ archived: number; removed: number; bytes: number | null }>(
      `SELECT SUM(status = 'archived') AS archived, SUM(status IN ('trashed','deleted')) AS removed,
              SUM(CASE WHEN status IN ('trashed','deleted') THEN byte_size ELSE 0 END) AS bytes FROM archive_items`,
    );
    return {
      kept: d?.kept ?? 0,
      hidden: d?.hidden ?? 0,
      archived: a?.archived ?? 0,
      removed: a?.removed ?? 0,
      bytesRemoved: a?.bytes ?? 0,
    };
  }
}
