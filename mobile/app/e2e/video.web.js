// 影片的端對端測試（web 預覽：假相簿 36 張，其中 7 支影片）。真的觸控事件、390x844。
// web 不能播放（沒有原生播放器），這裡測：切換「影片 · 大的先」、長度標籤、排序、刪影片、封存區標籤。
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const [root, out] = process.argv.slice(2);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { const h = p.replace(/\/$/, '') + '.html'; p = fs.existsSync(h) ? h : path.join(root, 'index.html'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0, async () => {
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const errs = []; let failed = 0;
  const check = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) failed++; };
  const secs = (s) => s.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
    const pill = async () => (await p.getByText(/^\d+:\d{2}$/).first().textContent()).trim();
    const swipeLeft = async () => {
      const box = await p.getByLabel(/^(照片|影片 [\d:]+)，/).first().boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 15; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 260 * i / 15, y }] }); await p.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(700);
    };
    await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    check('filter control shows 全部 + 影片', await p.getByRole('tab', { name: '全部' }).count() === 1 && await p.getByRole('tab', { name: '影片 · 大的先' }).count() === 1);
    check('全部 is selected by default', await p.getByRole('tab', { name: '全部', selected: true }).count() === 1);

    await p.getByRole('tab', { name: '影片 · 大的先' }).tap(); await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/S06-video.png` });
    const first = await pill();
    check(`video card shows a duration badge (${first})`, /^\d+:\d{2}$/.test(first));
    await p.getByRole('button', { name: '保留這張照片' }).tap(); await p.waitForTimeout(700);
    const second = await pill();
    check(`longest first: ${first} ≥ ${second}`, secs(first) >= secs(second));
    await swipeLeft();
    check('swipe a video left → archive 1', await p.getByLabel('封存區，1 張').count() === 1);

    await p.getByRole('button', { name: '封存區，1 張' }).tap(); await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/S09-video.png` });
    check('archive tile labelled as video with its length', await p.getByLabel(new RegExp(`^影片 ${second.replace(':', '\\:')}，約`)).count() === 1);
    const mb = Number((await p.getByText(/^約 [\d.]+ MB$/).first().textContent()).match(/[\d.]+/)[0]);
    check(`video size estimated from duration (${mb} MB, not the 3 MB photo guess)`, mb > 10);
    await p.goBack(); await p.waitForTimeout(600);

    await p.getByRole('tab', { name: '全部' }).tap(); await p.waitForTimeout(700);
    check('back to 全部: photos are back', await p.getByText(/^\d+:\d{2}$/).count() === 0);
  } catch (e) { failed++; console.log('FAIL exception', e.message); }
  console.log('console errors:', errs.length ? errs.slice(0, 5) : 'none');
  await browser.close(); srv.close();
  process.exit(failed || errs.length ? 1 : 0);
});
