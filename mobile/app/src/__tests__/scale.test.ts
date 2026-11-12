import { Repo } from '../data/repo';
import { fakeLibrary, makeSeedPhotos } from '../media/fakeLibrary';
import { SessionController, TRASH_CHUNK } from '../state/session';
import { nodeDb } from './nodeDb';

/**
 * 上萬張照片（replica-test 重點）。用 node:sqlite 跑真的 SQL。
 * 時間門檻放寬（CI 機器比手機快也比手機慢都有可能），重點是「不會隨張數爆炸」和「結果正確」。
 */
jest.setTimeout(120_000);

const N = 20_000;
const photos = makeSeedPhotos(N);

test(`${N} 張：開啟只讀第一頁，不會一次讀完整個相簿`, async () => {
  const lib = fakeLibrary({ photos });
  const pageSpy = jest.spyOn(lib, 'page');
  const s = new SessionController(new Repo(nodeDb()), lib);
  const t0 = performance.now();
  await s.start();
  const ms = performance.now() - t0;
  console.log(`start with ${N} photos: ${ms.toFixed(0)} ms, pages read: ${pageSpy.mock.calls.length}`);
  expect(pageSpy.mock.calls.length).toBe(1);
  expect(s.state.deck.queue.length).toBe(60);
  expect(ms).toBeLessThan(2000);
});

test('連續滑 3000 張：每張的處理時間不隨已滑張數增加太多', async () => {
  const s = new SessionController(new Repo(nodeDb()), fakeLibrary({ photos }));
  await s.start();
  const times: number[] = [];
  for (let i = 0; i < 3000; i++) {
    if (!s.state.deck.queue.length) await s.loadMore();
    const t0 = performance.now();
    await s.decide(i % 3 === 0 ? 'delete' : 'keep');
    times.push(performance.now() - t0);
  }
  await s.loadMore();
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const first = avg(times.slice(0, 500));
  const last = avg(times.slice(-500));
  console.log(`decide avg first 500: ${first.toFixed(2)} ms, last 500: ${last.toFixed(2)} ms`);
  expect(s.state.archiveCount).toBe(1000);
  expect(s.state.error).toBeUndefined();
  expect(last).toBeLessThan(Math.max(5, first * 4));
});

test(`封存 5000 張一次清空：分 ${Math.ceil(5000 / TRASH_CHUNK)} 批、全部算到`, async () => {
  const lib = fakeLibrary({ photos: makeSeedPhotos(5000) });
  const s = new SessionController(new Repo(nodeDb()), lib);
  await s.start();
  while (s.state.deck.queue.length || !s.state.exhausted) {
    if (!s.state.deck.queue.length) await s.loadMore();
    else await s.decide('delete');
  }
  const ids = (await s.archiveItems()).map((i) => i.asset_id);
  expect(ids).toHaveLength(5000);
  const t0 = performance.now();
  const r = await s.emptyArchive(ids);
  console.log(`empty 5000: ${(performance.now() - t0).toFixed(0)} ms in ${r.chunks} chunks`);
  expect(r.chunks).toBe(Math.ceil(5000 / TRASH_CHUNK));
  expect(r.removed).toBe(5000);
  expect(s.state.archiveCount).toBe(0);
  expect(s.state.stats.removed).toBe(5000);
});
