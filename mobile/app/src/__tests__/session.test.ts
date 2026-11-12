import { Repo } from '../data/repo';
import { fakeLibrary, makeSeedPhotos } from '../media/fakeLibrary';
import { SessionController, TRASH_CHUNK } from '../state/session';
import { nodeDb } from './nodeDb';

async function setup(opts: Parameters<typeof fakeLibrary>[0] = {}) {
  const db = nodeDb();
  const repo = new Repo(db);
  const lib = fakeLibrary(opts);
  const s = new SessionController(repo, lib);
  await s.start();
  return { db, repo, lib, s };
}

afterEach(() => {
  // 寫入失敗不能悄悄吞掉：每個測試結束時都不該有錯誤
  for (const s of live) expect(s.state.error).toBeUndefined();
  live.length = 0;
});
const live: SessionController[] = [];
const origStart = SessionController.prototype.start;
SessionController.prototype.start = function (this: SessionController) {
  live.push(this);
  return origStart.call(this);
};

describe('垂直切片：讀相簿 → 滑動 → 系統垃圾桶 → 釋放空間', () => {
  test('完整流程', async () => {
    const { s, lib } = await setup();
    expect(s.state.access).toBe('full');
    expect(s.state.deck.queue.length).toBeGreaterThan(0);
    const [a, b, c] = s.state.deck.queue;

    await s.decide('delete');
    await s.decide('keep');
    await s.decide('delete');
    expect(s.state.archiveCount).toBe(2);

    const items = await s.archiveItems();
    expect(items.map((i) => i.asset_id).sort()).toEqual([a.id, c.id].sort());
    const bytes = await s.measure(items.map((i) => i.asset_id));
    expect(bytes).toBe(2 * 2_400_000);

    const r = await s.emptyArchive(items.map((i) => i.asset_id));
    expect(lib.state.trashCalls).toHaveLength(1); // 系統只確認一次
    expect(r).toMatchObject({ requested: 2, removed: 2, bytes: 4_800_000, outcome: 'confirmed', recoverable: true });
    expect(s.state.archiveCount).toBe(0);
    expect(s.state.stats.bytesRemoved).toBe(4_800_000);
    expect(lib.state.photos.find((p) => p.id === b.id)).toBeDefined(); // 保留的還在
  });

  test('使用者在系統視窗按取消：照片留在封存區、不算釋放', async () => {
    const { s } = await setup({ cancelTrash: true });
    await s.decide('delete');
    const ids = (await s.archiveItems()).map((i) => i.asset_id);
    const r = await s.emptyArchive(ids);
    expect(r).toMatchObject({ outcome: 'cancelled', removed: 0, bytes: 0 });
    expect((await s.archiveItems()).map((i) => i.asset_id)).toEqual(ids);
  });

  test(`超過 ${TRASH_CHUNK} 張分批送出；取消就停在那一批`, async () => {
    const { s, lib } = await setup({ photos: makeSeedPhotos(TRASH_CHUNK + 20) });
    // 像使用者一樣：牌堆空了就等下一頁載入
    while (s.state.deck.queue.length || !s.state.exhausted) {
      if (!s.state.deck.queue.length) await s.loadMore();
      else await s.decide('delete');
    }
    const ids = (await s.archiveItems()).map((i) => i.asset_id);
    const r = await s.emptyArchive(ids);
    expect(lib.state.trashCalls.map((c) => c.length)).toEqual([TRASH_CHUNK, 20]);
    expect(r.chunks).toBe(2);
    expect(r.removed).toBe(TRASH_CHUNK + 20);
  });

  test('載入下一頁期間繼續滑：滑過的照片不會跑回來', async () => {
    const { s } = await setup({ photos: makeSeedPhotos(200) });
    const seen = new Set<string>();
    // 連續滑 100 張，不等背景載入（模擬手很快的使用者）
    for (let i = 0; i < 100; i++) {
      if (!s.state.deck.queue.length) await s.loadMore();
      seen.add(s.state.deck.queue[0].id);
      await s.decide('keep');
    }
    await s.loadMore();
    expect(s.state.deck.queue.filter((p) => seen.has(p.id))).toEqual([]);
    expect(s.state.stats.kept + s.state.deck.counts.keep).toBeGreaterThanOrEqual(100);
  });

  test('每一滑都存檔：重開 App 從同一張接著滑（fixes F3）', async () => {
    const db = nodeDb();
    const lib = fakeLibrary();
    const first = new SessionController(new Repo(db), lib);
    await first.start();
    const third = first.state.deck.queue[2];
    await first.decide('keep');
    await first.decide('delete');

    const reopened = new SessionController(new Repo(db), lib); // 同一個資料庫
    await reopened.start();
    expect(reopened.state.deck.queue[0].id).toBe(third.id);
    expect(reopened.state.archiveCount).toBe(1);
  });

  test('復原刪除：照片回到最前面、封存區少一張', async () => {
    const { s } = await setup();
    const top = s.state.deck.queue[0];
    await s.decide('delete');
    expect(await s.undo()).toBe(true);
    expect(s.state.deck.queue[0].id).toBe(top.id);
    expect(s.state.archiveCount).toBe(0);
    expect(await s.archiveItems()).toHaveLength(0);
  });

  test('已送進系統垃圾桶的照片不能在滑動頁復原', async () => {
    const { s } = await setup();
    await s.decide('delete');
    await s.emptyArchive((await s.archiveItems()).map((i) => i.asset_id));
    expect(await s.undo()).toBe(false);
  });

  test('往上滑隱藏：記錄成排隊隱藏，不進封存區', async () => {
    const { s, db } = await setup();
    const top = s.state.deck.queue[0];
    await s.decide('hide');
    expect(s.state.archiveCount).toBe(0);
    const rows = db.raw.prepare('SELECT status, store FROM hidden_items WHERE asset_id = ?').all(top.id);
    expect(rows).toEqual([{ status: 'hiding', store: 'android_vault' }]);
  });

  test('從封存區還原：照片回到牌堆', async () => {
    const { s } = await setup();
    const top = s.state.deck.queue[0];
    await s.decide('delete');
    await s.restore([top.id]);
    expect(s.state.deck.queue.some((p) => p.id === top.id)).toBe(true);
    expect(s.state.archiveCount).toBe(0);
  });
});

