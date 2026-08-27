/**
 * The exact legislative sources the live tools on knowyourstrata.com
 * actually depend on -- not the whole of bclaws.gov.bc.ca or ontario.ca,
 * just these.
 *
 * When a new tool cites a source URL not already in this list, add it
 * here. `id` is used as the KV key prefix, so once a source has run at
 * least once, don't change its id -- that would orphan its history and
 * make the watcher treat it as brand new.
 *
 * Three optional fields:
 *
 *   extract(rawBody)  Reduce a response to only the part whose change is
 *                     meaningful. Required for anything that returns JSON
 *                     with volatile fields -- e-Laws proxies Elasticsearch
 *                     and its `took` timing and `_shards` block differ on
 *                     every single call, so hashing the raw body would
 *                     report a change every week and mean nothing.
 *
 *   minLength         Override the default 500-character sanity floor. A
 *                     bclaws page is tens of thousands of characters; an
 *                     extracted currency date is fifteen.
 *
 *   snapshotVersion   Bump this whenever a source's extract() changes what
 *                     the compared text looks like. The stored snapshot is
 *                     keyed by it, so the source re-baselines cleanly
 *                     instead of diffing the new format against the old and
 *                     reporting a page-sized change that means nothing.
 *                     The id stays stable, so the source-to-tools map and
 *                     the log still line up.
 *
 * ── On Ontario, and why this is a plain fetch ─────────────────────────
 * ontario.ca/laws renders its statute pages in JavaScript, so an earlier
 * pass concluded Ontario would need Cloudflare Browser Rendering -- a
 * separate, metered product -- and Ontario was left uncovered.
 *
 * That turned out to be wrong. The e-Laws front end is a React app talking
 * to a plain public JSON API, and those endpoints need no JavaScript at
 * all. They are ordinary GETs, which is why Ontario now sits in this file
 * next to BC rather than in a different system.
 */


/* ── British Columbia ──────────────────────────────────────────────────
 * bclaws pages carry a currency line that moves whenever the Queen's
 * Printer republishes, even when not one word of the law changed. On
 * 2026-08-26 that produced six simultaneous "changed" results whose only
 * difference was August 18 -> August 25. A watcher that cries wolf six
 * times at once is a watcher you stop reading.
 *
 * So the date is blanked out of the compared text and tracked as its own
 * source. The Act and the Regulation republish on different cadences --
 * on 2026-08-26 the Act was current to August 25 while the Regulation was
 * still on August 18 -- so they get one source each.
 *
 * The Act and the Standard Bylaws say "This Act is current to ..."; the
 * Regulation says "This consolidation is current to ...". Both forms are
 * matched, and a page with neither throws rather than silently comparing
 * a date as if it were law.
 */
const BC_CURRENCY_RE = /This (?:Act|consolidation|regulation) is current to ([A-Z][a-z]+ \d{1,2}, \d{4})/i;

function bcCurrency(raw) {
  const m = raw.match(BC_CURRENCY_RE);
  if (!m) throw new Error('no bclaws currency line found -- the page layout changed');
  return m[1];
}

function bcText(raw) {
  const withoutDate = raw.replace(BC_CURRENCY_RE, (whole, date) =>
    whole.replace(date, '(currency date tracked separately)'));

  // bclaws serves the document with almost no line breaks, so the whole page
  // collapses to a single line and EVERY change -- a corrected comma or a
  // repealed section -- reports identically as "1 line added, 1 removed".
  // Breaking before block-level tags makes a real amendment show up as a
  // handful of readable lines instead of a 20KB blob.
  return withoutDate.replace(/<(div|p|h[1-6]|table|tr|li)\b/gi, '\n<$1');
}

/** e-Laws returns Elasticsearch envelopes; the version list is nested here. */
function elawsVersions(raw) {
  const body = JSON.parse(raw);
  const hits =
    (((body.aggregations || {}).all || {}).versions || {}).hits || {};
  const rows = ((hits.hits || {}).hits) || [];

  // One stable line per consolidation version. Sorted by version so a
  // reordering upstream is not reported as a change, and deliberately
  // excluding anything time-varying.
  return rows
    .map((r) => r._source || {})
    .map((s) => [
      s.version,
      (s.state || {}).en || '',
      (s.dateFrom || {}).en || '',
      (s.dateTo || {}).en || '',
      (s.alias || {}).en || ''
    ].join(' | '))
    .sort()
    .join('\n');
}

export const SOURCES = [
  {
    id: 'act-part1',
    label: 'Strata Property Act — Part 1 (definitions & interpretation)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_01'
  },
  {
    id: 'act-part4',
    label: 'Strata Property Act — Part 4 (meetings, records, conflict of interest)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_04'
  },
  {
    id: 'act-part6',
    label: 'Strata Property Act — Part 6 (fees, levies, contingency reserve fund)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_06'
  },
  {
    id: 'act-part7',
    label: 'Strata Property Act — Part 7 (bylaw enforcement & fines)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_07'
  },
  {
    id: 'act-part9',
    label: 'Strata Property Act — Part 9 (insurance)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_09'
  },
  {
    id: 'regulation',
    label: 'Strata Property Regulation (CRF floor, retention periods, fine ceilings)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/43_2000'
  },
  {
    id: 'standard-bylaws',
    label: 'Schedule of Standard Bylaws (council quorum, tie votes, minutes distribution)',
    extract: bcText,
    snapshotVersion: 2,
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_18'
  },

  {
    id: 'bc-act-currency-date',
    label: 'BC Strata Property Act currency date (the date every BC Act page cites)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_01',
    extract: bcCurrency,
    minLength: 8
  },
  {
    id: 'bc-reg-currency-date',
    label: 'BC Strata Property Regulation currency date (republishes separately)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/43_2000',
    extract: bcCurrency,
    minLength: 8
  },

  // ── Ontario ─────────────────────────────────────────────────────────
  {
    id: 'on-currency-date',
    label: 'Ontario e-Laws currency date (the date every ON page cites)',
    url: 'https://www.ontario.ca/laws/api/v2/legislation/en/currency-date',
    // A bare date string, e.g. "August 21, 2026\n".
    extract: (raw) => raw.trim(),
    minLength: 8
  },
  {
    id: 'on-condo-act',
    label: 'Condominium Act, 1998 — consolidation versions',
    url: 'https://www.ontario.ca/laws/api/v2/legislation/en/act-versions/statute/98c19',
    extract: elawsVersions,
    // ~39 versions at ~60 chars each. A floor of 400 catches an empty or
    // shard-failed response, which must error loudly rather than diff to
    // "every version was removed."
    minLength: 400
  },
  {
    id: 'on-reg-48-01',
    label: 'O. Reg. 48/01 (General) — consolidation versions',
    url: 'https://www.ontario.ca/laws/api/v2/legislation/en/act-versions/regulation/010048',
    extract: elawsVersions,
    minLength: 200
  }
];
