/**
 * GET /api/verify-purchase?session_id={CHECKOUT_SESSION_ID}
 *                                                —  Cloudflare Pages Function
 *
 * The BC Board Starter Pack's live Stripe payment link should have "After
 * payment" set to redirect here:
 *
 *   https://knowyourstrata.com/api/verify-purchase?session_id={CHECKOUT_SESSION_ID}
 *
 * Stripe substitutes {CHECKOUT_SESSION_ID} itself -- that literal string is
 * the placeholder syntax, not something to fill in by hand.
 *
 * The redirect alone proves nothing (anyone can type this URL with a made
 * up value), so this function calls back to Stripe with the secret key to
 * confirm the session actually paid, then issues a signed access token for
 * the gated content -- as both an HttpOnly cookie and a `?t=` query param,
 * so the link still works as a personal bookmark if the cookie is ever
 * lost (cleared, different browser, different device).
 *
 * Required environment variables (Cloudflare Pages dashboard -> Settings ->
 * Environment variables, added as SECRETS, same as BEEHIIV_API_KEY):
 *
 *   STRIPE_SECRET_KEY     - live secret key from the Stripe dashboard
 *                           (Developers -> API keys). Starts with sk_live_.
 *   ACCESS_TOKEN_SECRET   - any long random string, used only to sign pack
 *                           access tokens. Not a Stripe value -- generate
 *                           one and keep it out of this repository.
 *
 * Neither value belongs in this repository.
 */

import { signAccessToken } from '../_lib/access-token.js';

const PACK_PRICE_CENTS = 3900;
const PACK_CURRENCY = 'usd';
const REDEEM_DESTINATION = '/bc/starter-pack-full';
const SALES_PAGE = '/bc/starter-pack';
const ONE_DECADE_SECONDS = 315360000; // ~10 years; see access-token.js on why there's no real expiry

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  const secretKey = env.STRIPE_SECRET_KEY;
  const tokenSecret = env.ACCESS_TOKEN_SECRET;
  if (!secretKey || !tokenSecret) {
    console.error('verify-purchase: missing STRIPE_SECRET_KEY or ACCESS_TOKEN_SECRET');
    return redirect(`${SALES_PAGE}?checkout=unavailable`);
  }

  // Stripe checkout session ids always look like cs_[live|test]_...; reject
  // anything else before spending a call on it.
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return redirect(`${SALES_PAGE}?checkout=missing`);
  }

  let session;
  try {
    const upstream = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    if (!upstream.ok) {
      console.error('verify-purchase: Stripe lookup failed', upstream.status);
      return redirect(`${SALES_PAGE}?checkout=unverified`);
    }
    session = await upstream.json();
  } catch (err) {
    console.error('verify-purchase: Stripe fetch error', err);
    return redirect(`${SALES_PAGE}?checkout=unverified`);
  }

  if (session.payment_status !== 'paid') {
    return redirect(`${SALES_PAGE}?checkout=incomplete`);
  }

  // Defense in depth: confirm the session actually paid the pack's price,
  // in case this endpoint is ever pointed to by a different payment link
  // by mistake. Checked against both the session total and the line item,
  // since expand[]=line_items isn't guaranteed to be non-empty on every
  // Stripe API version.
  const items = (session.line_items && session.line_items.data) || [];
  const paidForPack =
    items.some((item) => item.amount_total === PACK_PRICE_CENTS) ||
    (session.amount_total === PACK_PRICE_CENTS && session.currency === PACK_CURRENCY);

  if (!paidForPack) {
    console.error('verify-purchase: session paid but amount does not match the pack price', sessionId);
    return redirect(`${SALES_PAGE}?checkout=mismatch`);
  }

  // Only the last few characters of the session id are kept, purely as a
  // support/debugging breadcrumb -- never enough to look up the purchase
  // in Stripe on its own.
  const token = await signAccessToken(tokenSecret, { ref: sessionId.slice(-12) });

  const headers = new Headers();
  headers.set('Location', `${REDEEM_DESTINATION}?t=${token}`);
  headers.set('Cache-Control', 'no-store');
  headers.append(
    'Set-Cookie',
    `kys_access=${token}; Path=/bc/starter-pack-full; Max-Age=${ONE_DECADE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );

  return new Response(null, { status: 302, headers });
}
