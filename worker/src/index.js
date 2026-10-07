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
 *   GET /dispatch -- ask GitHub to run the weekly editorial workflow now.
 *   GET /verify   -- ask GitHub whether this week's workflow run exists.
 *                   Both are recorded and shown under "editorial" in
 *                   /status.json. See EDITORIAL KICK below.
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

/**
 * Snapshots are keyed by source id AND snapshot version.
 *
 * Changing a source's extractor changes the shape of the text being
 * compared, so the next run would diff the new format against the old one
 * and report a meaningless page-sized change. Bumping snapshotVersion
 * gives that source a clean baseline instead, while keeping its id -- and
 * therefore its place in the source-to-tools map and the log -- stable.
 */
function snapshotKey(source) {
  const v = source.snapshotVersion || 1;
  return v === 1 ? `snapshot:${source.id}` : `snapshot:${source.id}:v${v}`;
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

    const prevText = await env.WATCHER_KV.get(snapshotKey(source));
    const prevMeta = await getMeta(env, source.id);

    if (prevText === null) {
      await env.WATCHER_KV.put(snapshotKey(source), text);
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
    await env.WATCHER_KV.put(snapshotKey(source), text);
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

/* ------------------------------------------------------------------------
   EDITORIAL KICK, added 2026-10-07.

   The weekly editorial pass is a GitHub Action. Its own cron is best-effort
   and observed to start 6.5 to 8.75 hours late (21 Sep, 28 Sep, 5 Oct), and
   GitHub can drop a scheduled run without telling anyone. This Worker's cron
   is the reliable clock, so right after the Monday check it asks GitHub to
   run the workflow now (workflow_dispatch), and an hour later it asks GitHub
   whether a run actually exists. Both answers are stored in KV and published
   in /status.json under "editorial", which is what the Monday responder reads.
   That closes the blind spot: a missing run is now visible, not silent.

   Needs a GitHub fine-grained token, scoped to this one repository, with
   "Actions: Read and write" and nothing else, stored in the Secrets Store and
   bound as GITHUB_DISPATCH_TOKEN (see wrangler.toml). With no token bound the
   check still runs and the editorial block says "not configured".
   ------------------------------------------------------------------------ */
const GH_REPO = 'Nour-1992/knowyourstrata';
const GH_WORKFLOW = 'weekly-editorial.yml';
const CRON_CHECK = '0 8 * * 2';      // Monday 08:00 UTC (Cloudflare: 2 = Monday)
const CRON_VERIFY = '0 9 * * 2';     // Monday 09:00 UTC

async function githubToken(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return null;
  try {
    const v = typeof env.GITHUB_DISPATCH_TOKEN === 'string'
      ? env.GITHUB_DISPATCH_TOKEN
      : await env.GITHUB_DISPATCH_TOKEN.get();
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch (e) {
    return null;
  }
}

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  };
}

async function dispatchEditorial(env) {
  const at = new Date().toISOString();
  const token = await githubToken(env);
  let record;
  if (!token) {
    record = { at, ok: false, configured: false, note: 'GITHUB_DISPATCH_TOKEN is not bound; the workflow was not kicked.' };
  } else {
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
        method: 'POST',
        headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main' })
      });
      // GitHub answers 204 No Content on success.
      record = { at, ok: res.status === 204, configured: true, httpStatus: res.status };
      if (res.status !== 204) record.error = (await res.text()).slice(0, 300);
    } catch (e) {
      record = { at, ok: false, configured: true, error: String(e && e.message || e).slice(0, 300) };
    }
  }
  await env.WATCHER_KV.put('editorialDispatch', JSON.stringify(record));
  return record;
}

/* Asks GitHub for the workflow's most recent runs and records whether one
   was created on or after this week's check. It cannot see a pull request's
   merge state, only that the run exists and how it ended. */
