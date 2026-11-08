'use strict';

const crypto = require('node:crypto');

/*
  Cryptographic helpers: constant-time comparison, HMAC signing and the
  short-lived tokens that carry order references and download rights.

  Two independent secrets are used:
    - PAYMENT_SIGNING_SECRET  -> order references + return-page tokens
    - DOWNLOAD_TOKEN_SECRET   -> per-download links
  Tokens are always `<base64url(json)>.<hex hmac>` so the payload is opaque
  and tamper-evident. Nothing secret is ever placed in a token.
*/

/** Constant-time string comparison that tolerates different lengths. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a === undefined || a === null ? '' : a), 'utf8');
  const right = Buffer.from(String(b === undefined || b === null ? '' : b), 'utf8');
  if (left.length !== right.length) {
    // Still burn the same amount of work on a length mismatch.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/** Hex HMAC digest. Throws when the secret is missing (handled by callers). */
function hmacHex(secret, payload, algorithm = 'sha256') {
  return crypto.createHmac(algorithm, secret).update(payload).digest('hex');
}

/** Sign an arbitrary JSON payload into an opaque, tamper-evident token. */
function signPayload(payload, secret) {
  if (!secret) throw new Error('A signing secret is required');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = hmacHex(secret, body);
  return `${body}.${signature}`;
}

/** Verify a token created by `signPayload`. Returns the payload or null. */
function verifyPayload(token, secret, { maxAgeMs } = {}) {
  if (!secret || typeof token !== 'string' || token.length > 4096) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/i.test(signature)) return null;
  if (!safeEqual(hmacHex(secret, body), signature)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (maxAgeMs && Number.isFinite(payload.iat) && Date.now() - payload.iat > maxAgeMs) return null;
  return payload;
}

const REF_PREFIX = 'KAL-';

/** Build the `special_reference` Paymob echoes back as merchant_order_id. */
function makeOrderRef() {
  return `${REF_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
}

/** True when a reference has the exact shape we generate. */
function isOrderRef(value) {
  return typeof value === 'string' && /^KAL-[a-f0-9]{24}$/.test(value);
}

/** Token embedded in the Paymob redirection URL so the return page can
 *  ask the server about this specific order (never about anybody else's). */
function issueReturnToken(ref, secret, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  return signPayload({ v: 1, ref, iat: Date.now(), exp: Date.now() + ttlMs }, secret);
}

function readReturnToken(token, secret) {
  const payload = verifyPayload(token, secret);
  if (!payload || !isOrderRef(payload.ref) || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
    return null;
  }
  return payload;
}

/** Per-product, per-order, expiring download token. */
function issueDownloadToken(data, secret, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  if (!secret) throw new Error('DOWNLOAD_TOKEN_SECRET is required');
  return signPayload(
    {
      v: 1,
      ref: data.ref,
      pid: data.productId,
      txn: String(data.transactionId),
      em: data.email,
      iat: Date.now(),
      exp: Date.now() + ttlMs
    },
    secret
  );
}

function readDownloadToken(token, secret) {
  const payload = verifyPayload(token, secret);
  if (!payload || payload.v !== 1) return null;
  if (!isOrderRef(payload.ref) || typeof payload.pid !== 'string' || !payload.pid) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

/** Best-effort client IP. Vercel sets x-forwarded-for; never trust for auth. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = String(raw || '').split(',')[0].trim();
  const ip = first || req.socket?.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:/, '').slice(0, 64) || 'unknown';
}

/**
 * Validate the browser Origin for state-changing requests.
 * Returns { ok, reason }.
 *
 * Allowed when:
 *   · the request has no Origin header (server-to-server, curl, some privacy
 *     modes) — the payload is still fully validated and rate limited;
 *   · the Origin exactly matches an allowed origin (SITE_URL, ALLOWED_ORIGINS);
 *   · the Origin host matches the host actually serving the request, which is
 *     same-origin by definition and keeps preview deployments working without
 *     extra configuration.
 * A cross-site page can never satisfy the last two, because the browser sets
 * Origin itself.
 */
function checkOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) {
    // Cross-site form posts cannot set JSON content type; those are rejected
    // separately. Browsers that omit Origin are same-origin requests.
    return { ok: true, reason: 'no-origin' };
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: 'malformed-origin' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, reason: 'bad-protocol' };

  const normalized = `${parsed.protocol}//${parsed.host}`;
  if (allowedOrigins.includes(normalized)) return { ok: true, reason: 'allowlisted' };

  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (requestHost && parsed.host.toLowerCase() === requestHost) {
    return { ok: true, reason: 'same-origin' };
  }

  return { ok: false, reason: 'origin-not-allowed' };
}

module.exports = {
  safeEqual,
  hmacHex,
  signPayload,
  verifyPayload,
  makeOrderRef,
  isOrderRef,
  issueReturnToken,
  readReturnToken,
  issueDownloadToken,
  readDownloadToken,
  clientIp,
  checkOrigin
};
