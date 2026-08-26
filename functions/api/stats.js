/**
 * GET /api/stats?key=<STATS_KEY>  —  Cloudflare Pages Function
 *
 * Reads the funnel back out. Guarded by a shared secret in the STATS_KEY
 * environment variable, the same pattern the watcher's /status uses. Without a
 * correct key it answers 404, not 401: an unauthenticated caller should not
 * learn that this endpoint exists.
 *
 * Optional: ?days=N  (default 30, max 365)
 *
 * The response is aggregate counts only, because aggregate counts are the only
 * thing stored. There is nothing per-visitor to return.
 */
import { EVENTS } from '../_lib/count.js';

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

const notFound = () => new Response('Not found', { status: 404 });

/** Constant-time-ish compare, so the key cannot be guessed a character at a time. */
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const secret = env.STATS_KEY;
  if (!secret) return notFound();

  const url = new URL(request.url);
  if (!sameKey(url.searchParams.get('key') || '', secret)) return notFound();

  if (!env.DB) {
    return json({ ok: false, error: 'no_database_binding',
                  hint: 'Bind a D1 database as DB in the Pages project settings.' }, 503);
  }

  let days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > 365) days = 365;

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  try {
    const rows = (await env.DB.prepare(
      `SELECT day, name, detail, count FROM events
        WHERE day >= ? ORDER BY day DESC, name ASC, detail ASC`
    ).bind(since).all()).results || [];

    const totals = {};
    const byDetail = {};
    const byDay = {};
    for (const r of rows) {
      totals[r.name] = (totals[r.name] || 0) + r.count;
      if (r.detail) {
        byDetail[r.name] = byDetail[r.name] || {};
        byDetail[r.name][r.detail] = (byDetail[r.name][r.detail] || 0) + r.count;
      }
      byDay[r.day] = byDay[r.day] || {};
      byDay[r.day][r.name] = (byDay[r.day][r.name] || 0) + r.count;
    }

    const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : null);
    const t = (k) => totals[k] || 0;

    return json({
      ok: true,
      window: { days, since, until: new Date().toISOString().slice(0, 10) },
      legend: EVENTS,
      totals,
      funnel: {
        tool_used: t('tool_used'),
        pack_view: t('pack_view'),
        pack_click: t('pack_click'),
        purchased: t('purchased'),
        subscribed: t('subscribed'),
        rates: {
          tool_to_pack_view: pct(t('pack_view'), t('tool_used')),
          pack_view_to_click: pct(t('pack_click'), t('pack_view')),
          click_to_purchase: pct(t('purchased'), t('pack_click')),
          tool_to_purchase: pct(t('purchased'), t('tool_used')),
          tool_to_subscribe: pct(t('subscribed'), t('tool_used'))
        }
      },
      by_detail: byDetail,
      by_day: byDay,
      note: 'Counts only. No visitor identifier, session, IP or user agent is stored, ' +
            'so these are event counts and not unique people.'
    }, 200);
  } catch (err) {
    console.error('stats: query failed', err && err.message);
    return json({ ok: false, error: 'query_failed' }, 500);
  }
}
