// ------------------------------------------------------------------
// 狀態與工具
// ------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const els = {
  form: $('#scan-form'), url: $('#url'), auth: $('#auth'), submit: $('#submit'), progress: $('#progress'),
  loading: $('#loading'), loadingText: $('#loading-text'), error: $('#error'), results: $('#results'),
  score: $('#score'), scoreBar: $('#score-bar'), grade: $('#grade'), gradeLabel: $('#grade-label'), statusChip: $('#status-chip'),
  reportTime: $('#report-time'), finalUrl: $('#final-url'), tech: $('#tech'), stats: $('#stats'), notes: $('#notes'),
  issues: $('#issues'), issuesCount: $('#issues-count'), passed: $('#passed'), details: $('#details'),
  aiLoading: $('#ai-loading'), aiContent: $('#ai-content'), aiProvider: $('#ai-provider'), aiRegenerate: $('#ai-regenerate'),
  chat: $('#chat'), chatInput: $('#chat-input'), chatSend: $('#chat-send'),
  download: $('#download'), rescan: $('#rescan'), toast: $('#toast'), llmBadge: $('#llm-badge'),
  sample: $('#sample'), share: $('#share'), print: $('#print'), banner: $('#banner'), compare: $('#compare'),
  history: $('#history'), historyList: $('#history-list'), snippets: $('#snippets'), snippetsSection: $('#snippets-section'),
  paths: $('#paths'), autoPaths: $('#auto-paths'), badgeBtn: $('#badge-btn'), badgeBox: $('#badge-box'), badgeImg: $('#badge-img'), badgeMd: $('#badge-md'), badgeHtml: $('#badge-html'),
};
// mode: live（剛掃描）| sample（範例）| shared（別人分享的連結）
const state = { scan: null, consult: null, history: [], busy: false, mode: 'live' };

