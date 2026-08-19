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
 */

const PACK_VERSION = 1;
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

// extra: small plain object of non-secret metadata to carry along (e.g. a
// truncated Stripe session id for support lookups). Never put anything
// sensitive in here -- the payload is base64, not encrypted.
export async function signAccessToken(secret, extra) {
  const payload = Object.assign({ p: 'bc-starter-pack', v: PACK_VERSION }, extra || {});
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`;
}

// Returns the decoded payload if the token's signature is valid and it
// matches the current pack/version, otherwise null. Never throws.
export async function verifyAccessToken(secret, token) {
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

  if (!payload || payload.p !== 'bc-starter-pack' || payload.v !== PACK_VERSION) return null;
  return payload;
}
