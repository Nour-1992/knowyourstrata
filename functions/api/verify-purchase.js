/**
 * GET /api/verify-purchase?session_id={CHECKOUT_SESSION_ID}
 *                                                —  Cloudflare Pages Function
 *
 * Shared verification endpoint for both paid packs (BC and Ontario). Each
 * pack's live Stripe payment link has "After payment" set to redirect here:
 *
 *   https://knowyourstrata.com/api/verify-purchase?session_id={CHECKOUT_SESSION_ID}
 *
 * Stripe substitutes {CHECKOUT_SESSION_ID} itself -- that literal string is
 * the placeholder syntax, not something to fill in by hand.
 *
 * The redirect alone proves nothing (anyone can type this URL with a made
 * up value), so this function calls back to Stripe with the secret key to
 * confirm the session actually paid, reads which of the two known products
 * was purchased from the line items -- both packs are priced identically,
 * so the amount alone can't tell them apart -- and issues a signed access
 * token scoped to that specific product, as both an HttpOnly cookie and a
 * `?t=` query param, so the link still works as a personal bookmark if the
 * cookie is ever lost (cleared, different browser, different device).
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

const PACK_PRICE_CENTS = 4900;
const PACK_CURRENCY = 'cad';
const ONE_DECADE_SECONDS = 315360000; // ~10 years; see access-token.js on why there's no real expiry

// Both packs cost the same CAD $49, so a purchase is identified by Stripe
// product ID, not amount. These IDs come from the Stripe dashboard and are
// the source of truth if a product is ever recreated.
const PRODUCTS = {
  bc: {
    stripeProductId: 'prod_V6RK3he5rYlmn0',
    redeemDestination: '/bc/starter-pack-full',
    salesPage: '/bc/starter-pack'
  },
  on: {
    stripeProductId: 'prod_V7DKsU1Vf6JNFT',
    redeemDestination: '/on/starter-pack-full',
    salesPage: '/on/starter-pack'
  }
};

function findProduct(stripeProductId) {
  for (const [key, cfg] of Object.entries(PRODUCTS)) {
    if (cfg.stripeProductId === stripeProductId) return { key, ...cfg };
  }
  return null;
}

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
    // No product is known yet at this point, so there is no single correct
    // pack to send the buyer back to -- fail closed to the homepage rather
    // than defaulting to either one.
    return redirect('/?checkout=unavailable');
  }

  // Stripe checkout session ids always look like cs_[live|test]_...; reject
  // anything else before spending a call on it.
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return redirect('/?checkout=missing');
  }

  let session;
  try {
    const upstream = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    if (!upstream.ok) {
      console.error('verify-purchase: Stripe lookup failed', upstream.status);
      return redirect('/?checkout=unverified');
    }
    session = await upstream.json();
  } catch (err) {
    console.error('verify-purchase: Stripe fetch error', err);
    return redirect('/?checkout=unverified');
  }

  // Identify which product was purchased from the line items. This works
  // regardless of payment_status, so an incomplete session can still be
  // sent back to its OWN sales page below instead of a generic one.
  const items = (session.line_items && session.line_items.data) || [];
  let matched = null;
  let matchedItem = null;
  for (const item of items) {
    const priceProduct = item.price && item.price.product;
    const productId = typeof priceProduct === 'string' ? priceProduct : priceProduct && priceProduct.id;
    const found = productId && findProduct(productId);
    if (found) {
      matched = found;
      matchedItem = item;
      break;
    }
  }

  if (!matched) {
    // Fails closed rather than guessing: an unrecognized product must not
    // land on either pack's gated content, or even either pack's sales
    // page, since we don't actually know which one (if either) applies.
    console.error('verify-purchase: session paid but no line item matched a known product', sessionId);
    return redirect('/?checkout=mismatch');
  }

  if (session.payment_status !== 'paid') {
    return redirect(`${matched.salesPage}?checkout=incomplete`);
  }

  // Defense in depth: confirm the matched line item actually charged the
  // pack's price, in case a price or discount ever changes without this
  // constant being updated to match.
  //
  // Compare amount_SUBTOTAL, not amount_total. The payment links have
  // "collect tax automatically" switched on, and amount_total is defined as
  // the figure AFTER tax. Stripe Tax currently calculates zero because the
  // account has no tax registrations, so the two happen to be equal today --
  // but the day a GST/HST registration is added, every amount_total arrives
  // as price + tax, fails this check, and bounces a paying customer to
  // ?checkout=mismatch. amount_subtotal is the pre-tax figure and is what
  // this comparison actually means.
  if (matchedItem.amount_subtotal !== PACK_PRICE_CENTS || session.currency !== PACK_CURRENCY) {
    console.error('verify-purchase: matched product but amount does not match the pack price', sessionId, matched.key);
    return redirect(`${matched.salesPage}?checkout=mismatch`);
  }

  // Only the last few characters of the session id are kept, purely as a
  // support/debugging breadcrumb -- never enough to look up the purchase
  // in Stripe on its own.
  const token = await signAccessToken(tokenSecret, { product: matched.key, ref: sessionId.slice(-12) });

  const headers = new Headers();
  headers.set('Location', `${matched.redeemDestination}?t=${token}`);
  headers.set('Cache-Control', 'no-store');
  headers.append(
    'Set-Cookie',
    `kys_access=${token}; Path=${matched.redeemDestination}; Max-Age=${ONE_DECADE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );

  return new Response(null, { status: 302, headers });
}
