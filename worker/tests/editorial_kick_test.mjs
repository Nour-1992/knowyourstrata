/**
 * Tests for the editorial kick (src/index.js, EDITORIAL KICK).
 *
 * Runs the Worker's real scheduled() and fetch() handlers against an
 * in-memory KV and a fake global fetch, so no network and no Cloudflare.
 * What matters:
 *   1. the 08:00 cron runs the check AND THEN dispatches, with the token,
 *      against the right workflow, on main;
 *   2. the 09:00 cron does not re-run the check, and records whether a run
 *      exists since this week's check;
 *   3. with no token bound nothing is sent and the status says so;
 *   4. a GitHub refusal is recorded, not swallowed;
 *   5. /status.json publishes all of it under "editorial".
 *
 * Run:  node worker/tests/editorial_kick_test.mjs
 */
import worker from '../src/index.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS  ' + msg); } else { fail++; console.log('  FAIL  ' + msg); } }

function makeEnv(token) {
  const kv = new Map();
  return {
    WATCHER_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } },
    WATCHER_STATUS_SECRET: { get: async () => 'secret' },
    GITHUB_DISPATCH_TOKEN: token === undefined ? undefined : { get: async () => token },
    _kv: kv
  };
}
function ctx() { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; }

let calls = [];
let ghDispatchStatus = 204;
let ghRuns = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  if (url.includes('/dispatches')) return new Response(ghDispatchStatus === 204 ? null : 'Bad credentials', { status: ghDispatchStatus });
  if (url.includes('/runs')) return new Response(JSON.stringify({ workflow_runs: ghRuns }), { status: 200 });
  return new Response('<html><body>source text</body></html>', { status: 200 });
};

// 1. 08:00 with a token
{
  calls = []; const env = makeEnv('tok123'); const c = ctx();
  await worker.scheduled({ cron: '0 8 * * 2' }, env, c); await c.done();
  const sourceCalls = calls.filter((x) => !x.url.includes('api.github.com'));
  const d = calls.filter((x) => x.url.includes('/dispatches'));
  ok(sourceCalls.length > 0, '08:00 runs the source check');
  ok(d.length === 1, '08:00 sends exactly one dispatch');
  ok(calls.indexOf(d[0]) > calls.indexOf(sourceCalls[sourceCalls.length - 1]), 'dispatch comes after the check finished');
  ok(d[0] && d[0].url === 'https://api.github.com/repos/Nour-1992/knowyourstrata/actions/workflows/weekly-editorial.yml/dispatches', 'dispatch targets the weekly-editorial workflow');
  ok(d[0] && d[0].method === 'POST' && JSON.parse(d[0].body).ref === 'main', 'dispatch is a POST on ref main');
  ok(d[0] && d[0].headers.Authorization === 'Bearer tok123', 'dispatch carries the token');
  const rec = JSON.parse(env._kv.get('editorialDispatch'));
  ok(rec.ok === true && rec.httpStatus === 204, 'a 204 is recorded as ok');

  // 2. 09:00 on the same env
  calls = []; const lastAt = JSON.parse(env._kv.get('lastRun')).at;
  ghRuns = [
    { id: 2, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date(Date.parse(lastAt) + 60000).toISOString(), html_url: 'u2' },
    { id: 1, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-09-28T16:50:00Z', html_url: 'u1' }
  ];
  const c2 = ctx();
  await worker.scheduled({ cron: '0 9 * * 2' }, env, c2); await c2.done();
  ok(calls.every((x) => x.url.includes('api.github.com')), '09:00 does not re-run the source check');
  const rc = JSON.parse(env._kv.get('editorialRunCheck'));
  ok(rc.ok && rc.runFoundThisWeek === true && rc.latestThisWeek.id === 2, '09:00 finds this week’s run and ignores last week’s');

  // no run this week
  ghRuns = [{ id: 1, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-09-28T16:50:00Z', html_url: 'u1' }];
  const c3 = ctx(); await worker.scheduled({ cron: '0 9 * * 2' }, env, c3); await c3.done();
  const rc2 = JSON.parse(env._kv.get('editorialRunCheck'));
  ok(rc2.ok && rc2.runFoundThisWeek === false, 'a week with no run is reported as no run');

  // 5. status.json
  const res = await worker.fetch(new Request('https://w.example/status.json?key=secret'), env);
  const body = await res.json();
  ok(body.editorial && body.editorial.dispatch.ok === true && body.editorial.runCheck.runFoundThisWeek === false, '/status.json publishes the editorial block');
  const html = await (await worker.fetch(new Request('https://w.example/status?key=secret'), env)).text();
  ok(html.includes('NO RUN this week'), '/status shows a missing run in plain words');
  const denied = await worker.fetch(new Request('https://w.example/dispatch?key=wrong'), env);
  ok(denied.status === 404, '/dispatch refuses without the key');
}

// 3. no token
{
  calls = []; const env = makeEnv(undefined); const c = ctx();
  await worker.scheduled({ cron: '0 8 * * 2' }, env, c); await c.done();
  ok(!calls.some((x) => x.url.includes('api.github.com')), 'no token: nothing is sent to GitHub');
  const rec = JSON.parse(env._kv.get('editorialDispatch'));
  ok(rec.ok === false && rec.configured === false, 'no token: recorded as not configured');
  ok(env._kv.has('lastRun'), 'no token: the source check still ran');
}

// 4. GitHub refuses
{
  ghDispatchStatus = 401; const env = makeEnv('bad'); const c = ctx();
  await worker.scheduled({ cron: '0 8 * * 2' }, env, c); await c.done();
  const rec = JSON.parse(env._kv.get('editorialDispatch'));
  ok(rec.ok === false && rec.httpStatus === 401 && /Bad credentials/.test(rec.error), 'a refusal is recorded with its status and message');
  ghDispatchStatus = 204;
}

console.log();
console.log(fail ? `${fail} FAILED, ${pass} passed.` : `All ${pass} editorial-kick assertions passed.`);
process.exit(fail ? 1 : 0);
