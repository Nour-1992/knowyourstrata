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
  /* `extra` carries files outside the province directory that still cite that
     province's consolidation stamp. cheat-sheet.html sits at the repo root and
     was invisible to this sweep until 2026-09-21. */
  'bc-act-currency-date': { dir: 'bc', label: 'BC Strata Property Act', extra: ['cheat-sheet.html'] },
  'bc-reg-currency-date': { dir: 'bc', label: 'BC Strata Property Regulation', extra: ['cheat-sheet.html'] },
  'on-currency-date':     { dir: 'on', label: 'Ontario e-Laws', extra: [] }
};

const BADGE_RX = /Sources checked automatically every Monday\. Last check [^<]*/g;
/* A consolidation stamp anywhere on a page, in either of the two date formats
   the site uses, and behind any of the phrasings the site actually uses for
   one. The leading context is NOT optional: without it this would also match
   a Verified date, a case-law year, or a statutory date like "July 1, 2026"
   or "December 31, 2020", of which the depreciation page alone has several.
   Derived by grep from the repo on 2026-09-21; re-derive it if a new phrasing
   is introduced. */
const STAMP_RX = new RegExp(
  '(current to(?: the)?(?: e-Laws consolidation of)?'
  + '|e-Laws (?:currency date|consolidation)(?: of)?'
  + '|consolidation of) '
  + '([A-Z][a-z]+ \\d{1,2}, \\d{4}|\\d{1,2} [A-Z][a-z]+ \\d{4})',
  'g'
);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
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

/* A stamp in either format -> a comparable timestamp, plus which format it was
   written in, so the sweep can put the replacement back the same way round. */
function parseStamp(s) {
  let m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(s);
  if (m) return { ts: Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2])), dmy: false };
  m = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(s);
  if (m) return { ts: Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])), dmy: true };
  return null;
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
    /* SELF-HEALING, added 2026-09-21.
       This used to swap the exact old value for the new one. That could only
       ever fix a page already sitting on last week's stamp, so any page that
       missed an earlier sweep stayed stale for good: on 2026-09-20 the BC
       pages carried four different stamps at once, from 4 August to
       8 September, while bclaws read 15 September.
       Now every stamp at or BEHIND the old value is brought forward. A stamp
       AHEAD of it is left alone, which is what keeps this safe when the Act
       and the Regulation are republished on different days and legitimately
       carry different dates: sweeping one source must never drag the other
       one backwards or forwards. */
    const oldStamp = parseStamp(oldUs);
    if (!oldStamp) {
      summary.errors.push(`${s.id}: unparseable previous stamp ${oldUs}`);
      continue;
    }
    let files = 0;
    let count = 0;
    let healed = 0;
    for (const rel of [...htmlIn(cfg.dir), ...(cfg.extra || [])]) {
      const before = read(rel);
      let n = 0;
      const after = before.replace(STAMP_RX, (full, lead, found) => {
        const p = parseStamp(found);
        if (!p || !Number.isFinite(p.ts)) return full;
        if (p.ts > oldStamp.ts) return full;
        n += 1;
        if (p.ts < oldStamp.ts) healed += 1;
        return `${lead} ${p.dmy ? toDmy(newUs) : newUs}`;
      });
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
    summary.stamps.push({ id: s.id, label: cfg.label, from: oldUs, to: newUs, files, replacements: count, healed });
    /* Two sources can carry the same value -- the BC Act and Regulation move
       together most weeks -- so the second pass legitimately finds nothing
       left to do. Say that, rather than reporting a bare zero. */
    summary.currency.push(count
      ? `${cfg.label}: ${oldUs} -> ${newUs} (${count} strings across ${files} files`
        + (healed ? `, ${healed} of them lagging further behind and caught up` : '') + ')'
      : `${cfg.label}: ${oldUs} -> ${newUs} (already applied, another source carries the same value)`);
  }
}

/* monitoring.html is never swept. Its record rows describe what was true on
   the day of each check, and the old dates in them ARE the record. */
process.stdout.write(JSON.stringify(summary, null, 2));
