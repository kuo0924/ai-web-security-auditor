// 垂直切片的端對端測試（web 預覽，假相簿）。用真的觸控事件，手機寬度 390x844。
// 用法：npx expo export -p web --output-dir /tmp/web && node e2e/slice.web.js /tmp/web <截圖輸出資料夾>
// 需要 playwright（不列在 dependencies；雲端環境已預裝）。
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const [root, out] = process.argv.slice(2);
const types = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.json':'application/json'};
const srv = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { const h = p.replace(/\/$/,'') + '.html'; p = fs.existsSync(h) ? h : path.join(root, 'index.html'); }
  res.writeHead(200, {'Content-Type': types[path.extname(p)]||'application/octet-stream'}); fs.createReadStream(p).pipe(res);
}).listen(0, async () => {
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const errs = [];
  const newPage = async (scheme='dark') => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.cdp = await ctx.newCDPSession(p);
    p.on('console', m => { if (m.type()==='error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    return p;
  };
  const step = (n, ok) => console.log((ok ? 'PASS ' : 'FAIL ') + n);
  const drag = async (p, dx, dy) => {
    // 真正的觸控事件（手機的操作方式）；滑鼠拖曳在 web 預覽不會觸發手勢
    const box = await p.getByLabel(/^照片，/).first().boundingBox();
    const x = box.x + box.width/2, y = box.y + box.height/2;
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 15; i++) { await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx*i/15, y: y + dy*i/15 }] }); await p.waitForTimeout(16); }
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(700);
  };
  const counter = async (p) => (await p.getByText(/這次已整理 \d+ 張/).textContent()).match(/\d+/)[0] | 0;
  try {
    const p = await newPage();
    await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/S06-swipe.png` });
    step('S06 shows a photo card', await p.getByLabel(/^照片，/).count() > 0);

    await drag(p, -260, 0);  // left = delete
    step('drag left → archive count 1', await p.getByLabel('封存區，1 張').count() === 1);
    await drag(p, 260, 0);   // right = keep
    step('drag right → keep (counter 2)', await counter(p) === 2);
    await drag(p, 60, 0);    // below threshold → snaps back
    step('short drag snaps back (counter still 2)', await counter(p) === 2);
    await drag(p, 0, -320);  // up = hide
    step('drag up → hide (counter 3, archive still 1)', await counter(p) === 3 && await p.getByLabel('封存區，1 張').count() === 1);
    await p.getByRole('button', { name: '刪除這張照片' }).tap(); await p.waitForTimeout(600);
    await p.getByRole('button', { name: '刪除這張照片' }).tap(); await p.waitForTimeout(600);
    step('delete button ×2 → archive 3', await p.getByLabel('封存區，3 張').count() === 1);
    await p.screenshot({ path: `${out}/S06-after-swipes.png` });
    await p.getByRole('button', { name: '復原上一張' }).tap(); await p.waitForTimeout(400);
    step('undo → archive 2', await p.getByLabel('封存區，2 張').count() === 1);

    await p.getByRole('button', { name: '封存區，2 張' }).tap(); await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/S09-archive.png` });
    step('S09 lists 2 photos', await p.getByRole('button', { name: '移除 2 張' }).count() === 1);
    await p.getByRole('button', { name: '移除 2 張' }).tap(); await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/S10-confirm.png` });
    step('S10 in-app confirm explains 30-day recovery', await p.getByText(/30 天內都能救回/).count() > 0);
    await p.getByRole('button', { name: '移除', exact: true }).tap(); await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/S11-freed.png` });
    step('S11 shows bytes and count', await p.getByText(/已移除 2 張照片/).count() === 1 && await p.getByText(/^約 [\d.]+ MB$/).count() === 1);
    await p.getByRole('button', { name: '繼續整理' }).tap(); await p.waitForTimeout(500);
    step('back on S06 with empty archive', await p.getByLabel('封存區，0 張').count() === 1);

    const d = await newPage('light');
    await d.goto(base + '/?access=denied', { waitUntil: 'networkidle' }); await d.waitForTimeout(600);
    await d.screenshot({ path: `${out}/S02-denied.png` });
    step('S02 denied shows settings button', await d.getByRole('button', { name: '前往設定' }).count() === 1);

    const q = await newPage();
    await q.goto(base + '/?access=partial', { waitUntil: 'networkidle' }); await q.waitForTimeout(600);
    await q.getByText('選更多').tap(); await q.waitForTimeout(500);
    await q.screenshot({ path: `${out}/S02-partial-sheet.png` });
    step('partial: 選更多 offers both options', await q.getByRole('button', { name: '再多選幾張' }).count() === 1 && await q.getByRole('button', { name: '允許存取全部照片' }).count() === 1);

    const e = await newPage();
    await e.goto(base + '/archive', { waitUntil: 'networkidle' }); await e.waitForTimeout(600);
    step('S09 empty state', await e.getByText('封存區是空的').count() === 1);
  } catch (err) { console.log('FAIL exception', err.message); }
  console.log('console errors:', errs.length ? errs.slice(0, 5) : 'none');
  await browser.close(); srv.close();
});
