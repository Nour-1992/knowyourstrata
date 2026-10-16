// Server-side counter tests. Run: node tests/count_test.mjs
//
// The counter shipped in August 2026 and recorded nothing for two months: the
// D1 database existed and was bound, but its table had never been created, so
// every INSERT failed and count() swallowed the error by design. These tests
// pin the fix (create the table on first use) and the allowlist, which had
// also fallen behind: seven Ontario tools were missing from it.
import { count, validate, TOOL_SLUGS } from '../functions/_lib/count.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ', label); }
  else { fail++; console.log('  FAIL ', label, extra); }
};

// A tiny fake of the D1 surface count() uses: prepare(sql).bind(...).run().
function fakeDB({ tableExists }) {
  const state = { tableExists, ddl: 0, rows: new Map() };
  const stmt = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      if (/^\s*CREATE/i.test(sql)) { state.ddl++; state.tableExists = true; return {}; }
      if (!state.tableExists) throw new Error('D1_ERROR: no such table: events: SQLITE_ERROR');
      const k = this._args.slice(0, 3).join('|');
      state.rows.set(k, (state.rows.get(k) || 0) + 1);
      return {};
    }
  });
  return { state, DB: { prepare: (sql) => stmt(sql) } };
}

console.log('\n-- missing table heals itself');
{
  const { state, DB } = fakeDB({ tableExists: false });
  const ok = await count({ DB }, 'tool_used', 'on/agm-deadline');
  check('first write succeeds on a database with no table', ok === true);
  check('the table was created (2 DDL statements)', state.ddl === 2, String(state.ddl));
  check('one row was counted', [...state.rows.values()].reduce((a, b) => a + b, 0) === 1);
  await count({ DB }, 'tool_used', 'on/agm-deadline');
  check('second write does not run DDL again', state.ddl === 2, String(state.ddl));
}

console.log('\n-- other failures still never throw');
{
  const DB = { prepare: () => ({ bind() { return this; }, async run() { throw new Error('network'); } }) };
  check('a non-schema failure returns false, not an exception', (await count({ DB }, 'subscribed')) === false);
  check('no binding returns false', (await count({}, 'subscribed')) === false);
}

console.log('\n-- allowlist matches the tools');
{
  const tools = JSON.parse(readFileSync(new URL('../scripts/tools.json', import.meta.url))).tools;
  const want = new Set(tools.map((t) => t.href.replace(/^\//, '')));
  const missing = [...want].filter((s) => !TOOL_SLUGS.has(s));
  const extra = [...TOOL_SLUGS].filter((s) => !want.has(s));
  check('every tool in tools.json is countable', missing.length === 0, missing.join(', '));
  check('no stale slug in the allowlist', extra.length === 0, extra.join(', '));
  check('embed_view accepts a tool slug', !!validate('embed_view', 'bc/agm-notice'));
  check('embed_view rejects free text', validate('embed_view', 'https://example.com') === null);
  check('unknown event names are dropped', validate('page_view', '') === null);
}

console.log(fail ? `\n${fail} FAILED of ${pass + fail}` : `\nAll ${pass} counter assertions passed.`);
process.exit(fail ? 1 : 0);
