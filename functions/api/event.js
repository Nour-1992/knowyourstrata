/**
 * POST /api/event  —  Cloudflare Pages Function
 *
 * The browser-side half of the funnel counter. Same origin, so no CORS and no
 * third-party script anywhere on the site.
 *
 * Accepts a JSON body {name, detail}. Both are checked against a closed
 * vocabulary in _lib/count.js; anything else is dropped. Nothing about the
 * caller is recorded -- no IP, no user agent, no referrer, no cookie, no id.
 *
 * Always answers 204, whether the event was counted, dropped as unknown, or
 * failed to write. That is deliberate: this endpoint must reveal nothing about
 * the shape of the allowlist to a prober, and must never give the page a
 * reason to show an error to a council trying to calculate a deadline.
 */
import { count } from '../_lib/count.js';

const NO_CONTENT = { status: 204, headers: { 'Cache-Control': 'no-store' } };

export async function onRequestPost({ request, env }) {
  try {
    let name = '';
    let detail = '';

    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const body = await request.json();
      name = (body && body.name) || '';
      detail = (body && body.detail) || '';
    } else {
      // sendBeacon defaults to text/plain, which is the common path here.
      const text = await request.text();
      if (text) {
        const body = JSON.parse(text);
        name = (body && body.name) || '';
        detail = (body && body.detail) || '';
      }
    }

    // Bounded before anything touches the database.
    if (typeof name !== 'string' || name.length > 40) return new Response(null, NO_CONTENT);
    if (typeof detail !== 'string' || detail.length > 60) return new Response(null, NO_CONTENT);

    await count(env, name, detail);
  } catch (err) {
    // A malformed body is not worth a log line, let alone an error response.
  }
  return new Response(null, NO_CONTENT);
}

// Any other method gets 405 from Pages, since only onRequestPost is exported.
