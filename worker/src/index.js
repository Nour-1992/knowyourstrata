/**
 * Legislative-Change Watcher (BC + Ontario) -- detect & alert only.
 *
 * Weekly, this Worker fetches the specific sources the live tools on
 * knowyourstrata.com actually cite (see sources.js) -- the BC Act,
 * Regulation and Standard Bylaws pages, and the Ontario e-Laws currency
 * date plus the consolidation-version lists for the Condominium Act, 1998
 * and O. Reg. 48/01 -- compares each against what it saw last time, and
 * records what changed. It never edits any tool page, pack, or site copy
 * -- a detected change is a signal that a normal brief -> build ->
 * primary-source-verify -> ship pass is due, not something this Worker
 * acts on itself.
 *
 * Required Cloudflare setup (dashboard, not this repo):
 *   - KV namespace bound as WATCHER_KV (see wrangler.toml for the id).
 *   - A Secrets Store secret bound as WATCHER_STATUS_SECRET -- any long
 *     random string, used to gate /status and /run so this internal page
 *     isn't open to anyone who finds the workers.dev URL.
 *
 *     This must be a Secrets Store binding, not a plain Settings ->
 *     Variables and Secrets entry -- the plain panel does not reliably
 *     bind into a script deployed via Workers Builds (confirmed across
 *     five separate attempts with different values, one hand-typed; it
 *     never once appeared on this Worker's own Bindings tab, unlike the
 *     KV namespace, which always has). Set it up as:
 *       1. Secrets Store (account level) -> create a secret, e.g. named
 *          "watcher-status-secret", value = any long random string.
 *       2. This Worker -> Bindings tab -> Add binding -> Secrets Store ->
 *          binding name WATCHER_STATUS_SECRET, pointed at that secret.
 *       3. Fill the real store_id/secret_name into wrangler.toml's
 *          [[secrets_store_secrets]] block (see that file).
 *     Confirm WATCHER_STATUS_SECRET actually appears on the Bindings tab
 *     after redeploying -- that's the real signal it's bound, not just
 *     "the dashboard says saved."
 *
 *   Accessing a Secrets Store binding is async: `await env.NAME.get()`
 *   resolves to the string value, unlike a plain env var/secret which is
 *   already a string on env. authorized() below is async for this reason.
 *
 * Routes (both require ?key=<WATCHER_STATUS_SECRET>):
 *   GET /status  -- human-readable status page: last checked, what
 *                   changed, what errored.
 *   GET /run     -- manually run a check right now (same logic the cron
 *                   trigger runs weekly) and return the JSON result.
 *                   Useful for testing without waiting for Monday, and
 *                   for confirming a source's fetch actually works from
 *                   inside this Worker's runtime, not just from other
 *                   tooling.
 */

import { SOURCES } from './sources.js';

const USER_AGENT = 'KnowYourStrataWatcher/1.0 (+https://knowyourstrata.com; legislative source monitor, detect-only, no scraping beyond the sources in sources.js)';

function normalize(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

// A simple multiset line diff -- not a positional/LCS diff, just "which
// lines appeared that weren't there before, and which disappeared."
// That's enough to flag a change and give a human something to look at;
// interpreting it is explicitly not this Worker's job.
function diffLines(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const oldCounts = new Map();
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) || 0) + 1);
  const newCounts = new Map();
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) || 0) + 1);

  const added = [];
  for (const [line, count] of newCounts) {
    const extra = count - (oldCounts.get(line) || 0);
    for (let i = 0; i < extra; i++) added.push(line);
  }
  const removed = [];
  for (const [line, count] of oldCounts) {
    const extra = count - (newCounts.get(line) || 0);
    for (let i = 0; i < extra; i++) removed.push(line);
  }
  return { added, removed };
}

async function getMeta(env, id) {
  const raw = await env.WATCHER_KV.get(`meta:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function putMeta(env, id, meta) {
  await env.WATCHER_KV.put(`meta:${id}`, JSON.stringify(meta));
}

async function checkSource(env, source, now) {
  try {
    const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = await res.text();

    // A source may reduce its response to just the meaningful part before
    // it is compared. The Ontario endpoints need this: e-Laws proxies
    // Elasticsearch, whose `took` timing and `_shards` block differ on
    // every call, so the raw body would report a change every week and
    // mean nothing. An extractor that throws is a real failure -- a
    // restructured API -- and is reported as an error, not as no change.
    let text;
    try {
      text = normalize(source.extract ? source.extract(raw) : raw);
    } catch (err) {
      throw new Error(`Could not read this source's shape (${err.message}) -- the upstream format probably changed`);
    }

    // bclaws pages are tens of thousands of characters; an extracted
    // currency date is fifteen. Each source sets its own floor. A response
    // under it almost certainly means a block page, a redirect, or an
    // upstream shard failure -- fail loudly rather than silently treating
    // an empty response as "no change", or worse, as "everything was
    // removed."
    const minLength = source.minLength || 500;
    if (text.length < minLength) {
      throw new Error(`Response suspiciously short (${text.length} chars, expected at least ${minLength}) -- likely blocked or restructured, not a real fetch`);
    }

    const prevText = await env.WATCHER_KV.get(`snapshot:${source.id}`);
    const prevMeta = await getMeta(env, source.id);

    if (prevText === null) {
      await env.WATCHER_KV.put(`snapshot:${source.id}`, text);
      await putMeta(env, source.id, { lastChecked: now, lastChanged: null, lastStatus: 'baseline', lastError: null });
      return { id: source.id, status: 'baseline' };
    }

    if (text === prevText) {
      await putMeta(env, source.id, {
        lastChecked: now,
        lastChanged: prevMeta ? prevMeta.lastChanged : null,
        lastStatus: 'unchanged',
        lastError: null
      });
      return { id: source.id, status: 'unchanged' };
    }

    const diff = diffLines(prevText, text);
    await env.WATCHER_KV.put(`snapshot:${source.id}`, text);
    await env.WATCHER_KV.put(
      `diff:${source.id}`,
      JSON.stringify({
        at: now,
        addedCount: diff.added.length,
        removedCount: diff.removed.length,
        addedSample: diff.added.slice(0, 20),
        removedSample: diff.removed.slice(0, 20)
      })
    );
    await putMeta(env, source.id, { lastChecked: now, lastChanged: now, lastStatus: 'changed', lastError: null });
    return { id: source.id, status: 'changed', addedCount: diff.added.length, removedCount: diff.removed.length };
  } catch (err) {
    const message = String((err && err.message) || err);
    const prevMeta = await getMeta(env, source.id);
    await putMeta(env, source.id, {
      lastChecked: now,
      lastChanged: prevMeta ? prevMeta.lastChanged : null,
      lastStatus: 'error',
      lastError: message
    });
    return { id: source.id, status: 'error', error: message };
  }
}

