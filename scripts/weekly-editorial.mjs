/**
 * Weekly editorial pass, applied automatically.
 *
 * The watcher DETECTS. This script APPLIES the one class of change that is
 * provable without a human reading the law: an editorial consolidation-stamp
 * advance, plus the weekly badge-note refresh.
 *
 * It deliberately does NOT apply a legal change. When a legal-text or
 * version-list source moves, the tool logic itself may be wrong, and only a
 * person can read a statute. In that case this script edits nothing except the
 * badge, which it sets to "under human review", and reports so the workflow
 * opens an issue instead of a pull request.
 *
 * Input:  --status <file>   the watcher /status.json body
 *         --repo   <dir>    the checked-out site
 *         --date   <label>  the run date, e.g. "September 14, 2026"
 * Output: edits files in place, writes a summary to stdout as JSON.
 *
 * Every rule below is from WATCHER-LOG.md. The numbers are derived by grep at
 * run time, never hard-coded, because a new tool changes them.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const REPO = arg('--repo', '.');
const STATUS = JSON.parse(readFileSync(arg('--status'), 'utf8'));

/* The badge records the day the SOURCES were fetched, which is lastRun.at, not
   the day this job happens to run. Those are not the same day: the watcher has
   been firing on Sundays while this job runs Monday. Taking the date from the
   run itself makes the badge true whichever day the cron actually fires. */
const lastRunAt = STATUS.lastRun && STATUS.lastRun.at;
if (!lastRunAt) {
  process.stdout.write(JSON.stringify({ abort: 'the watcher reports no completed run', edited: false }, null, 2));
  process.exit(0);
}
const ageDays = (Date.now() - Date.parse(lastRunAt)) / 86400000;
/* Rule 3, stall week: never advance the badge to "no change found" on the back
   of a stale check. That would be a false claim of a clean read. */
if (!(ageDays >= 0) || ageDays > 8) {
  process.stdout.write(JSON.stringify({ abort: `the last full run is ${ageDays.toFixed(1)} days old`, lastRunAt, edited: false }, null, 2));
  process.exit(0);
}
const RUN_DATE = arg('--date') || new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
}).format(new Date(lastRunAt));

/* Which sources are editorial. Everything else is legal text or a version
   list, and a change in any of them is a human pass, not this script. */
const CURRENCY = {
  'bc-act-currency-date': { dir: 'bc', label: 'BC Strata Property Act' },
  'bc-reg-currency-date': { dir: 'bc', label: 'BC Strata Property Regulation' },
  'on-currency-date':     { dir: 'on', label: 'Ontario e-Laws' }
};

const BADGE_RX = /Sources checked automatically every Monday\. Last check [^<]*/g;
const VERIFIED_RX = /(?:Verified|verified)[^<]{0,40}(?:\d{1,2}(?: &amp; \d{1,2})? [A-Z][a-z]+ \d{4}|[A-Z][a-z]+ \d{1,2}, \d{4})/g;

const htmlIn = (dir) =>
  readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.html')).map((f) => `${dir}/${f}`);

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const write = (rel, t) => writeFileSync(join(REPO, rel), t, 'utf8');

/* "September 1, 2026" -> "1 September 2026". Both forms live on the site and a
   sweep that moves only one leaves a page contradicting itself. */
function toDmy(us) {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(us);
  if (!m) throw new Error(`unparseable currency date: ${us}`);
  return `${m[2]} ${m[1]} ${m[3]}`;
}

const sources = STATUS.sources || [];
const byId = Object.fromEntries(sources.map((s) => [s.id, s]));

const legalMoved = sources.filter(
  (s) => !CURRENCY[s.id] && (s.status === 'changed' || s.status === 'error')
);
const stampsMoved = sources.filter((s) => CURRENCY[s.id] && s.status === 'changed');

const summary = {
  runDate: RUN_DATE,
  lastRunAt,
  edited: true,
  legalReview: legalMoved.length > 0,
  legalSources: legalMoved.map((s) => ({ id: s.id, status: s.status })),
  stamps: [],
  badge: { files: 0, occurrences: 0, text: '' },
  currency: [],
  errors: []
};

/* ---------------------------------------------------------------- badge */
/* Rule 3. The one string this job maintains itself, every Monday, quiet week
   or not. Settled 2026-09-08: an editorial-only change still counts as "no
   change found"; that wording is reserved for a legal move. */
const badgeText = summary.legalReview
  ? `Sources checked automatically every Monday. Last check ${RUN_DATE}, a change was found and is under human review.`
  : `Sources checked automatically every Monday. Last check ${RUN_DATE}, no change found.`;
summary.badge.text = badgeText;

for (const rel of [...htmlIn('bc'), ...htmlIn('on')]) {
  const before = read(rel);
  const hits = before.match(BADGE_RX);
  if (!hits) continue;
  const after = before.replace(BADGE_RX, badgeText);
  if (after.match(VERIFIED_RX)?.join('|') !== before.match(VERIFIED_RX)?.join('|')) {
    summary.errors.push(`${rel}: a verified date moved during the badge refresh`);
    continue;
  }
  write(rel, after);
  summary.badge.files += 1;
  summary.badge.occurrences += hits.length;
}

/* ------------------------------------------------------------- currency */
/* Skipped entirely on a legal week: the currency stamp is not the point when
   the text in force may have moved, and the human pass owns that push. */
if (!summary.legalReview) {
  for (const s of stampsMoved) {
    const cfg = CURRENCY[s.id];
    const oldUs = (s.removedSample || [])[0];
    const newUs = (s.addedSample || [])[0];
    if (!oldUs || !newUs) {
      summary.errors.push(`${s.id}: changed but the diff carried no before/after value`);
      continue;
    }
    const pairs = [[oldUs, newUs], [toDmy(oldUs), toDmy(newUs)]];
    let files = 0;
    let count = 0;
    for (const rel of htmlIn(cfg.dir)) {
      const before = read(rel);
      let after = before;
      let n = 0;
      for (const [o, nw] of pairs) {
        const c = before.split(o).length - 1;
        if (c) { after = after.split(o).join(nw); n += c; }
      }
      if (!n) continue;
      /* A currency sweep must never move a provenance date. */
      if (after.match(VERIFIED_RX)?.join('|') !== before.match(VERIFIED_RX)?.join('|')) {
        summary.errors.push(`${rel}: a verified date moved during the currency sweep`);
        continue;
      }
      write(rel, after);
      files += 1;
      count += n;
    }
    summary.stamps.push({ id: s.id, label: cfg.label, from: oldUs, to: newUs, files, replacements: count });
    /* Two sources can carry the same value -- the BC Act and Regulation move
       together most weeks -- so the second pass legitimately finds nothing
       left to do. Say that, rather than reporting a bare zero. */
    summary.currency.push(count
      ? `${cfg.label}: ${oldUs} -> ${newUs} (${count} strings across ${files} files)`
      : `${cfg.label}: ${oldUs} -> ${newUs} (already applied, another source carries the same value)`);
  }
}

/* monitoring.html is never swept. Its record rows describe what was true on
   the day of each check, and the old dates in them ARE the record. */
process.stdout.write(JSON.stringify(summary, null, 2));
