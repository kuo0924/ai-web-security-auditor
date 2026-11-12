import { append, decide as deckDecide, initialDeck, undo as deckUndo, type DeckState } from '../core/deck';
import type { Decision, Photo, PhotoAccess, TrashOutcome } from '../core/types';
import type { ArchiveItem, Stats } from '../data/repo';
import type { RepoLike } from '../data/types';
import type { PhotoLibrary } from '../media/library';

export const PAGE_SIZE = 60;
export const LOW_WATER = 10;
/** 一次送給系統的最多張數（Android Binder 上限的保守值，architecture §4.1） */
export const TRASH_CHUNK = 500;

export type EmptyResult = {
  requested: number;
  removed: number;
  bytes: number;
  outcome: TrashOutcome['status'];
  recoverable: boolean;
  chunks: number;
};

export type SessionState = {
  phase: 'starting' | 'ready';
  access: PhotoAccess | null;
  deck: DeckState;
  exhausted: boolean;
  archiveCount: number;
  stats: Stats;
  lastUndone?: { photo: Photo; decision: Decision };
  busy: boolean;
  error?: string;
};

/**
 * 滑動整理的流程控制：權限 → 讀相簿 → 決定 → 封存區 → 系統垃圾桶。
 * 不依賴 React，用假相簿＋node:sqlite 就能測（__tests__/session.test.ts）。
 */
export class SessionController {
  state: SessionState = {
    phase: 'starting',
    access: null,
    deck: initialDeck([]),
    exhausted: false,
    archiveCount: 0,
    stats: { kept: 0, archived: 0, removed: 0, bytesRemoved: 0, hidden: 0 },
    busy: false,
  };
  private listeners = new Set<() => void>();
  private offset = 0;
  private loading = false;
  private loadPromise?: Promise<void>;
  private systemOp = false;
  /** 這次開啟後做過決定的照片（復原時移除），避免載入中的頁面把它們加回來 */
  private decidedThisSession = new Set<string>();

  constructor(private repo: RepoLike, private lib: PhotoLibrary) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** 第一次開 App：會跳權限視窗 */
  async start(): Promise<void> {
    await this.repo.migrate();
    await this.reconcilePendingBatches();
    const access = await this.lib.request();
    await this.applyAccess(access);
  }

  /** 回到前景、從設定回來：只檢查權限，不跳視窗。系統確認視窗造成的暫停不算 */
  async refresh(): Promise<void> {
    if (this.systemOp || this.state.phase === 'starting') return;
    await this.applyAccess(await this.lib.check());
  }

  async requestAccess(): Promise<void> {
    await this.applyAccess(await this.lib.request());
  }

  async pickMore(): Promise<void> {
    await this.lib.pickMore();
    await this.applyAccess(await this.lib.check(), true);
  }

  openSettings = () => this.lib.openSettings();

  private async applyAccess(access: PhotoAccess, forceReload = false): Promise<void> {
    const changed = access !== this.state.access;
    if (access === 'denied') {
      this.offset = 0;
      this.set({ access, phase: 'ready', deck: initialDeck([]), exhausted: false });
      return;
    }
    if (changed || forceReload || this.state.phase === 'starting') {
      this.offset = 0;
      this.set({ access, deck: initialDeck([]), exhausted: false });
      await this.loadMore();
    }
    await this.refreshCounts();
    this.set({ access, phase: 'ready' });
  }

  /** 讀下一頁，跳過已經做過決定的照片（離開再回來會從同一張接著滑） */
  loadMore(): Promise<void> {
    if (this.state.exhausted) return Promise.resolve();
    // 正在載入就回傳同一個 promise，呼叫端可以真的等到載入完
    this.loadPromise ??= this.doLoadMore().finally(() => {
      this.loadPromise = undefined;
    });
    return this.loadPromise;
  }

  private async doLoadMore(): Promise<void> {
    this.loading = true;
    try {
      const decided = await this.repo.decidedIds();
      let exhausted = false;
      while (this.state.deck.queue.length < LOW_WATER * 2 && !exhausted) {
        const page = await this.lib.page(this.offset, PAGE_SIZE);
        this.offset += page.length;
        if (page.length < PAGE_SIZE) exhausted = true;
        await this.repo.upsertAssets(page);
        // 合併進「現在」的牌堆，不是開始載入時的快照：載入期間使用者可能又滑了幾張。
        // 也跳過載入期間才做決定的照片（它們已經不在佇列裡，但 decided 快照裡沒有）。
        for (const id of this.decidedThisSession) decided.add(id);
        this.set({ deck: append(this.state.deck, page, decided), exhausted });
      }
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.loading = false;
    }
  }

