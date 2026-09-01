/**
 * Tests for the Ontario e-Laws extractor in ../src/sources.js.
 *
 * The extractor exists because e-Laws proxies Elasticsearch: `took` is a
 * millisecond timing that differs on every single call, and `_shards` can
 * carry a transient failure block. Hashing the raw body would report a change
 * every week and mean nothing, which is the failure mode that makes a watcher
 * worse than useless -- it trains you to ignore it.
 *
 * So the property that actually matters is: *the extractor's output must not
 * move when only the volatile fields move.* That is what test 1 asserts, using
 * two envelopes that differ in `took` and in a shard failure but carry
 * identical version data.
 *
 * Fixtures below are trimmed from real responses captured 2026-08-26.
 *
 * Run:  node worker/tests/extract_test.mjs
 */
import { SOURCES } from '../src/sources.js';

const src = (id) => {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`no source with id ${id}`);
  return s;
};

function envelope(rows, { took = 265, withShardFailure = false } = {}) {
  return JSON.stringify({
    took,
    timed_out: false,
    _shards: withShardFailure
      ? { total: 8, successful: 7, failed: 1, failures: [{ shard: 0, reason: 'window too large' }] }
      : { total: 8, successful: 8, failed: 0 },
    hits: { total: { value: 0 }, hits: [] },
    aggregations: {
      all: {
        doc_count: rows.length,
        versions: {
          doc_count: rows.length,
          hits: { hits: { total: { value: rows.length }, max_score: null, hits: rows.map((r) => ({ _source: r })) } }
        }
      }
    }
  });
}

const v = (version, state, from, to, alias) => ({
  act: { en: 'Condominium Act, 1998' },
  title: { en: 'Condominium Act, 1998, S.O. 1998, c. 19' },
  alias: { en: alias },
  state: { en: state },
  dateFrom: { en: from },
  dateTo: { en: to },
  version
});

const ROWS = [
  v(0, 'current', '2025-12-31T05:00:00.000Z', '2015-12-02T05:00:00.000Z', 'statute/98c19'),
  v(38, 'historical', '2023-10-01T04:00:00.000Z', '2025-12-30T05:00:00.000Z', 'statute/98c19/v38'),
  v(37, 'historical', '2022-01-01T05:00:00.000Z', '2023-09-30T04:00:00.000Z', 'statute/98c19/v37')
];

let failures = 0;
let checks = 0;
function check(label, cond, detail = '') {
  checks++;
  if (cond) { console.log(`  PASS  ${label}`); }
  else { console.log(`  FAIL  ${label}   ${detail}`); failures++; }
}

const act = src('on-condo-act');

console.log('\n-- the volatile-field property, which is the whole point --');
const quiet = act.extract(envelope(ROWS, { took: 265 }));
const noisy = act.extract(envelope(ROWS, { took: 991, withShardFailure: true }));
check('identical version data extracts identically despite took and _shards differing',
      quiet === noisy, `\n${JSON.stringify(quiet)}\n${JSON.stringify(noisy)}`);

console.log('\n-- real changes must still be seen --');
const added = act.extract(envelope([
  v(39, 'current', '2026-09-01T04:00:00.000Z', '', 'statute/98c19'), ...ROWS
]));
check('a new consolidation version changes the output', added !== quiet);
const edited = act.extract(envelope([
  v(0, 'current', '2026-01-15T05:00:00.000Z', '2015-12-02T05:00:00.000Z', 'statute/98c19'),
  ROWS[1], ROWS[2]
]));
check('a changed dateFrom changes the output', edited !== quiet);

console.log('\n-- shape --');
check('one line per version', quiet.split('\n').length === ROWS.length, quiet);
check('carries version, state and both dates',
      /0 \| current \| 2025-12-31T05:00:00\.000Z \| 2015-12-02T05:00:00\.000Z \| statute\/98c19/.test(quiet), quiet);
check('output is stable under upstream reordering',
      act.extract(envelope([...ROWS].reverse())) === quiet);

console.log('\n-- failure must be loud, never silent --');
let threw = false;
try { act.extract('<html>blocked</html>'); } catch (e) { threw = true; }
check('a non-JSON body throws rather than returning empty', threw);
check('an envelope with no aggregations extracts to empty, which the minLength floor rejects',
      act.extract(JSON.stringify({ took: 1, hits: { hits: [] } })) === '' && act.minLength >= 400);

