import type { Decision, Photo, TrashMethod, TrashOutcome } from '../core/types';
import { estimateBytes, sectionKey } from '../core/format';
import type { Db, SqlValue } from './db';
import { SCHEMA_V1 } from './schema.gen';
import type { RepoLike } from './types';
import type { HashedPhoto, SimilarGroupDraft } from '../similar/group';

export type ArchiveItem = {
  asset_id: string;
  archived_at: number;
  status: 'archived' | 'deleting' | 'deleted' | 'trashed' | 'restored' | 'missing';
  byte_size: number | null;
  media_type: 'image' | 'video';
};

export type SimilarGroupRow = {
  id: string;
  bestId: string;
  members: { id: string; createdAt: number | null; width: number | null; height: number | null; mediaType: 'image' | 'video' }[];
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
    // 一個語句寫 100 張（不是一張一個 await）：索引兩萬張照片時，JS 執行緒不會被佔滿，滑動才不會卡
    await this.transaction(async (tx) => {
      for (let i = 0; i < photos.length; i += 100) {
        const chunk = photos.slice(i, i + 100);
        const params: SqlValue[] = [];
        for (const p of chunk) params.push(p.id, p.mediaType, p.width, p.height, p.createdAt, sectionKey(p.createdAt), t, t);
        await tx.run(
          `INSERT INTO assets (asset_id, media_type, width, height, created_at, section_key, first_seen_at, last_seen_at)
           VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')}
           ON CONFLICT(asset_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, missing_since = NULL`,
          params,
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

  // ───────── 相似照片（architecture §5） ─────────

  /** 還沒算雜湊（或上次失敗但還沒試滿 3 次）、而且還沒做過決定的照片，新的先算 */
  async assetsNeedingHash(limit: number): Promise<{ asset_id: string; modified_at: number | null }[]> {
    return this.all(
      `SELECT a.asset_id, a.modified_at FROM assets a
       LEFT JOIN photo_hashes h ON h.asset_id = a.asset_id
       WHERE a.media_type = 'image' AND a.missing_since IS NULL
         AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.asset_id = a.asset_id)
         AND (h.asset_id IS NULL
              OR (h.error IS NOT NULL AND h.attempts < 3)
              OR (a.modified_at IS NOT NULL AND h.source_mtime IS NOT a.modified_at))
       ORDER BY a.created_at DESC LIMIT ?`,
      [limit],
    );
  }

  async saveHashes(rows: { id: string; phash?: string; dhash?: string; mtime: number | null; error?: string }[]): Promise<void> {
    if (!rows.length) return;
    const t = now();
    await this.transaction(async (tx) => {
      for (const r of rows) {
        await tx.run(
          `INSERT INTO photo_hashes (asset_id, algo, phash, dhash, source_mtime, computed_at, error, attempts)
           VALUES (?, 'phash64_v1', ?, ?, ?, ?, ?, 1)
           ON CONFLICT(asset_id) DO UPDATE SET phash = excluded.phash, dhash = excluded.dhash,
             source_mtime = excluded.source_mtime, computed_at = excluded.computed_at, error = excluded.error,
             attempts = CASE WHEN excluded.error IS NULL THEN 1 ELSE photo_hashes.attempts + 1 END`,
          [r.id, r.phash ?? null, r.dhash ?? null, r.mtime, t, r.error ?? null],
        );
      }
    });
  }

  /** 分析進度：還沒決定的照片裡，幾張已經有雜湊 */
  async hashProgress(): Promise<{ hashed: number; total: number }> {
    const [r] = await this.all<{ hashed: number; total: number }>(
      `SELECT COUNT(h.phash) AS hashed, COUNT(*) AS total FROM assets a
       LEFT JOIN photo_hashes h ON h.asset_id = a.asset_id
       WHERE a.media_type = 'image' AND a.missing_since IS NULL
         AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.asset_id = a.asset_id)`,
    );
    return { hashed: r?.hashed ?? 0, total: r?.total ?? 0 };
  }

  /** 拿來分組的照片：有雜湊、還沒決定、還在相簿裡 */
  async hashedForGrouping(): Promise<HashedPhoto[]> {
    const rows = await this.all<{ id: string; created_at: number | null; width: number | null; height: number | null; phash: string; dhash: string }>(
      `SELECT a.asset_id AS id, a.created_at, a.width, a.height, h.phash, h.dhash FROM assets a
       JOIN photo_hashes h ON h.asset_id = a.asset_id
       WHERE h.phash IS NOT NULL AND h.dhash IS NOT NULL AND a.missing_since IS NULL
         AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.asset_id = a.asset_id)`,
    );
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, width: r.width, height: r.height, phash: r.phash, dhash: r.dhash }));
  }

  /** 使用者按過「都保留」的組（之後不再出現；除非多了新照片） */
  async dismissedMemberSets(): Promise<Set<string>[]> {
    const rows = await this.all<{ group_id: string; asset_id: string }>(
      `SELECT m.group_id, m.asset_id FROM similar_group_members m
       JOIN similar_groups g ON g.id = m.group_id WHERE g.status = 'dismissed'`,
    );
    const by = new Map<string, Set<string>>();
    for (const r of rows) (by.get(r.group_id) ?? by.set(r.group_id, new Set()).get(r.group_id)!).add(r.asset_id);
    return [...by.values()];
  }

  /** 用新的分組結果取代所有「未處理」的組。已處理／已略過的保留（紀錄用） */
  async replaceOpenGroups(drafts: SimilarGroupDraft[]): Promise<void> {
    const t = now();
    await this.transaction(async (tx) => {
      await tx.run("DELETE FROM similar_groups WHERE status = 'open'");
      for (const g of drafts) {
        const id = uuid();
        await tx.run(
          'INSERT INTO similar_groups (id, window_start, window_end, size, best_asset_id, status, created_at) VALUES (?,?,?,?,?,?,?)',
          [id, g.windowStart, g.windowEnd, g.memberIds.length, g.bestId, 'open', t],
        );
        for (const m of g.memberIds) {
          await tx.run('INSERT INTO similar_group_members (group_id, asset_id, distance) VALUES (?,?,?)', [id, m, g.distances[m] ?? 0]);
        }
      }
    });
  }

  async openGroups(): Promise<SimilarGroupRow[]> {
    const groups = await this.all<{ id: string; best_asset_id: string; window_end: number }>(
      "SELECT id, best_asset_id, window_end FROM similar_groups WHERE status = 'open' ORDER BY window_end DESC",
    );
    const members = await this.all<{ group_id: string; asset_id: string; created_at: number | null; width: number | null; height: number | null; media_type: 'image' | 'video' }>(
      `SELECT m.group_id, m.asset_id, a.created_at, a.width, a.height, a.media_type FROM similar_group_members m
       JOIN similar_groups g ON g.id = m.group_id AND g.status = 'open'
       JOIN assets a ON a.asset_id = m.asset_id
       WHERE NOT EXISTS (SELECT 1 FROM decisions d WHERE d.asset_id = m.asset_id)
       ORDER BY a.created_at`,
    );
    const by = new Map<string, SimilarGroupRow['members']>();
    for (const m of members)
      (by.get(m.group_id) ?? by.set(m.group_id, []).get(m.group_id)!).push({
        id: m.asset_id,
        createdAt: m.created_at,
        width: m.width,
        height: m.height,
        mediaType: m.media_type,
      });
    return groups
      .map((g) => ({ id: g.id, bestId: g.best_asset_id, members: by.get(g.id) ?? [] }))
      .filter((g) => g.members.length >= 2);
  }

  async setGroupStatus(groupId: string, status: 'resolved' | 'dismissed', bestId?: string): Promise<void> {
    await this.run('UPDATE similar_groups SET status = ?, best_asset_id = COALESCE(?, best_asset_id), resolved_at = ? WHERE id = ?', [
      status,
      bestId ?? null,
      now(),
      groupId,
    ]);
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
