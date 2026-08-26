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
 * Two optional fields, used by the Ontario sources:
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
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_01'
  },
  {
    id: 'act-part4',
    label: 'Strata Property Act — Part 4 (meetings, records, conflict of interest)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_04'
  },
  {
    id: 'act-part6',
    label: 'Strata Property Act — Part 6 (fees, levies, contingency reserve fund)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_06'
  },
  {
    id: 'act-part7',
    label: 'Strata Property Act — Part 7 (bylaw enforcement & fines)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_07'
  },
  {
    id: 'act-part9',
    label: 'Strata Property Act — Part 9 (insurance)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_09'
  },
  {
    id: 'regulation',
    label: 'Strata Property Regulation (CRF floor, retention periods, fine ceilings)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/43_2000'
  },
  {
    id: 'standard-bylaws',
    label: 'Schedule of Standard Bylaws (council quorum, tie votes, minutes distribution)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_18'
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
