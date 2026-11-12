import { Repo } from '../data/repo';
import { fakeLibrary, makeSeedPhotos } from '../media/fakeLibrary';
import { SimilarController } from '../similar/controller';
import { fakeImageSource } from '../similar/fakeImageSource';
import type { ImageSource } from '../similar/imageSource';
import { SessionController } from '../state/session';
import { nodeDb } from './nodeDb';

async function setup(n = 30, source: ImageSource = fakeImageSource) {
  const db = nodeDb();
  const repo = new Repo(db);
  const lib = fakeLibrary({ photos: makeSeedPhotos(n, undefined, { bursts: true }) });
  const session = new SessionController(repo, lib);
  await session.start();
  const similar = new SimilarController(repo, lib, source, session, { restMs: 0, batch: 7, regroupEvery: 10, indexPage: 8 });
  return { db, repo, lib, session, similar };
}

describe('相似照片：掃描 → 分組', () => {
  test('30 張（6 組連拍，每組 3 張）→ 找到 6 組，每組 3 張', async () => {
    const { similar } = await setup(30);
    await similar.scan();
    expect(similar.state.phase).toBe('ready');
    expect(similar.state.error).toBeUndefined();
    expect(similar.state.hashed).toBe(30);
    expect(similar.state.groups).toHaveLength(6);
    for (const g of similar.state.groups) expect(g.members).toHaveLength(3);
    // 每組都是連續的 fake-(5b+1..5b+3)
    const sets = similar.state.groups.map((g) => g.members.map((m) => Number(m.id.slice(5))).sort((a, b) => a - b));
    for (const s of sets) expect(s[2] - s[0]).toBe(2);
  });

  test('索引整個相簿，不只是滑動畫面載入過的那一頁', async () => {
    const { similar, session } = await setup(150);
    expect(session.state.deck.queue.length).toBeLessThan(150);
    await similar.scan();
    expect(similar.state.total).toBe(150);
    expect(similar.state.groups).toHaveLength(30);
  });

  test('讀不到的照片記錄錯誤、不擋其他照片；最多試 3 次', async () => {
    let calls = 0;
    const flaky: ImageSource = {
      gray32: async (p) => {
        if (p.id === 'fake-2') {
          calls++;
          throw new Error('iCloud download failed');
        }
        return fakeImageSource.gray32(p);
      },
    };
    const { similar } = await setup(10, flaky);
    await similar.scan();
    expect(similar.state.hashed).toBe(9);
    expect(calls).toBe(3); // 試了 3 次就放棄，不會無限重試
    expect(similar.state.groups.flatMap((g) => g.members.map((m) => m.id))).not.toContain('fake-2');
  });

  test('重新開 App：已算過的雜湊不再算一次', async () => {
    const { similar, repo, lib, session } = await setup(20);
    await similar.scan();
    let calls = 0;
    const counting: ImageSource = { gray32: async (p) => (calls++, fakeImageSource.gray32(p)) };
    const again = new SimilarController(repo, lib, counting, session, { restMs: 0 });
    await again.scan();
    expect(calls).toBe(0);
    expect(again.state.groups).toHaveLength(4);
  });
});

describe('比較畫面的動作', () => {
  test('保留一張、其他進封存區；這組消失；牌堆裡不再出現', async () => {
    const { similar, session } = await setup(30);
    await similar.scan();
    const g = similar.state.groups[0];
    const keep = g.bestId;
    await similar.resolve(g.id, [keep]);
    expect(similar.state.groups.find((x) => x.id === g.id)).toBeUndefined();
    expect(session.state.archiveCount).toBe(2);
    const archived = (await session.archiveItems()).map((i) => i.asset_id).sort();
    expect(archived).toEqual(g.members.filter((m) => m.id !== keep).map((m) => m.id).sort());
    const queued = new Set(session.state.deck.queue.map((p) => p.id));
    for (const m of g.members) expect(queued.has(m.id)).toBe(false);
  });

  test('一張都不留：丟錯誤、什麼都不改', async () => {
    const { similar, session } = await setup(30);
    await similar.scan();
    const g = similar.state.groups[0];
    await expect(similar.resolve(g.id, [])).rejects.toThrow('至少保留一張');
    expect(session.state.archiveCount).toBe(0);
    expect(similar.state.groups).toHaveLength(6);
  });

  test('「都保留」之後重新分組也不會再出現', async () => {
    const { similar } = await setup(30);
    await similar.scan();
    const g = similar.state.groups[0];
    await similar.keepAll(g.id);
    await similar.regroup();
    expect(similar.state.groups).toHaveLength(5);
    expect(similar.state.groups.some((x) => x.members.some((m) => m.id === g.members[0].id))).toBe(false);
  });

  test('在滑動畫面滑掉組裡的一張：這組只剩 2 張；剩 1 張就不算一組', async () => {
    const { similar, session } = await setup(30);
    await similar.scan();
    // 牌堆最前面是最新的照片：fake-1、fake-2、fake-3 是同一組連拍
    expect(session.state.deck.queue[0].id).toBe('fake-1');
    const gid = similar.state.groupOf['fake-1'];
    await session.decide('keep');
    await similar.loadGroups();
    expect(similar.state.groups.find((x) => x.id === gid)?.members.map((m) => m.id).sort()).toEqual(['fake-2', 'fake-3']);
    await session.decide('keep');
    await similar.loadGroups();
    expect(similar.state.groups.find((x) => x.id === gid)).toBeUndefined();
  });
});

describe('不跟滑動搶資源', () => {
  test('hold()：使用者在滑的時候先不分析，停手後才繼續', async () => {
    const { similar } = await setup(10);
    let firstHashAt = 0;
    const t0 = Date.now();
    const timed: ImageSource = {
      gray32: async (p) => {
        firstHashAt ||= Date.now();
        return fakeImageSource.gray32(p);
      },
    };
    (similar as unknown as { source: ImageSource }).source = timed;
    similar.hold(300);
    await similar.scan();
    expect(firstHashAt - t0).toBeGreaterThanOrEqual(290);
    expect(similar.state.groups).toHaveLength(2);
  });
});