  async decide(decision: Decision): Promise<void> {
    const top = this.state.deck.queue[0];
    if (!top) return;
    // 先更新畫面，再寫資料庫（寫入很快；失敗就退回）
    this.decidedThisSession.add(top.id);
    this.set({ deck: deckDecide(this.state.deck, decision), lastUndone: undefined });
    try {
      await this.repo.decide(top, decision);
    } catch (e) {
      this.decidedThisSession.delete(top.id);
      this.set({ deck: deckUndo(this.state.deck).state, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (decision === 'delete') this.set({ archiveCount: this.state.archiveCount + 1 });
    if (this.state.deck.queue.length < LOW_WATER) void this.loadMore();
  }

  async undo(): Promise<boolean> {
    const { state, undone } = deckUndo(this.state.deck);
    if (!undone) return false;
    const ok = await this.repo.undecide(undone.photo.id);
    if (!ok) return false; // 已經送進系統垃圾桶了
    this.decidedThisSession.delete(undone.photo.id);
    this.set({
      deck: state,
      lastUndone: undone,
      archiveCount: undone.decision === 'delete' ? Math.max(0, this.state.archiveCount - 1) : this.state.archiveCount,
    });
    return true;
  }

  archiveItems(): Promise<ArchiveItem[]> {
    return this.repo.archive();
  }

  trashIsRecoverable() {
    return this.lib.trashIsRecoverable();
  }

  uriFor(id: string) {
    return this.lib.uriFor(id);
  }

  async restore(ids: string[]): Promise<void> {
    await this.repo.restore(ids);
    ids.forEach((id) => this.decidedThisSession.delete(id));
    // 還原的照片回到牌堆最前面
    this.offset = 0;
    this.set({ deck: initialDeck([]), exhausted: false });
    await this.loadMore();
    await this.refreshCounts();
  }

  /** 先查真實檔案大小（Android 準確、iOS 估算），清空前顯示用 */
  async measure(ids: string[]): Promise<number> {
    const sizes = await this.lib.fileSizes(ids);
    await this.repo.updateArchiveSizes(sizes);
    const items = await this.repo.archive();
    return items.filter((i) => ids.includes(i.asset_id)).reduce((s, i) => s + (i.byte_size ?? 0), 0);
  }

  /** 清空封存區：每 TRASH_CHUNK 張一批，每批系統確認一次 */
  async emptyArchive(ids: string[]): Promise<EmptyResult> {
    const result: EmptyResult = {
      requested: ids.length,
      removed: 0,
      bytes: 0,
      outcome: 'confirmed',
      recoverable: this.lib.trashIsRecoverable(),
      chunks: 0,
    };
    if (!ids.length) return result;
    this.systemOp = true;
    this.set({ busy: true });
    try {
      for (let i = 0; i < ids.length; i += TRASH_CHUNK) {
        const chunk = ids.slice(i, i + TRASH_CHUNK);
        result.chunks++;
        const batch = await this.repo.beginBatch(this.lib.trashMethod(), chunk);
        const outcome = await this.lib.moveToTrash(chunk);
        result.bytes += await this.repo.finishBatch(batch, outcome);
        result.removed += outcome.removedIds.length;
        if (outcome.status !== 'confirmed') {
          result.outcome = outcome.status;
          break; // 使用者取消就停，不要接著跳下一個視窗
        }
      }
    } finally {
      this.systemOp = false;
      await this.refreshCounts();
      this.set({ busy: false });
    }
    return result;
  }

  /** 上次刪到一半 App 被關：重新查照片還在不在，修正狀態；絕不自動重送刪除 */
  private async reconcilePendingBatches(): Promise<void> {
    for (const b of await this.repo.pendingBatches()) {
      const present = await this.lib.stillPresent(b.ids);
      await this.repo.finishBatch(b.id, {
        status: 'confirmed',
        method: b.method,
        removedIds: b.ids.filter((id) => !present.has(id)),
      });
    }
  }

  private async refreshCounts(): Promise<void> {
    const stats = await this.repo.stats();
    this.set({ stats, archiveCount: stats.archived });
  }
}
