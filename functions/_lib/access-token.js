/**
 * Shared HMAC-signed token helpers for gating paid content.
 *
 * A token is base64url(JSON payload) + "." + base64url(HMAC-SHA256
 * signature of the payload, keyed by ACCESS_TOKEN_SECRET). Verification
 * needs nothing but the secret -- no database, no session store -- which
 * is what lets the token double as a durable "your personal link" a buyer
 * can bookmark, not just a cookie tied to one browser.
 *
 * There is deliberately no expiry: this backs a one-time "lifetime access
 * to this version" purchase, not a login session. PACK_VERSION is the
 * escape hatch -- if a future edition of the pack is different enough that
 * old purchasers shouldn't get it for free, bump PACK_VERSION here and
 * rotate ACCESS_TOKEN_SECRET in the Cloudflare Pages dashboard. That
 * invalidates every token issued so far without touching this file again.
 *
 * Tokens are scoped to a single product ('bc' or 'on') so a BC purchase
 * can never unlock the Ontario pack or vice versa -- signAccessToken embeds
 * the product it was issued for, and verifyAccessToken is told which
 * product the caller is trying to unlock and rejects any mismatch.
 */

const PACK_VERSION = 1;
const VALID_PRODUCTS = ['bc', 'on'];
const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// product: 'bc' | 'on' -- which pack this token unlocks. extra: small plain
// object of non-secret metadata to carry along (e.g. a truncated Stripe
// session id for support lookups). Never put anything sensitive in extra --
// the payload is base64, not encrypted.
export async function signAccessToken(secret, { product, ...extra } = {}) {
  if (!VALID_PRODUCTS.includes(product)) {
    throw new Error(`signAccessToken: unknown product "${product}"`);
  }
  const payload = Object.assign({ p: product, v: PACK_VERSION }, extra);
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`;
}

// product: 'bc' | 'on' -- the pack the caller is trying to unlock. Returns
// the decoded payload if the token's signature is valid and it was issued
// for this exact product and pack version, otherwise null. Never throws.
export async function verifyAccessToken(secret, token, product) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!sigB64) return null;

  let sigBytes;
  try {
    sigBytes = base64UrlDecode(sigB64);
  } catch (err) {
    return null;
  }

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadB64));
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch (err) {
    return null;
  }

  if (!payload || payload.p !== product || payload.v !== PACK_VERSION) return null;
  return payload;
}
