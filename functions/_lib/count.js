/**
 * First-party event counting.
 *
 * The whole design constraint is the promise on /privacy: no cookies beyond
 * the one that unlocks a purchased pack, no cross-site trackers, no
 * fingerprinting, and therefore no consent banner. So this stores exactly one
 * thing: how many times a named event happened on a given day.
 *
 * There is no visitor identifier, no session, no IP address, no user agent and
 * no referrer anywhere in this file or in the table it writes to. Two people
 * doing the same thing are indistinguishable from one person doing it twice --
 * that is a deliberate accuracy cost, paid to keep the privacy claim true.
 *
 * Storage is Cloudflare D1, bound as DB. If the binding is missing the
 * counters silently do nothing: analytics must never be able to break a
 * calculator or a checkout.
 */

// Only these names are ever written. An unknown name is dropped rather than
// stored, so a malicious or buggy caller cannot fill the table with junk.
export const EVENTS = {
  tool_used: 'a calculator was run',
  pack_view: 'a Starter Pack sales page was opened',
  pack_click: 'the Stripe checkout link was clicked',
  subscribed: 'an address joined the list (counted server-side)',
  purchased: 'a pack was paid for (counted server-side)'
};

// Detail is a small closed vocabulary, never free text.
const TOOL_SLUGS = new Set([
  'bc/agm-notice', 'bc/special-levy', 'bc/quorum', 'bc/voting-threshold',
  'bc/records-deadline', 'bc/strata-fees', 'bc/crf-contribution',
  'bc/insurance-deductible', 'bc/fine-enforcement-procedure',
  'bc/meeting-minutes-generator', 'bc/depreciation-report-deadline',
  'on/quorum', 'on/notice-of-meeting-deadline', 'on/records-request-deadline',
  'on/requisition-threshold', 'on/reserve-fund-study-deadline'
]);
const PACKS = new Set(['bc', 'on']);

export function validate(name, detail) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, name)) return null;
  detail = typeof detail === 'string' ? detail : '';

  if (name === 'tool_used') {
    return TOOL_SLUGS.has(detail) ? { name, detail } : null;
  }
  if (name === 'pack_view' || name === 'pack_click' || name === 'purchased') {
    return PACKS.has(detail) ? { name, detail } : null;
  }
  return { name, detail: '' };   // subscribed carries no detail
}

function utcDay(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

/**
 * Increment one counter. Never throws: a failure here must not surface to the
 * visitor, and must never take a checkout or a subscribe down with it.
 * Returns true only if a row was actually written.
 */
export async function count(env, name, detail) {
  try {
    if (!env || !env.DB) return false;
    const ok = validate(name, detail);
    if (!ok) return false;

    await env.DB.prepare(
      `INSERT INTO events (day, name, detail, count) VALUES (?, ?, ?, 1)
         ON CONFLICT (day, name, detail) DO UPDATE SET count = count + 1`
    ).bind(utcDay(), ok.name, ok.detail).run();
    return true;
  } catch (err) {
    console.error('count: failed', name, detail, err && err.message);
    return false;
  }
}
