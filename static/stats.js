const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (label, value, dim) => `<div class="flex items-baseline justify-between py-2.5 border-b hair"><span class="text-sm ${dim ? 'text-slate-500' : 'text-slate-300'}">${esc(label)}</span><span class="font-mono text-sm ${dim ? 'text-slate-500' : 'text-slate-100'} tabular-nums">${esc(value)}</span></div>`;

function bucket(b) {
  return [
    row('成功掃描', b.scans),
    row('AI 顧問（Claude / Gemini）', b.consults_llm),
    row('AI 顧問（規則模式）', b.consults_fallback, true),
    row('追問', b.followups),
    row('不重複來源 IP', b.unique_ips),
    row('平均掃描耗時', b.avg_scan_ms == null ? '—' : b.avg_scan_ms + ' ms'),
    row('被拒（授權／格式／內網）', b.scans_rejected, true),
    row('被限流', b.scans_rate_limited, true),
    row('目標連不上', b.scans_failed, true),
  ].join('');
}

function render(s) {
  $('#uptime').textContent = `上線 ${s.uptime_hours} 小時 · 自 ${new Date(s.started_at).toLocaleString('zh-TW', { hour12: false })}`;
  $('#today').innerHTML = bucket(s.today);
  $('#total').innerHTML = bucket(s.since_start);
  const g = s.since_start.grades, max = Math.max(1, ...Object.values(g));
  const color = { A: '#34d399', B: '#818cf8', C: '#fbbf24', F: '#fb7185' };
  $('#grades').innerHTML = ['A', 'B', 'C', 'F'].map(k => `<div class="flex items-center gap-3"><span class="font-serif font-bold w-5" style="color:${color[k]}">${k}</span><div class="flex-1 bg-slate-800 h-1.5"><div class="bar" style="width:${(g[k] || 0) / max * 100}%;background:${color[k]}"></div></div><span class="font-mono text-[12px] text-slate-400 w-8 text-right tabular-nums">${g[k] || 0}</span></div>`).join('');
  const p = s.since_start.top_platforms || [];
  $('#platforms').innerHTML = p.length ? p.map(([name, n]) => row(name, n)).join('') : '<div class="py-3 text-sm text-slate-600">還沒有資料</div>';
  $('#daily').innerHTML = (s.daily || []).slice().reverse().map(d => `<tr class="border-t hair text-slate-300"><td class="py-2">${esc(d.date)}</td><td class="py-2 text-right tabular-nums">${d.scans}</td><td class="py-2 text-right tabular-nums">${d.consults}</td><td class="py-2 text-right tabular-nums">${d.unique_ips}</td></tr>`).join('') || '<tr><td colspan="4" class="py-3 text-slate-600">還沒有資料</td></tr>';
  const b = s.llm_budget || {};
  $('#budget').innerHTML = row('估算花費', `$${(b.claude_usd_today ?? 0).toFixed(3)} / $${b.claude_usd_limit ?? '—'}`) + row('AI 呼叫次數（不分供應商）', `${b.used_today ?? 0} / ${b.daily_limit ?? '—'}`);
}

async function load() {
  try {
    const token = new URLSearchParams(location.search).get('token');
    const r = await fetch('/api/stats' + (token ? `?token=${encodeURIComponent(token)}` : ''));
    if (!r.ok) throw new Error(r.status === 403 ? '需要 token：在網址後面加 ?token=你的 STATS_TOKEN' : `HTTP ${r.status}`);
    render(await r.json());
    $('#error').classList.add('hidden');
  } catch (e) {
    $('#error').textContent = e.message; $('#error').classList.remove('hidden');
  }
}
load();
setInterval(load, 60000);