const TIPS = [
  '解析網域，確認為公開 IP', '檢查 HTTPS 是否強制導向', '讀取 HTTP 安全標頭', '分析 Cookie 的 HttpOnly / Secure 屬性',
  '掃描站內 JS 是否夾帶 API 金鑰', '確認 /.env 與 /.git/config 沒有裸露', '辨識技術棧', '規則引擎計分',
];
const GRADE = {
  A: { text: 'text-emerald-300', bar: '#34d399' },
  B: { text: 'text-indigo-300', bar: '#818cf8' },
  C: { text: 'text-amber-300', bar: '#fbbf24' },
  F: { text: 'text-rose-300', bar: '#fb7185' },
};
const SEV = {
  critical: { label: 'CRITICAL', dot: 'bg-rose-400', text: 'text-rose-300' },
  high:     { label: 'HIGH',     dot: 'bg-orange-400', text: 'text-orange-300' },
  medium:   { label: 'MEDIUM',   dot: 'bg-amber-400', text: 'text-amber-300' },
  low:      { label: 'LOW',      dot: 'bg-sky-400', text: 'text-sky-300' },
  info:     { label: 'ADVISORY', dot: 'bg-slate-500', text: 'text-slate-400' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (el, on = true) => el.classList.toggle('hidden', !on);

let errorTimer = null;
function showError(msg) { clearInterval(errorTimer); els.error.textContent = msg; show(els.error, true); }
function clearError() { clearInterval(errorTimer); els.error.textContent = ''; show(els.error, false); }
// 429 顯示倒數、502 附上排查提示，其他照原文
function showScanError(e) {
  const msg = e.message || '檢測失敗';
  if (e.status === 429) {
    let left = e.retryAfter || (Number((msg.match(/(\d+)\s*秒/) || [])[1]) || 60);
    const base = msg.replace(/，請\s*\d+\s*秒後再試/, '');
    const tick = () => { els.error.textContent = left > 0 ? `${base}，${left} 秒後可以再掃` : `${base}，現在可以再掃了`; if (left <= 0) clearInterval(errorTimer); left -= 1; };
    clearInterval(errorTimer); tick(); errorTimer = setInterval(tick, 1000); show(els.error, true);
    return;
  }
  if (e.status === 502) {
    showError(msg + '。請確認網址沒有打錯、網站對外開放且不需登入；本工具無法檢測內網、本機或只在特定地區開放的網站。');
    return;
  }
  showError(msg);
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('opacity-0', 'translate-y-3');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('opacity-0', 'translate-y-3'), 1500);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('已複製到剪貼簿');
}

function providerLabel(c) {
  if (!c) return '';
  if (c.mode === 'llm') return (c.provider === 'openai' ? 'openai-compatible' : 'anthropic') + ' · ' + (c.model || '');
  return 'offline · rules';
}

function fmtTime(iso) {
  try { const d = new Date(iso); return d.toLocaleString('zh-TW', { hour12: false }); } catch { return iso; }
}

// ------------------------------------------------------------------
// 表單與載入狀態
// ------------------------------------------------------------------
function syncSubmit() { els.submit.disabled = state.busy || !els.auth.checked || !els.url.value.trim(); }
els.url.addEventListener('input', syncSubmit);
els.auth.addEventListener('change', syncSubmit);

let tipTimer = null;
function setLoading(on) {
  state.busy = on; syncSubmit();
  show(els.loading, on); show(els.progress, on);
  clearInterval(tipTimer);
  if (on) {
    let i = Math.floor(Math.random() * TIPS.length);
    els.loadingText.textContent = TIPS[i];
    tipTimer = setInterval(() => { i = (i + 1) % TIPS.length; els.loadingText.textContent = TIPS[i]; }, 1300);
  }
}

// ------------------------------------------------------------------
// Cloudflare Turnstile（後端有設 secret 才會啟用；用 execute 模式，只在送出時取 token）
// ------------------------------------------------------------------
const ts = { siteKey: '', widgetId: null, pending: null };
function initTurnstile(siteKey) {
  ts.siteKey = siteKey;
  window.onTurnstileLoad = () => {
    ts.widgetId = turnstile.render('#turnstile', {
      sitekey: siteKey, theme: 'dark', size: 'flexible', execution: 'execute', appearance: 'interaction-only',
      callback: (token) => { if (ts.pending) { ts.pending.resolve(token); ts.pending = null; } },
      'error-callback': () => { if (ts.pending) { ts.pending.reject(new Error('人機驗證失敗，請重新整理')); ts.pending = null; } },
      'expired-callback': () => {},
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
  s.async = true; document.head.appendChild(s);
}
function getTurnstileToken() {
  if (!ts.siteKey) return Promise.resolve(null);
  if (ts.widgetId === null) return Promise.reject(new Error('人機驗證尚未載入，請稍候再試'));
  return new Promise((resolve, reject) => {
    ts.pending = { resolve, reject };
    setTimeout(() => { if (ts.pending) { ts.pending.reject(new Error('人機驗證逾時，請重新整理')); ts.pending = null; } }, 30000);
    try { turnstile.reset(ts.widgetId); turnstile.execute(ts.widgetId); } catch (e) { ts.pending = null; reject(e); }
  });
}

async function postJSON(path, body) {
  if (ts.siteKey && (path === '/api/scan' || path === '/api/ai-consult')) body = { ...body, turnstile_token: await getTurnstileToken() };
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('；') : `HTTP ${res.status}`);
    const err = new Error(detail); err.status = res.status; err.retryAfter = Number(res.headers.get('Retry-After')) || null;
    throw err;
  }
  return data;
}

function resetReportUI() {
  state.history = []; els.chat.innerHTML = '';
  show(els.banner, false); show(els.compare, false); show(els.badgeBox, false);
  if (location.hash.startsWith('#r=')) history.replaceState(null, '', location.pathname);
}

els.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const url = els.url.value.trim();
  if (!url) return;
  if (!els.auth.checked) { showError('請先勾選授權聲明'); return; }
  clearError(); show(els.results, false); setLoading(true); resetReportUI();
  try {
    const paths = els.paths.value.split(',').map((p) => p.trim()).filter((p) => p.startsWith('/') && p !== '/').slice(0, 5);
    const data = await postJSON('/api/scan', { url, authorized: true, paths, auto_paths: !!(els.autoPaths && els.autoPaths.checked) });
    state.scan = data; state.consult = null; state.mode = 'live';
    const prev = findHistory(data.target.hostname);
    renderResult(data);
    renderCompare(data, prev);
    recordHistory(data);
    consultAI();
  } catch (e) {
    showScanError(e);
  } finally {
    setLoading(false);
  }
});

