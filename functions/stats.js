/**
 * GET /stats?key=<STATS_KEY>  —  Cloudflare Pages Function
 *
 * A readable page over the same counts /api/stats returns as JSON. Same guard:
 * the STATS_KEY secret, compared without an early exit, and a plain 404 for a
 * missing or wrong key so the page does not advertise that it exists.
 *
 * Optional: ?days=7|30|90|365 (default 30). "all" shows everything stored.
 *
 * Only aggregate counts exist in the database (see _lib/count.js), so only
 * aggregate counts can appear here. Nothing on this page identifies a person.
 */
import { EVENTS, TOOL_SLUGS, ensureSchema } from './_lib/count.js';

const notFound = () => new Response('Not found', {
  status: 404,
  headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
});

function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

// Our own test events that are in the table and cannot be told apart from
// real ones. Listed so the page never passes them off as customers.
const KNOWN_TESTS = [
  { day: '2026-08-28', text: '2 test purchases of the BC pack, both refunded' }
];

const WINDOWS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
                 ['365', 'Last 12 months'], ['all', 'Everything']];

function page(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY'
    }
  });
}

export async function onRequestGet({ request, env }) {
  const secret = env.STATS_KEY;
  if (!secret) return notFound();
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!sameKey(key, secret)) return notFound();

  if (!env.DB) return page('<p>No database is bound as DB in the Pages project settings.</p>');

  let win = url.searchParams.get('days') || '30';
  if (!WINDOWS.some(([v]) => v === win)) win = '30';
  const since = win === 'all' ? '0000-00-00'
    : new Date(Date.now() - parseInt(win, 10) * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  let rows = [];
  try {
    await ensureSchema(env);
    rows = (await env.DB.prepare(
      `SELECT day, name, detail, count FROM events WHERE day >= ? ORDER BY day DESC`
    ).bind(since).all()).results || [];
  } catch (err) {
    console.error('stats page: query failed', err && err.message);
    return page('<p>The query failed. Try again in a minute.</p>');
  }

  const tot = {}; const days = {}; const tools = {}; const embeds = {};
  const packs = { bc: { view: 0, click: 0, buy: 0 }, on: { view: 0, click: 0, buy: 0 } };
  for (const r of rows) {
    tot[r.name] = (tot[r.name] || 0) + r.count;
    const d = (days[r.day] = days[r.day] || {});
    d[r.name] = (d[r.name] || 0) + r.count;
    if (r.name === 'tool_used') tools[r.detail] = (tools[r.detail] || 0) + r.count;
    if (r.name === 'embed_view') embeds[r.detail] = (embeds[r.detail] || 0) + r.count;
    if (packs[r.detail]) {
      if (r.name === 'pack_view') packs[r.detail].view += r.count;
      if (r.name === 'pack_click') packs[r.detail].click += r.count;
      if (r.name === 'purchased') packs[r.detail].buy += r.count;
    }
    if ((r.name === 'pack_view' || r.name === 'pack_click' || r.name === 'purchased') && packs[r.detail]) {
      d[r.name + '_' + r.detail] = (d[r.name + '_' + r.detail] || 0) + r.count;
    }
  }
  const t = (k) => tot[k] || 0;

  const card = (n, label, note) => `<div class="card"><b>${esc(n)}</b><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>`;

  const cards = [
    card(t('tool_used'), 'calculator runs'),
    card(t('embed_view'), 'embedded views', 'on other websites'),
    card(t('pack_view'), 'pack page views'),
    card(t('pack_click'), 'checkout clicks'),
    card(t('purchased'), 'purchases', 'server-side, cannot be blocked'),
    card(t('subscribed'), 'signup form submissions', 'beehiiv is the list of record')
  ].join('');

  const funnel = `
    <table class="funnel"><tbody>
      <tr><td>Calculator run → pack page</td><td>${pct(t('pack_view'), t('tool_used'))}</td></tr>
      <tr><td>Pack page → checkout click</td><td>${pct(t('pack_click'), t('pack_view'))}</td></tr>
      <tr><td>Checkout click → purchase</td><td>${pct(t('purchased'), t('pack_click'))}</td></tr>
      <tr><td>Calculator run → purchase</td><td>${pct(t('purchased'), t('tool_used'))}</td></tr>
      <tr><td>Calculator run → signup</td><td>${pct(t('subscribed'), t('tool_used'))}</td></tr>
    </tbody></table>`;

  const packTable = `
    <table><thead><tr><th>Pack</th><th>Page views</th><th>Checkout clicks</th><th>Purchases</th><th>View → click</th></tr></thead><tbody>
      ${[['bc', 'BC Strata Board Starter Pack'], ['on', 'Ontario Condo Board Starter Pack']].map(([k, label]) =>
        `<tr><td>${label}</td><td>${packs[k].view}</td><td>${packs[k].click}</td><td>${packs[k].buy}</td><td>${pct(packs[k].click, packs[k].view)}</td></tr>`).join('')}
    </tbody></table>`;

  const allTools = [...TOOL_SLUGS].sort((a, b) => (tools[b] || 0) - (tools[a] || 0) || a.localeCompare(b));
  const toolTable = `
    <table><thead><tr><th>Calculator</th><th>Province</th><th>Runs</th><th>Embedded views</th></tr></thead><tbody>
      ${allTools.map((s) => `<tr class="${tools[s] || embeds[s] ? '' : 'zero'}"><td><a href="/${esc(s)}" rel="noopener">/${esc(s)}</a></td><td>${s.startsWith('bc/') ? 'BC' : 'ON'}</td><td>${tools[s] || 0}</td><td>${embeds[s] || 0}</td></tr>`).join('')}
    </tbody></table>`;

  const dayKeys = Object.keys(days).sort().reverse();
  const g = (d, k) => d[k] || 0;
  const dayTable = dayKeys.length ? `
    <table><thead><tr><th>Day (UTC)</th><th>Runs</th><th>Embedded</th><th>Pack views BC</th><th>Pack views ON</th><th>Clicks BC</th><th>Clicks ON</th><th>Purchases</th><th>Signups</th></tr></thead><tbody>
      <tr class="all"><td>All days</td><td>${t('tool_used')}</td><td>${t('embed_view')}</td><td>${packs.bc.view}</td><td>${packs.on.view}</td><td>${packs.bc.click}</td><td>${packs.on.click}</td><td>${t('purchased')}</td><td>${t('subscribed')}</td></tr>
      ${dayKeys.map((k) => { const d = days[k]; return `<tr><td>${esc(k)}</td><td>${g(d, 'tool_used')}</td><td>${g(d, 'embed_view')}</td><td>${g(d, 'pack_view_bc')}</td><td>${g(d, 'pack_view_on')}</td><td>${g(d, 'pack_click_bc')}</td><td>${g(d, 'pack_click_on')}</td><td>${g(d, 'purchased')}</td><td>${g(d, 'subscribed')}</td></tr>`; }).join('')}
    </tbody></table>` : '<p class="muted">Nothing recorded in this window.</p>';

  const tests = KNOWN_TESTS.filter((x) => x.day >= since)
    .map((x) => `<li>${esc(x.day)}: ${esc(x.text)}</li>`).join('');

  const k = encodeURIComponent(key);
  const nav = WINDOWS.map(([v, label]) =>
    v === win ? `<b>${label}</b>` : `<a href="/stats?key=${k}&amp;days=${v}">${label}</a>`).join(' · ');

  return page(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Know Your Strata usage</title>
<style>
:root{--bg:#e9ecea;--card:#fff;--ink:#16323a;--muted:#55666b;--line:#dde3e1;--accent:#1f5f5b}
@media (prefers-color-scheme:dark){:root{--bg:#121a1c;--card:#1b2629;--ink:#e3ecea;--muted:#9aaeb0;--line:#2b3a3d;--accent:#7cc4bc}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left)) 48px}
h1{margin:0 0 4px;font-size:1.9rem}h2{font-size:1.1rem;margin:32px 0 10px}
.muted,small{color:var(--muted)}nav{margin:14px 0 18px;color:var(--muted)}nav a{color:var(--accent)}
.cards{display:flex;flex-wrap:wrap;gap:12px}.card{background:var(--card);border-radius:8px;padding:14px 16px;min-width:150px;display:flex;flex-direction:column}
.card b{font-size:1.6rem}.card small{font-size:.78rem}
.wrap{overflow-x:auto;background:var(--card);border-radius:8px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{font-size:.82rem;color:var(--muted);font-weight:600}
tr.all td{font-weight:700}tr.zero td{color:var(--muted)}td a{color:var(--accent);text-decoration:none}
.narrow{max-width:460px}ul{margin:6px 0;padding-left:20px}
</style></head><body><main>
<h1>Know Your Strata usage</h1>
<p class="muted">Anonymous daily counts only. No visitor, IP, cookie or device is stored, so these are events, not people. Our own test runs are included.</p>
<nav>${nav}</nav>
<p class="muted">${win === 'all' ? 'Everything stored' : esc(since) + ' to ' + esc(today)} (UTC days)</p>
<div class="cards">${cards}</div>
<h2>Funnel</h2><div class="wrap narrow">${funnel}</div>
<h2>Starter packs</h2><div class="wrap">${packTable}</div>
<h2>By day</h2><div class="wrap">${dayTable}</div>
<h2>Calculators</h2><div class="wrap">${toolTable}</div>
${tests ? `<h2>Known test events in this window</h2><ul class="muted">${tests}</ul>` : ''}
<h2>What each count means</h2><ul class="muted">${Object.entries(EVENTS).map(([n, d]) => `<li><code>${esc(n)}</code>: ${esc(d)}</li>`).join('')}</ul>
<p class="muted">JSON version: <code>/api/stats?key=…&amp;days=30</code></p>
</main></body></html>`);
}
