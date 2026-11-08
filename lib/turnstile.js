'use strict';

/*
  Optional Cloudflare Turnstile check. Enabled only when
  TURNSTILE_SECRET_KEY is configured; the browser then sends a token from
  the widget enabled by `turnstileSiteKey` in assets/site-config.js.
*/

async function verifyTurnstile({ secret, token, remoteIp, expectedHostname }) {
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'missing-token' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      return { ok: false, reason: 'verification-failed', codes: data['error-codes'] || [] };
    }
    if (expectedHostname && data.hostname && data.hostname !== expectedHostname) {
      return { ok: false, reason: 'hostname-mismatch' };
    }
    return { ok: true };
  } catch (error) {
    console.error('[keemz] Turnstile verification error:', error.message);
    // Fail closed: the secret is configured, so a token is required.
    return { ok: false, reason: 'verification-error' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { verifyTurnstile };
