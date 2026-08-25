/**
 * GET /bc/starter-pack-full  —  Cloudflare Pages Function
 *
 * Gates the paid BC Board Starter Pack content. Cloudflare Pages Functions
 * take precedence over static assets on an exact route match, so this runs
 * instead of the static bc/starter-pack-full.html file for this clean URL.
 * The .html form of the same path 301s here too (see _redirects), so there
 * is no longer a direct static route to the file that skips this check.
 *
 * Access requires a valid signed token (see functions/_lib/access-token.js),
 * supplied either as the `kys_access` cookie -- set automatically by
 * /api/verify-purchase right after checkout -- or as a `?t=` query param,
 * which is the same token and lets a saved link work even without the
 * cookie (a different browser, a cleared cache, a new device).
 *
 * Required environment variable: ACCESS_TOKEN_SECRET (see
 * functions/api/verify-purchase.js for where it comes from).
 */

import { verifyAccessToken } from '../_lib/access-token.js';

const SALES_PAGE = '/bc/starter-pack';
const ONE_DECADE_SECONDS = 315360000;

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// Response.redirect() with a URL object argument silently drops the query
// string in this Workers runtime (confirmed by live testing right after
// f2d841d shipped -- verify-purchase.js's plain-string Location headers
// were unaffected, which is what pointed at the URL-object argument).
function redirectTo(path, request) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(path, request.url).toString(),
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet({ request, env }) {
  const tokenSecret = env.ACCESS_TOKEN_SECRET;
  if (!tokenSecret) {
    console.error('starter-pack-full: missing ACCESS_TOKEN_SECRET');
    return redirectTo(SALES_PAGE, request);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || readCookie(request, 'kys_access');
  const payload = token ? await verifyAccessToken(tokenSecret, token, 'bc') : null;

  if (!payload) {
    return redirectTo(`${SALES_PAGE}?access=required`, request);
  }

  // env.ASSETS.fetch reaches the deployed static file directly -- it does
  // not re-enter this function, so this is not recursive. This is the one
  // and only place bc/starter-pack-full.html is ever actually served from.
  const asset = await env.ASSETS.fetch(request);

  // Re-set the cookie on every visit so a link opened via ?t= (no cookie
  // yet, e.g. a new device) becomes cookie-backed too, and so the cookie's
  // Max-Age keeps rolling forward for people who do return regularly.
  const headers = new Headers(asset.headers);
  headers.append(
    'Set-Cookie',
    `kys_access=${token}; Path=/bc/starter-pack-full; Max-Age=${ONE_DECADE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );

  // Stamp the token onto <body> so the page can show the buyer their own
  // permanent link. This matters most on a RETURN visit: the cookie alone
  // gets them in, but the URL then carries no token, so without this the
  // page has no way to tell them what link to save. The cookie is HttpOnly
  // and deliberately stays that way -- this attribute is the token the
  // buyer already has, surfaced deliberately, not a second credential.
  const stamped = new HTMLRewriter()
    .on('body', {
      element(el) { el.setAttribute('data-access-token', token); }
    })
    .transform(new Response(asset.body, { status: asset.status, headers }));

  return stamped;
}