async function verifyEditorial(env) {
  const at = new Date().toISOString();
  const token = await githubToken(env);
  const lastRunRaw = await env.WATCHER_KV.get('lastRun');
  const since = lastRunRaw ? JSON.parse(lastRunRaw).at : null;
  let record;
  if (!token) {
    record = { at, configured: false, note: 'GITHUB_DISPATCH_TOKEN is not bound; runs were not checked.' };
  } else {
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=5`, {
        headers: ghHeaders(token)
      });
      if (res.status !== 200) {
        record = { at, configured: true, ok: false, httpStatus: res.status, error: (await res.text()).slice(0, 300) };
      } else {
        const body = await res.json();
        const runs = (body.workflow_runs || []).map((r) => ({
          id: r.id, event: r.event, status: r.status, conclusion: r.conclusion,
          createdAt: r.created_at, url: r.html_url
        }));
        const thisWeek = since ? runs.filter((r) => r.createdAt >= since) : [];
        record = {
          at, configured: true, ok: true, since,
          runFoundThisWeek: thisWeek.length > 0,
          latestThisWeek: thisWeek[0] || null,
          recent: runs
        };
      }
    } catch (e) {
      record = { at, configured: true, ok: false, error: String(e && e.message || e).slice(0, 300) };
    }
  }
  await env.WATCHER_KV.put('editorialRunCheck', JSON.stringify(record));
  return record;
}

async function editorialState(env) {
  const d = await env.WATCHER_KV.get('editorialDispatch');
  const c = await env.WATCHER_KV.get('editorialRunCheck');
  return { dispatch: d ? JSON.parse(d) : null, runCheck: c ? JSON.parse(c) : null };
}

async function renderStatusPage(env) {
  const ed = await editorialState(env);
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
<html><head><meta charset="UTF-8"><title>Legislative-Change Watcher (BC and Ontario)</title>
<meta name="robots" content="noindex, nofollow">
<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#222;line-height:1.5}</style>
</head><body>
<h1>Legislative-Change Watcher</h1>
<p style="color:#5E6E68">Detects changes only -- never edits site content. A "changed" source means a normal brief/build/verify pass is due, not that anything on the site is already wrong.</p>
<p style="font-size:.85rem;color:#5E6E68">Runs weekly (Mondays, ~08:00 UTC). Last full run: ${esc(lastRun ? lastRun.at : 'never')}.</p>
<p style="font-size:.85rem;color:#5E6E68">Editorial workflow kick: ${esc(ed.dispatch ? (ed.dispatch.ok ? 'sent ' + ed.dispatch.at : 'NOT sent ' + (ed.dispatch.at || '') + ' ' + (ed.dispatch.note || ed.dispatch.error || ('HTTP ' + ed.dispatch.httpStatus))) : 'never')}.
 Run check: ${esc(ed.runCheck ? (ed.runCheck.ok ? (ed.runCheck.runFoundThisWeek ? 'run found, ' + ed.runCheck.latestThisWeek.status + (ed.runCheck.latestThisWeek.conclusion ? ' / ' + ed.runCheck.latestThisWeek.conclusion : '') : 'NO RUN this week') + ' (' + ed.runCheck.at + ')' : 'could not check: ' + (ed.runCheck.note || ed.runCheck.error || ('HTTP ' + ed.runCheck.httpStatus))) : 'never')}.</p>
<hr style="margin:20px 0;border:none;border-top:1px solid #ddd">
${rows.join('')}
</body></html>`;
}

/* Machine-readable twin of the status page. The HTML page is for a person;
   this is what the weekly editorial workflow reads. Same auth, same data. */
async function statusJson(env) {
  const lastRunRaw = await env.WATCHER_KV.get('lastRun');
  const lastRun = lastRunRaw ? JSON.parse(lastRunRaw) : null;

  const sources = [];
  for (const source of SOURCES) {
    const meta = await getMeta(env, source.id);
    const row = {
      id: source.id,
      label: source.label,
      url: source.url,
      status: meta ? meta.lastStatus : 'never run',
      lastChecked: meta ? meta.lastChecked : null,
      lastChanged: meta && meta.lastChanged ? meta.lastChanged : null
    };
    if (meta && meta.lastStatus === 'changed') {
      const diffRaw = await env.WATCHER_KV.get(`diff:${source.id}`);
      if (diffRaw) {
        const diff = JSON.parse(diffRaw);
        row.addedCount = diff.addedCount;
        row.removedCount = diff.removedCount;
        /* The currency extractors return just the date string, so for a
           *-currency-date source these two carry the exact before and after
           values. That is what makes an automated sweep possible without
           guessing at what the site currently says. */
        row.addedSample = diff.addedSample || [];
        row.removedSample = diff.removedSample || [];
      }
    }
    if (meta && meta.lastStatus === 'error') row.error = meta.lastError;
    sources.push(row);
  }

  return { lastRun, sourceCount: SOURCES.length, sources, editorial: await editorialState(env) };
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === CRON_VERIFY) {
      ctx.waitUntil(verifyEditorial(env));
      return;
    }
    // CRON_CHECK, or any cron string not recognised: the weekly check runs,
    // then the editorial workflow is kicked so it does not wait on GitHub's
    // own late schedule.
    ctx.waitUntil(runCheck(env).then(() => dispatchEditorial(env)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const html = await renderStatusPage(env);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    if (url.pathname === '/status.json') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const body = await statusJson(env);
      return new Response(JSON.stringify(body, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (url.pathname === '/run') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const result = await runCheck(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    /* Manual fallbacks, same auth: kick the workflow now, or ask GitHub
       whether this week's run exists. Neither runs the source check. */
    if (url.pathname === '/dispatch') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const result = await dispatchEditorial(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (url.pathname === '/verify') {
      if (!(await authorized(request, env))) return new Response('Not found', { status: 404 });
      const result = await verifyEditorial(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