describe('權限', () => {
  test('拒絕：牌堆清空', async () => {
    const { s } = await setup({ access: 'denied' });
    expect(s.state.access).toBe('denied');
    expect(s.state.deck.queue).toHaveLength(0);
  });

  test('拒絕 → 到設定開啟 → 回到前景：讀得到照片', async () => {
    const { s, lib } = await setup({ access: 'denied' });
    lib.state.access = 'full';
    await s.refresh();
    expect(s.state.access).toBe('full');
    expect(s.state.deck.queue.length).toBeGreaterThan(0);
  });

  test('完整 → 設定關掉 → 回到前景：變成拒絕', async () => {
    const { s, lib } = await setup();
    lib.state.access = 'denied';
    await s.refresh();
    expect(s.state.access).toBe('denied');
    expect(s.state.deck.queue).toHaveLength(0);
  });

  test('部分 → 改成完整：狀態更新', async () => {
    const { s, lib } = await setup({ access: 'partial' });
    expect(s.state.access).toBe('partial');
    lib.state.access = 'full';
    await s.refresh();
    expect(s.state.access).toBe('full');
  });
});

describe('對帳：刪到一半 App 被關掉', () => {
  test('下次開啟依「照片還在不在」修正，不自動重送', async () => {
    const db = nodeDb();
    const lib = fakeLibrary();
    const repo = new Repo(db);
    const s = new SessionController(repo, lib);
    await s.start();
    const [a, b] = s.state.deck.queue;
    await s.decide('delete');
    await s.decide('delete');
    await repo.beginBatch('android_trash', [a.id, b.id]); // 模擬：送出後 App 被殺
    lib.state.photos = lib.state.photos.filter((p) => p.id !== a.id); // 系統只刪了 a

    const again = new SessionController(new Repo(db), lib);
    await again.start();
    expect(lib.state.trashCalls).toHaveLength(0);
    expect((await again.archiveItems()).map((i) => i.asset_id)).toEqual([b.id]);
    expect(again.state.stats.removed).toBe(1);
  });
});