console.log('\n-- the currency date source --');
const cd = src('on-currency-date');
check('trims to a bare date', cd.extract('August 21, 2026\n') === 'August 21, 2026');
check('its floor is low enough for a date but above empty',
      cd.minLength <= 15 && cd.minLength > 0);

console.log('\n-- BC: a republish must be silent, a real change must not --');
// A miniature bclaws page. The real ones are 20KB-280KB with almost no line
// breaks, which is exactly the problem the extractor solves.
const bcPage = (date, body) =>
  `<html><body><div id="act:currency"><table><tr><td class="currencysingle">` +
  `This Act is current to ${date}</td></tr></table></div>` +
  `<div id="title"><h2>Strata Property Act</h2></div>${body}</html>`;
const BODY = '<p class="sec">45 An annual general meeting must be held.</p>' +
             '<p class="sec">61 Notice is deemed received four days later.</p>';

const part1 = src('act-part1');
const before = part1.extract(bcPage('August 18, 2026', BODY));
const republished = part1.extract(bcPage('August 25, 2026', BODY));
const amended = part1.extract(bcPage('August 18, 2026',
  BODY.replace('four days', 'five days')));

check('a currency-date republish produces NO change at all',
      before === republished,
      'this is the whole point: six false alarms fired on 2026-08-26');
check('a real amendment is still detected', before !== amended);
check('the currency date is blanked, not left in the compared text',
      !before.includes('August 18, 2026') && before.includes('currency date tracked separately'),
      before.slice(0, 200));
check('the compared text is line-granular, not one blob',
      before.split('\n').length >= 4,
      `${before.split('\n').length} lines`);

console.log('\n-- BC currency sources --');
const bcCur = src('bc-act-currency-date');
check('reads the Act wording', bcCur.extract(bcPage('August 25, 2026', BODY)) === 'August 25, 2026');
check('reads the Regulation wording',
      bcCur.extract('<span>This consolidation is current to August 18, 2026.</span>') === 'August 18, 2026');
let bcThrew = false;
try { bcCur.extract('<html>blocked</html>'); } catch (e) { bcThrew = true; }
check('a page with no currency line throws rather than returning empty', bcThrew);
check('the Act and the Regulation are tracked separately',
      src('bc-act-currency-date').url !== src('bc-reg-currency-date').url,
      'they republish on different dates: Aug 25 vs Aug 18 on 2026-08-26');

console.log('\n-- snapshot versioning --');
check('every BC page source declares snapshotVersion 2, so it re-baselines cleanly',
      SOURCES.filter((s) => s.extract === part1.extract).every((s) => s.snapshotVersion === 2));

console.log('\n-- every Ontario source is configured --');
for (const id of ['on-currency-date', 'on-condo-act', 'on-reg-48-01']) {
  const s = src(id);
  check(`${id}: has an extractor and a floor`,
        typeof s.extract === 'function' && typeof s.minLength === 'number' && /^https:\/\/www\.ontario\.ca\//.test(s.url));
}
// Superseded 2026-08-27: BC used to compare raw pages, which is what let a
// currency-date republish fire six false alarms at once. Every source now
// declares how it should be read.
check('every source declares an extractor',
      SOURCES.every((s) => typeof s.extract === 'function'),
      SOURCES.filter((s) => typeof s.extract !== 'function').map((s) => s.id).join(', '));
check('the eight BC page sources all use the page extractor and re-baseline',
      SOURCES.filter((s) => s.extract === part1.extract).length === 8);
check('the two BC currency sources share one extractor and a low floor',
      SOURCES.filter((s) => s.extract === bcCur.extract).length === 2 &&
      SOURCES.filter((s) => s.extract === bcCur.extract).every((s) => s.minLength <= 15));
check('all source ids are unique', new Set(SOURCES.map((s) => s.id)).size === SOURCES.length);

console.log();
if (failures) { console.log(`${failures} FAILED of ${checks}`); process.exit(1); }
console.log(`All ${checks} extractor assertions passed.`);
