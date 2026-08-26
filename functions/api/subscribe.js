/**
 * POST /api/subscribe  —  Cloudflare Pages Function
 *
 * The subscribe form on the tool pages posts here (same origin, so no CORS and
 * no third-party script). This function forwards the address to beehiiv using
 * the API key, which must never reach the browser.
 *
 * Required environment variables, set in the Cloudflare Pages dashboard under
 * Settings -> Environment variables (add as a SECRET, not plaintext):
 *
 *   BEEHIIV_API_KEY          - beehiiv API key (Settings -> API in beehiiv)
 *   BEEHIIV_PUBLICATION_ID   - publication id, e.g. pub_xxxxxxxx-....
 *
 * Neither value belongs in this repository.
 */

import { count } from '../_lib/count.js';

const BEEHIIV_API = 'https://api.beehiiv.com/v2';

// Deliberately permissive: the goal is to reject obvious typos and junk, not to
// adjudicate RFC 5322. beehiiv does the authoritative validation.
function looksLikeEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.BEEHIIV_API_KEY;
  const publicationId = env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !publicationId) {
    // Configuration problem, not the visitor's fault. Log-worthy, but do not
    // leak which variable is missing to the browser.
    console.error('subscribe: missing BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID');
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  let email = '';
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = (body && body.email) || '';
    } else {
      const form = await request.formData();
      email = form.get('email') || '';
    }
  } catch (err) {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  email = String(email).trim();
  if (!looksLikeEmail(email)) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(
      `${BEEHIIV_API}/publications/${encodeURIComponent(publicationId)}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: true,
          utm_source: 'knowyourstrata.com',
          utm_medium: 'tool_page'
        })
      }
    );
  } catch (err) {
    console.error('subscribe: upstream fetch failed', err);
    return json({ ok: false, error: 'upstream_unreachable' }, 502);
  }

  if (upstream.ok) {
    // Counted server-side: the signup that matters is the one beehiiv accepted.
    await count(env, 'subscribed');
    return json({ ok: true }, 200);
  }

  // Surface a category to the browser, never the upstream body: it can contain
  // account details, and a 4xx here is usually a configuration fault.
  const detail = await upstream.text().catch(() => '');
  console.error('subscribe: beehiiv returned', upstream.status, detail.slice(0, 500));

  if (upstream.status === 400 || upstream.status === 422) {
    return json({ ok: false, error: 'rejected' }, 400);
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }
  if (upstream.status === 429) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }
  return json({ ok: false, error: 'upstream_error' }, 502);
}

// Only onRequestPost is exported, so Pages answers any other method with 405.
