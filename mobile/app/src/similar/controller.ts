import type { Photo } from '../core/types';
import type { SimilarGroupRow } from '../data/repo';
import type { RepoLike } from '../data/types';
import type { PhotoLibrary } from '../media/library';
import type { SessionController } from '../state/session';
import { DEFAULT_GROUPING, groupSimilar, type GroupingOptions } from './group';
import { dhash, phash } from './hash';
import type { ImageSource } from './imageSource';

export type SimilarState = {
  phase: 'idle' | 'indexing' | 'hashing' | 'grouping' | 'ready' | 'paused';
  hashed: number;
  total: number;
  groups: SimilarGroupRow[];
  /** asset id → group id（滑動畫面用來顯示「這張有相似照片」） */
  groupOf: Record<string, string>;
  error?: string;
};

type Opts = {
  /** 一次算幾張再讓出主執行緒 */
  batch: number;
  /** 每批之間休息多久（毫秒），使用者滑動時不卡 */
  restMs: number;
  /** 每算完幾張就重新分組一次，讓結果早點出現 */
  regroupEvery: number;
  indexPage: number;
  grouping: GroupingOptions;
};

const DEFAULTS: Opts = { batch: 20, restMs: 120, regroupEvery: 200, indexPage: 500, grouping: DEFAULT_GROUPING };

/**
 * 相似照片：建立整個相簿的索引 → 分批算雜湊（新的照片先）→ 分組 → 比較畫面處理。
 * 不依賴 React；用假相簿＋假像素＋node:sqlite 就能測。
 */
export class SimilarController {
  state: SimilarState = { phase: 'idle', hashed: 0, total: 0, groups: [], groupOf: {} };
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private paused = false;
  private resumeWaiter?: () => void;
  private opts: Opts;

  constructor(
    private repo: RepoLike,
    private lib: PhotoLibrary,
    private source: ImageSource,
    private session: SessionController,
    opts: Partial<Opts> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<SimilarState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** 開始（或重新）掃描；已經在跑就回傳同一個 promise */
  scan(): Promise<void> {
    this.running ??= this.doScan().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** App 進背景時暫停，回前景再繼續 */
  pause() {
    this.paused = true;
    if (this.state.phase === 'hashing' || this.state.phase === 'indexing') this.set({ phase: 'paused' });
  }
  resume() {
    this.paused = false;
    this.resumeWaiter?.();
    this.resumeWaiter = undefined;
  }

  private async gate(phase: SimilarState['phase']) {
    if (this.paused) await new Promise<void>((r) => (this.resumeWaiter = r));
    if (this.state.phase !== phase) this.set({ phase });
  }

  private async doScan(): Promise<void> {
    try {
      await this.loadGroups(); // 先顯示上次的結果
      await this.index();
      let sinceRegroup = 0;
      for (;;) {
        await this.gate('hashing');
        const batch = await this.repo.assetsNeedingHash(this.opts.batch);
        if (!batch.length) break;
        const rows = [];
        for (const a of batch) {
          try {
            const gray = await this.source.gray32({ id: a.asset_id, uri: this.lib.uriFor(a.asset_id) });
            rows.push({ id: a.asset_id, phash: phash(gray), dhash: dhash(gray), mtime: a.modified_at });
          } catch (e) {
            // 讀不到（檔案壞掉、iCloud 下載失敗）：記下來，最多試 3 次，不擋其他照片
            rows.push({ id: a.asset_id, mtime: a.modified_at, error: e instanceof Error ? e.message : String(e) });
          }
        }
        await this.repo.saveHashes(rows);
        sinceRegroup += rows.length;
        this.set(await this.repo.hashProgress());
        if (sinceRegroup >= this.opts.regroupEvery) {
          sinceRegroup = 0;
          await this.regroup();
        }
        if (this.opts.restMs) await new Promise((r) => setTimeout(r, this.opts.restMs));
      }
      await this.regroup();
      this.set({ phase: 'ready', ...(await this.repo.hashProgress()) });
    } catch (e) {
      this.set({ phase: 'ready', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 把整個相簿的基本資料寫進索引（只讀 metadata，很快） */
  private async index() {
    await this.gate('indexing');
    for (let offset = 0; ; offset += this.opts.indexPage) {
      const page = await this.lib.page(offset, this.opts.indexPage);
      await this.repo.upsertAssets(page);
      if (page.length < this.opts.indexPage) break;
      await this.gate('indexing');
    }
    this.set(await this.repo.hashProgress());
  }

  async regroup() {
    const prev = this.state.phase;
    this.set({ phase: 'grouping' });
    const drafts = groupSimilar(await this.repo.hashedForGrouping(), this.opts.grouping);
    const dismissed = await this.repo.dismissedMemberSets();
    // 按過「都保留」的組不再出現（除非後來多了新的相似照片）
    const fresh = drafts.filter((d) => !dismissed.some((set) => d.memberIds.every((id) => set.has(id))));
    await this.repo.replaceOpenGroups(fresh);
    await this.loadGroups();
    this.set({ phase: prev === 'grouping' ? 'ready' : prev });
  }

  async loadGroups() {
    const groups = await this.repo.openGroups();
    const groupOf: Record<string, string> = {};
    for (const g of groups) for (const m of g.members) groupOf[m.id] = g.id;
    this.set({ groups, groupOf });
  }

  private toPhoto(m: SimilarGroupRow['members'][number]): Photo {
    return { id: m.id, uri: this.lib.uriFor(m.id), width: m.width, height: m.height, createdAt: m.createdAt, mediaType: m.mediaType };
  }

  uriFor(id: string) {
    return this.lib.uriFor(id);
  }

  /** 保留選取的，其他進封存區。至少要留一張（全部不要就去滑動畫面一張張刪）。 */
  async resolve(groupId: string, keepIds: string[]): Promise<void> {
    const g = this.state.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (!keepIds.length) throw new Error('至少保留一張');
    const keep = g.members.filter((m) => keepIds.includes(m.id)).map((m) => this.toPhoto(m));
    const remove = g.members.filter((m) => !keepIds.includes(m.id)).map((m) => this.toPhoto(m));
    await this.session.applyCompare(keep, remove);
    await this.repo.setGroupStatus(groupId, 'resolved', keepIds[0]);
    this.dropLocal(groupId);
  }

  /** 「都保留」：這組都留，之後不再問 */
  async keepAll(groupId: string): Promise<void> {
    const g = this.state.groups.find((x) => x.id === groupId);
    if (!g) return;
    await this.session.applyCompare(g.members.map((m) => this.toPhoto(m)), []);
    await this.repo.setGroupStatus(groupId, 'dismissed');
    this.dropLocal(groupId);
  }

  private dropLocal(groupId: string) {
    const groups = this.state.groups.filter((x) => x.id !== groupId);
    const groupOf: Record<string, string> = {};
    for (const g of groups) for (const m of g.members) groupOf[m.id] = g.id;
    this.set({ groups, groupOf });
  }
}
