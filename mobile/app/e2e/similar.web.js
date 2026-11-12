// 相似照片的端對端測試（web 預覽：假相簿 36 張，含 7 組 3 連拍）。真的觸控事件、390x844。
// 用法：npx expo export -p web --output-dir dist-web && node e2e/similar.web.js dist-web <截圖資料夾>
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
  const errs = [];
  const step = (n, ok) => console.log((ok ? 'PASS ' : 'FAIL ') + n);
  let failed = 0;
  const check = (n, ok) => { step(n, ok); if (!ok) failed++; };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(base + '/', { waitUntil: 'networkidle' });
    await p.getByLabel(/相似照片，7 組/).waitFor({ timeout: 15000 });
    check('scan finds 7 groups (header badge)', true);
    check('first card shows "有 3 張相似 · 比較"', await p.getByText('有 3 張相似 · 比較').count() === 1);
    await p.screenshot({ path: `${out}/S06-similar-hint.png` });

    await p.getByRole('button', { name: '這張有相似的照片，打開比較' }).tap(); await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/S08-compare.png` });
    check('S08 opens on that group (1 / 7)', await p.getByText('相似照片 1 / 7').count() >= 1);
    check('best shot preselected → "保留 1 張，其他移到封存區"', await p.getByRole('button', { name: '保留 1 張，其他移到封存區' }).count() === 1);
    check('suggested best is labelled', await p.getByText('建議保留', { exact: true }).count() === 1);

    // 多保留一張
    await p.getByLabel(/移到封存區$/).first().tap(); await p.waitForTimeout(300);
    check('tap a photo → keep 2', await p.getByRole('button', { name: '保留 2 張，其他移到封存區' }).count() === 1);
    // 取消全部保留 → 按鈕停用
    while (await p.getByLabel(/，保留$/).count()) { await p.getByLabel(/，保留$/).first().tap(); await p.waitForTimeout(150); }
    await p.waitForTimeout(300);
    check('keep none → button disabled + hint', await p.getByText(/至少要保留一張/).count() === 1);
    // 只留建議那張，套用
    await p.getByLabel(/^建議保留/).tap(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: '保留 1 張，其他移到封存區' }).tap(); await p.waitForTimeout(700);
    check('apply → auto-advance to next group (1 / 6)', await p.getByText('相似照片 1 / 6').count() >= 1);

    await p.getByRole('button', { name: '都保留' }).tap(); await p.waitForTimeout(700);
    check('keep all → 1 / 5', await p.getByText('相似照片 1 / 5').count() >= 1);
    await p.getByRole('button', { name: '稍後再看' }).tap(); await p.waitForTimeout(400);
    check('later → 2 / 5', await p.getByText('相似照片 2 / 5').count() >= 1);

    await p.goBack(); await p.waitForTimeout(600);
    check('swipe screen: archive has the 2 removed photos', await p.getByLabel('封存區，2 張').count() === 1);
    check('swipe screen: 5 groups left', await p.getByLabel(/相似照片，5 組/).count() === 1);
  } catch (e) { failed++; console.log('FAIL exception', e.message); }
  console.log('console errors:', errs.length ? errs.slice(0, 5) : 'none');
  await browser.close(); srv.close();
  process.exit(failed || errs.length ? 1 : 0);
});