// ------------------------------------------------------------------
// 範例報告、分享連結、列印
// ------------------------------------------------------------------
els.sample.addEventListener('click', async () => {
  clearError(); show(els.results, false); resetReportUI();
  try {
    const s = await (await fetch('/api/sample')).json();
    state.scan = s.scan; state.consult = s.ai_consult || null; state.mode = 'sample';
    els.banner.textContent = '範例報告 · ' + (s.note || 'demo-shop.vercel.app 為虛構網站') + ' · 想看自己的網站，回到上面輸入網址';
    show(els.banner, true);
    renderResult(s.scan);
    if (state.consult) { renderConsult(state.consult); show(els.aiRegenerate, false); } else consultAI();
  } catch (e) { showError('範例載入失敗：' + e.message); }
});

const b64u = {
  enc: (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
async function packReport(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (!('CompressionStream' in window)) return 'j' + b64u.enc(bytes);
  const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(bytes); w.close();
  return 'z' + b64u.enc(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
}
async function unpackReport(s) {
  const data = b64u.dec(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(data));
  const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(data); w.close();
  return JSON.parse(new TextDecoder().decode(await new Response(ds.readable).arrayBuffer()));
}

els.share.addEventListener('click', async () => {
  if (!state.scan) return;
  try {
    const packed = await packReport({ v: 1, scan: state.scan, ai_consult: state.consult });
    const link = location.origin + location.pathname + '#r=' + packed;
    await copyText(link);
    toast(`分享連結已複製（${(link.length / 1024).toFixed(1)} KB，報告內容都在連結裡，不經伺服器儲存）`);
  } catch (e) { toast('產生連結失敗：' + e.message); }
});

async function loadShared(packed) {
  try {
    const p = await unpackReport(packed);
    if (!p || !p.scan || !p.scan.target) throw new Error('格式不符');
    state.scan = p.scan; state.consult = p.ai_consult || null; state.mode = 'shared';
    els.banner.textContent = `分享的報告 · ${p.scan.target.hostname} · 掃描於 ${fmtTime(p.scan.scanned_at)} · 結果可能已過時，想看最新請重新檢測`;
    show(els.banner, true);
    renderResult(p.scan);
    if (state.consult) { renderConsult(state.consult); show(els.aiRegenerate, true); }
    else { show(els.aiLoading, false); els.aiContent.innerHTML = '<div class="text-sm text-slate-500">這份分享沒有附 AI 顧問分析。</div>'; show(els.aiContent, true); show(els.aiRegenerate, true); }
  } catch (e) { showError('分享連結無法讀取：' + e.message); }
}

els.print.addEventListener('click', () => {
  document.querySelectorAll('#results details').forEach((d) => { d.open = true; });
  window.print();
});

els.badgeBtn.addEventListener('click', () => {
  if (!state.scan) return;
  const host = state.scan.target.hostname;
  const img = `${location.origin}/badge/${host}.svg`;
  const link = `${location.origin}/?url=${encodeURIComponent(host)}`;
  els.badgeImg.src = img + '?t=' + Date.now();
  els.badgeMd.textContent = `[![Web Security](${img})](${link})`;
  els.badgeHtml.textContent = `<a href="${link}"><img src="${img}" alt="Web Security Audit" height="20"></a>`;
  els.badgeBox.classList.toggle('hidden');
  if (state.mode === 'sample') toast('範例網站是虛構的，徽章只會顯示 not scanned');
});

// ------------------------------------------------------------------
// 歷史紀錄與重掃比較（只存在這台瀏覽器）
// ------------------------------------------------------------------
const HISTORY_KEY = 'wsa_history_v1';
function readHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function findHistory(host) { return readHistory().find((h) => h.host === host) || null; }
function recordHistory(r) {
  try {
    const entry = {
      host: r.target.hostname, url: r.target.input_url, score: r.score, grade: r.grade, at: r.scanned_at,
      issues: r.issues.filter((i) => i.penalty > 0).map((i) => ({ id: i.id, title: i.title })),
    };
    const list = [entry, ...readHistory().filter((h) => h.host !== entry.host)].slice(0, 12);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {}
  renderHistory();
}
function renderHistory() {
  const list = readHistory();
  show(els.history, list.length > 0);
  els.historyList.innerHTML = list.map((h) => {
    const g = GRADE[h.grade] || GRADE.F;
    return `<button type="button" data-url="${esc(h.url)}" class="font-mono text-[11px] px-2.5 py-1 border hair rounded-sm text-slate-300 hover:border-slate-500"><span class="font-bold" style="color:${g.bar}">${esc(h.grade)} ${h.score}</span> · ${esc(h.host)}</button>`;
  }).join('');
}
els.historyList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-url]'); if (!b) return;
  els.url.value = b.dataset.url; syncSubmit(); els.url.focus();
});
function renderCompare(r, prev) {
  if (!prev) { show(els.compare, false); return; }
  const cur = new Set(r.issues.filter((i) => i.penalty > 0).map((i) => i.id));
  const fixed = prev.issues.filter((i) => !cur.has(i.id));
  const prevIds = new Set(prev.issues.map((i) => i.id));
  const added = r.issues.filter((i) => i.penalty > 0 && !prevIds.has(i.id));
  const delta = r.score - prev.score;
  const deltaText = delta === 0 ? '沒有變化' : `<span class="${delta > 0 ? 'text-emerald-300' : 'text-rose-300'}">${delta > 0 ? '+' : ''}${delta}</span>`;
  els.compare.innerHTML = `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span class="kicker" style="letter-spacing:.08em">與上次比較</span><span class="font-mono text-[12px] text-slate-500">${esc(fmtTime(prev.at))}</span></div>
    <div class="mt-1 font-mono text-sm text-slate-200">${prev.score} ${esc(prev.grade)} → ${r.score} ${esc(r.grade)}（${deltaText}）</div>
    ${fixed.length ? `<div class="mt-2 text-sm text-emerald-300">已修好：${fixed.map((i) => esc(i.title)).join('、')}</div>` : ''}
    ${added.length ? `<div class="mt-1 text-sm text-rose-300">新出現：${added.map((i) => esc(i.title)).join('、')}</div>` : ''}
    ${!fixed.length && !added.length ? '<div class="mt-1 text-sm text-slate-500">扣分項目和上次相同</div>' : ''}`;
  show(els.compare, true);
}

els.rescan.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); els.url.focus(); });
els.download.addEventListener('click', () => {
  if (!state.scan) return;
  const blob = new Blob([JSON.stringify({ scan: state.scan, ai_consult: state.consult }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `security-report-${state.scan.target.hostname}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ------------------------------------------------------------------
// 結果渲染
// ------------------------------------------------------------------
function animateScore(target) {
  const start = performance.now(), dur = 800;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    els.score.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderResult(r) {
  const g = GRADE[r.grade] || GRADE.F;
  animateScore(r.score);
  els.scoreBar.style.width = '0%';
  els.scoreBar.style.backgroundColor = g.bar;
  requestAnimationFrame(() => requestAnimationFrame(() => { els.scoreBar.style.width = r.score + '%'; }));
  els.grade.textContent = r.grade;
  els.grade.className = `font-serif text-3xl font-bold leading-none ${g.text}`;
  els.gradeLabel.textContent = r.grade_label;
  els.statusChip.textContent = `HTTP ${r.target.status_code}`;
  els.finalUrl.textContent = r.target.final_url;
  els.finalUrl.href = r.target.final_url;
  els.reportTime.textContent = fmtTime(r.scanned_at);

  const stack = r.tech?.stack || [];
  els.tech.innerHTML = stack.length
    ? stack.map(s => `<span class="font-mono text-[12px] px-2 py-1 border hair rounded-sm text-slate-300">${esc(s)}</span>`).join('')
    : '<span class="font-mono text-[12px] text-slate-600">未偵測到明確的框架特徵</span>';

  const penalized = r.issues.filter(i => i.penalty > 0);
  const stat = (v, l) => `<div class="py-3 px-4 first:pl-0"><div class="font-mono text-xl text-slate-100 tabular-nums">${esc(v)}</div><div class="kicker mt-1" style="letter-spacing:.08em">${esc(l)}</div></div>`;
  els.stats.innerHTML = stat(penalized.length, '扣分項目') + stat(r.passed.length, '通過項目') + stat(`${r.details.total_ms} ms`, `總耗時 · 引擎 ${r.details.engine_ms} ms`);

  const notes = r.details.notes || [];
  els.notes.innerHTML = notes.map(n => `<div>! ${esc(n)}</div>`).join('');
  show(els.notes, notes.length > 0);

  els.issuesCount.textContent = penalized.length ? `${penalized.length} 項扣分 · ${r.issues.length - penalized.length} 項建議` : '沒有扣分項目';
  els.issues.innerHTML = r.issues.length ? r.issues.map((it, idx) => issueRow(it, idx)).join('') :
    '<div class="py-8 text-sm text-emerald-300">所有硬規則檢查都通過，基礎防線完整。</div>';

  els.passed.innerHTML = r.passed.map(p => `
    <div class="grid sm:grid-cols-12 gap-2 sm:gap-6 py-3.5 border-b hair">
      <div class="sm:col-span-4 flex items-start gap-3 text-sm text-slate-200"><span class="font-mono text-emerald-400">✓</span>${esc(p.title)}</div>
      <div class="sm:col-span-8 font-mono text-[12px] text-slate-500 break-words leading-relaxed">${esc(p.detail)}</div>
    </div>`).join('');

  renderDetails(r);
  renderSnippets(r);
  show(els.results, true);
  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 修復 Prompt 的 👍👎：只送 kind + id + 方向，每個項目每個瀏覽器只投一次（localStorage 記住）
const voteKey = (kind, id) => `fb:${kind}:${id}`;
function votedFor(kind, id) { try { return localStorage.getItem(voteKey(kind, id)); } catch { return null; } }
function voteButtons(kind, id) {
  const v = votedFor(kind, id);
  const b = (vote, glyph, title) => `<button type="button" data-vote="${vote}" data-kind="${kind}" data-id="${esc(id)}" title="${title}" aria-label="${title}" aria-pressed="${v === vote}" class="vote${v === vote ? ' vote-on' : ''}" ${v ? 'disabled' : ''}>${glyph}</button>`;
  return `<span class="inline-flex gap-1" data-vote-group>${b('up', '👍', '這段有幫助')}${b('down', '👎', '這段沒幫助')}</span>`;
}

function renderSnippets(r) {
  const list = r.config_snippets || [];
  show(els.snippetsSection, list.length > 0);
  els.snippets.innerHTML = list.map((s, i) => `
    <details class="border-b hair" ${i === 0 ? 'open' : ''}>
      <summary class="py-4 flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-slate-200"><span class="chev font-mono text-slate-600 mr-2">›</span>${esc(s.title)} <span class="font-mono text-[11px] text-slate-500 ml-2">${esc(s.filename)}</span></span>
        <span class="shrink-0 inline-flex items-center gap-2">${voteButtons('snippet', s.filename)}<button data-copy="snippet" data-index="${i}" class="font-mono text-[11px] px-3 py-1.5 border hair rounded-sm text-slate-300 hover:border-indigo-400 hover:text-indigo-200">COPY</button></span>
      </summary>
      <pre class="mb-3 font-mono text-[12px] text-slate-300 leading-relaxed border hair rounded p-4 bg-slate-950/60">${esc(s.content)}</pre>
      ${s.note ? `<p class="pb-4 text-[12px] text-slate-500">${esc(s.note)}</p>` : ''}
    </details>`).join('');
}

function issueRow(it, idx) {
  const s = SEV[it.severity] || SEV.info;
  const n = String(idx + 1).padStart(2, '0');
  return `
    <article class="grid md:grid-cols-12 gap-4 md:gap-8 py-7 border-b hair">
      <div class="md:col-span-3 font-mono text-[11px] space-y-2">
        <div class="text-slate-600">${n}</div>
        <div class="flex items-center gap-2 ${s.text}"><span class="w-1.5 h-1.5 rounded-full ${s.dot}"></span>${s.label}</div>
        <div class="text-slate-500">${esc(it.category)}</div>
        <div class="text-slate-300 tabular-nums">${it.penalty > 0 ? `−${it.penalty}` : '±0'}</div>
      </div>
      <div class="md:col-span-9 min-w-0">
        <h3 class="text-lg font-medium text-slate-50">${esc(it.title)}</h3>
        <p class="mt-2 text-sm text-slate-400 leading-relaxed max-w-2xl">${esc(it.description)}</p>
        ${it.evidence ? `<div class="mt-4 font-mono text-[12px] text-slate-400 border-l-2 hair pl-3 break-all leading-relaxed">${esc(it.evidence)}</div>` : ''}
        <div class="mt-5 flex flex-wrap items-center gap-4">
          <button data-copy="issue" data-index="${idx}" class="rounded px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-400 text-white">複製修復 Prompt</button>
          ${voteButtons('issue', it.id)}
          <details class="w-full">
            <summary class="font-mono text-[12px] text-slate-500 hover:text-slate-300"><span class="chev">›</span> 檢視 Prompt 內容</summary>
            <pre class="mt-3 font-mono text-[12px] text-slate-300 leading-relaxed border hair rounded p-4 bg-slate-950/60">${esc(it.fix_prompt)}</pre>
          </details>
        </div>
      </div>
    </article>`;
}

function renderDetails(r) {
  const chain = r.details.redirect_chain || [];
  const rows = Object.entries(r.headers || {}).map(([k, v]) => `
    <tr class="border-t hair"><td class="py-2 pr-6 font-mono text-[12px] text-slate-500 whitespace-nowrap align-top">${esc(k)}</td>
    <td class="py-2 font-mono text-[12px] break-all ${v ? 'text-slate-300' : 'text-slate-700'}">${v ? esc(v) : '—'}</td></tr>`).join('');
  els.details.innerHTML = `
    <div><div class="kicker mb-2">轉址鏈</div>${chain.length ? chain.map(h => `<div class="font-mono text-[12px] break-all text-slate-400">${esc(h.from)} <span class="text-slate-600">→ ${h.status} →</span> ${esc(h.to)}</div>`).join('') : '<div class="font-mono text-[12px] text-slate-600">無轉址</div>'}</div>
    <div><div class="kicker mb-2">掃描的站內 JS · 最多 2 個</div>${(r.details.js_files_scanned || []).length ? r.details.js_files_scanned.map(u => `<div class="font-mono text-[12px] break-all text-slate-400">${esc(u)}</div>`).join('') : '<div class="font-mono text-[12px] text-slate-600">首頁沒有引用站內 JS，只掃描了 HTML</div>'}</div>
    <div class="font-mono text-[12px] text-slate-600">${r.details.requests_made} 個 GET 請求（不含公開 DNS 查詢） · 首頁 HTML ${(r.details.html_bytes / 1024).toFixed(1)} KB · ${esc(r.scanned_at)}</div>
    <div><div class="kicker mb-2">安全相關回應標頭</div><div class="overflow-x-auto"><table class="w-full">${rows}</table></div></div>`;
}

// ------------------------------------------------------------------
// 顧問
// ------------------------------------------------------------------
async function consultAI() {
  if (!state.scan) return;
  show(els.aiLoading, true); show(els.aiContent, false); show(els.aiRegenerate, false);
  els.aiProvider.textContent = 'generating…';
  try {
    const c = await postJSON('/api/ai-consult', { scan: state.scan });
    state.consult = c;
    renderConsult(c);
  } catch (e) {
    state.consult = null;
    els.aiContent.innerHTML = `<div class="text-sm text-rose-300">顧問呼叫失敗：${esc(e.message)}</div>`;
    els.aiProvider.textContent = 'failed';
    show(els.aiLoading, false); show(els.aiContent, true);
  }
  show(els.aiRegenerate, true);
}
els.aiRegenerate.addEventListener('click', consultAI);

function renderConsult(c) {
  els.aiProvider.textContent = providerLabel(c);
  const riskText = { '低': 'text-emerald-300', '中': 'text-amber-300', '高': 'text-orange-300', '危急': 'text-rose-300' }[c.risk_level] || 'text-slate-300';
  els.aiContent.innerHTML = `
    ${c.note ? `<div class="font-mono text-[11px] text-amber-300/90 border-l-2 border-amber-500/40 pl-3">${esc(c.note)}</div>` : ''}
    <div class="grid md:grid-cols-12 gap-6">
      <div class="md:col-span-3 font-mono text-[11px] space-y-2">
        <div class="text-slate-600">30 秒診斷</div>
        <div class="${riskText}">風險 · ${esc(c.risk_level || '—')}</div>
      </div>
      <div class="md:col-span-9">
        <p class="font-serif text-lg leading-relaxed text-slate-100">${esc(c.summary)}</p>
        ${c.stack_note ? `<p class="mt-3 font-mono text-[12px] text-slate-500">${esc(c.stack_note)}</p>` : ''}
      </div>
    </div>
    ${(c.priority_actions || []).length ? `
    <div class="grid md:grid-cols-12 gap-6 pt-6 rule">
      <div class="md:col-span-3 font-mono text-[11px] text-slate-600">優先行動</div>
      <ol class="md:col-span-9 space-y-3">${c.priority_actions.map((a, i) => `<li class="flex gap-4 text-sm text-slate-300"><span class="font-mono text-[12px] text-indigo-300 pt-0.5">${String(i + 1).padStart(2, '0')}</span><span>${esc(a)}</span></li>`).join('')}</ol>
    </div>` : ''}
    ${(c.fix_prompts || []).length ? `
    <div class="grid md:grid-cols-12 gap-6 pt-6 rule">
      <div class="md:col-span-3 font-mono text-[11px] text-slate-600">架構專屬修復 Prompt</div>
      <div class="md:col-span-9 border-t hair">${c.fix_prompts.map((fp, i) => `
        <details class="border-b hair">
          <summary class="py-3 flex items-center justify-between gap-4">
            <span class="text-sm text-slate-200"><span class="chev font-mono text-slate-600 mr-2">›</span>${esc(fp.title || fp.issue_id)}</span>
            <span class="shrink-0 inline-flex items-center gap-2">${voteButtons('ai', (fp.issue_ids || [fp.issue_id || 'general']).join('+'))}<button data-copy="ai" data-index="${i}" class="font-mono text-[11px] px-3 py-1.5 border hair rounded-sm text-slate-300 hover:border-indigo-400 hover:text-indigo-200">COPY</button></span>
          </summary>
          <pre class="pb-4 font-mono text-[12px] text-slate-400 leading-relaxed">${esc(fp.prompt)}</pre>
        </details>`).join('')}</div>
    </div>` : ''}`;
  show(els.aiLoading, false); show(els.aiContent, true);
}

// 極簡 Markdown：程式碼區塊、行內程式碼、粗體、條列、標題降級為粗體行。先做 HTML 逸出，再套樣式。
function renderMd(src) {
  const parts = String(src ?? '').split(/```[a-zA-Z]*\n?/);
  return parts.map((seg, i) => {
    if (i % 2 === 1) return `<pre class="my-2 font-mono text-[12px] text-slate-300 border hair rounded p-3 bg-slate-950/60">${esc(seg.replace(/\n$/, ''))}</pre>`;
    return esc(seg)
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong class="text-slate-50">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-50">$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code class="font-mono text-[12px] px-1 py-0.5 rounded bg-slate-800 text-indigo-200">$1</code>')
      .replace(/^(\s*)[-*]\s+/gm, '$1· ')
      .replace(/\n{3,}/g, '\n\n');
  }).join('');
}

function appendChat(role, text) {
  const mine = role === 'user';
  const div = document.createElement('div');
  div.className = 'grid md:grid-cols-12 gap-3 md:gap-6';
  div.innerHTML = `<div class="md:col-span-3 font-mono text-[11px] ${mine ? 'text-slate-500' : 'text-indigo-300'}">${mine ? '你' : '顧問'}</div>
    <div class="md:col-span-9 text-sm leading-relaxed whitespace-pre-wrap ${mine ? 'text-slate-300' : 'text-slate-100'}">${mine ? esc(text) : renderMd(text)}</div>`;
  els.chat.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return div;
}

async function sendFollowUp() {
  const q = els.chatInput.value.trim();
  if (!q || !state.scan || els.chatSend.disabled) return;
  els.chatInput.value = ''; els.chatSend.disabled = true;
  appendChat('user', q);
  const pending = appendChat('assistant', '…');
  try {
    const r = await postJSON('/api/ai-consult', { scan: state.scan, question: q, history: state.history.slice(-10) });
    pending.remove();
    appendChat('assistant', r.answer);
    state.history.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
  } catch (e) {
    pending.remove();
    appendChat('assistant', `發生錯誤：${e.message}`);
  } finally {
    els.chatSend.disabled = false; els.chatInput.focus();
  }
}
els.chatSend.addEventListener('click', sendFollowUp);
els.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp(); } });

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  e.preventDefault();
  const i = Number(btn.dataset.index);
  if (btn.dataset.copy === 'issue' && state.scan) copyText(state.scan.issues[i].fix_prompt);
  if (btn.dataset.copy === 'ai' && state.consult) copyText(state.consult.fix_prompts[i].prompt);
  if (btn.dataset.copy === 'snippet' && state.scan) copyText(state.scan.config_snippets[i].content);
  if (btn.dataset.copy === 'badge-md') copyText(els.badgeMd.textContent);
  if (btn.dataset.copy === 'badge-html') copyText(els.badgeHtml.textContent);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-vote]');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  const { vote, kind, id } = btn.dataset;
  btn.closest('[data-vote-group]').querySelectorAll('button').forEach((b) => { b.disabled = true; });
  btn.classList.add('vote-on'); btn.setAttribute('aria-pressed', 'true');
  try { localStorage.setItem(voteKey(kind, id), vote); } catch { /* 無痕模式 */ }
  if (state.mode === 'sample') { toast('範例報告的回饋不會送出'); return; }
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, issue_id: id, vote }) });
    toast(r.ok ? '感謝回饋，會用來改進修復 Prompt' : `回饋沒送出（HTTP ${r.status}）`);
  } catch { toast('回饋沒送出，請稍後再試'); }
});

renderHistory();
const prefill = new URLSearchParams(location.search).get('url');
if (prefill) { els.url.value = prefill.slice(0, 500); syncSubmit(); els.url.focus(); }
if (location.hash.startsWith('#r=')) loadShared(location.hash.slice(3));
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#r=')) { resetReportUI(); loadShared(location.hash.slice(3)); } });

fetch('/api/stats').then(r => r.ok ? r.json() : null).then(s => {
  if (!s || !s.since_start || !s.since_start.scans) return;
  const el = $('#usage-line');
  el.textContent = ` · 已體檢 ${s.since_start.scans} 個網站（今日 ${s.today.scans}）`;
  el.classList.remove('hidden');
}).catch(() => {});

fetch('/api/health').then(r => r.json()).then(h => {
  if (h.turnstile_site_key) initTurnstile(h.turnstile_site_key);
  const on = h.llm_provider && h.llm_provider !== 'none';
  els.llmBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${on ? 'bg-indigo-400' : 'bg-slate-600'}"></span>ADVISOR ${on ? esc(h.llm_model || h.llm_provider).toUpperCase() : 'OFFLINE'}`;
}).catch(() => { els.llmBadge.textContent = 'ADVISOR ?'; });