async function runCheck(env) {
  const now = new Date().toISOString();
  const results = [];
  for (const source of SOURCES) {
    results.push(await checkSource(env, source, now));
  }
  await env.WATCHER_KV.put('lastRun', JSON.stringify({ at: now, results }));
  return { at: now, results };
}

async function authorized(request, env) {
  if (!env.WATCHER_STATUS_SECRET) return false;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (typeof key !== 'string' || key.length === 0) return false;

  // Secrets Store bindings are read asynchronously -- unlike a plain env
  // var/secret, the value isn't already sitting on env as a string.
  let expected;
  try {
    expected = await env.WATCHER_STATUS_SECRET.get();
  } catch (err) {
    return false;
  }
  return typeof expected === 'string' && expected.length > 0 && key === expected;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function statusBadge(status) {
  const colors = { unchanged: '#2C6B60', changed: '#8F2D1E', error: '#8F2D1E', baseline: '#5E6E68' };
  const color = colors[status] || '#5E6E68';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:${color}">${esc(status)}</span>`;
}

async function renderStatusPage(env) {
  const lastRunRaw = await env.WATCHER_KV.get('lastRun');
  const lastRun = lastRunRaw ? JSON.parse(lastRunRaw) : null;

  const rows = [];
  for (const source of SOURCES) {
    const meta = await getMeta(env, source.id);
    const status = meta ? meta.lastStatus : 'never run';
    let extra = '';
    if (meta && meta.lastStatus === 'changed') {
      const diffRaw = await env.WATCHER_KV.get(`diff:${source.id}`);
      if (diffRaw) {
        const diff = JSON.parse(diffRaw);
        extra = `<div style="margin-top:8px;font-size:.85rem;color:#3D4C47">
          <strong>${diff.addedCount}</strong> line(s) added, <strong>${diff.removedCount}</strong> removed.
          ${diff.addedSample.length ? `<div style="margin-top:4px"><em>Added, sample:</em><pre style="white-space:pre-wrap;background:#F6F8F6;padding:8px;border-radius:4px;margin-top:4px;font-size:.78rem">${esc(diff.addedSample.join('\n'))}</pre></div>` : ''}
          ${diff.removedSample.length ? `<div style="margin-top:4px"><em>Removed, sample:</em><pre style="white-space:pre-wrap;background:#F6F8F6;padding:8px;border-radius:4px;margin-top:4px;font-size:.78rem">${esc(diff.removedSample.join('\n'))}</pre></div>` : ''}
        </div>`;
      }
    }
    if (meta && meta.lastStatus === 'error') {
      extra = `<div style="margin-top:8px;font-size:.85rem;color:#8F2D1E">${esc(meta.lastError)}</div>`;
    }
    rows.push(`
      <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
          <strong>${esc(source.label)}</strong>
          ${statusBadge(status)}
        </div>
        <div style="font-size:.8rem;color:#5E6E68;margin-top:4px">
          <a href="${esc(source.url)}">${esc(source.url)}</a><br>
          Last checked: ${esc(meta ? meta.lastChecked : 'never')} ·
          Last changed: ${esc(meta && meta.lastChanged ? meta.lastChanged : 'never')}
        </div>
        ${extra}
      </div>`);
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>BC Legislative-Change Watcher</title>
<meta name="robots" content="noindex, nofollow">
<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#222;line-height:1.5}</style>
</head><body>
<h1>BC Legislative-Change Watcher</h1>
<p style="color:#5E6E68">Detects changes only -- never edits site content. A "changed" source means a normal brief/build/verify pass is due, not that anything on the site is already wrong.</p>
<p style="font-size:.85rem;color:#5E6E68">Runs weekly (Mondays, ~08:00 UTC). Last full run: ${esc(lastRun ? lastRun.at : 'never')}.</p>
<hr style="margin:20px 0;border:none;border-top:1px solid #ddd">
${rows.join('')}
</body></html>`;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const html = await renderStatusPage(env);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    if (url.pathname === '/run') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const result = await runCheck(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
