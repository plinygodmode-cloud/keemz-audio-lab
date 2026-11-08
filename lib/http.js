'use strict';

/*
  HTTP plumbing for Vercel Node functions:
  consistent JSON envelopes, JSON-only mutation endpoints, safe error output.
*/

const { parseJsonValue } = require('./util');

/** Read and parse a JSON body from a Vercel request (string or pre-parsed). */
function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  const raw = req.body;
  if (raw === undefined || raw === null || raw === '') return { ok: false, status: 400, error: 'A JSON body is required.' };
  if (typeof raw === 'object') {
    if (Buffer.isBuffer(raw)) return parseBuffer(raw, maxBytes);
    return { ok: true, value: raw };
  }
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { ok: false, status: 413, error: 'Request body is too large.' };
    const parsed = parseJsonValue(raw, undefined);
    if (parsed === undefined) return { ok: false, status: 400, error: 'Request body must be valid JSON.' };
    return { ok: true, value: parsed };
  }
  return { ok: false, status: 400, error: 'Unsupported request body.' };
}

function parseBuffer(buffer, maxBytes) {
  if (buffer.length > maxBytes) return { ok: false, status: 413, error: 'Request body is too large.' };
  const parsed = parseJsonValue(buffer.toString('utf8'), undefined);
  if (parsed === undefined) return { ok: false, status: 400, error: 'Request body must be valid JSON.' };
  return { ok: true, value: parsed };
}

/** Reject anything that is not an explicitly JSON request (kills form CSRF). */
function requireJsonContentType(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) return true;
  // Allow Paymob to post without a JSON content type: its HMAC is verified.
  const url = String(req.url || '');
  return url.includes('paymob-webhook');
}

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function json(res, status, payload) {
  setCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
  return undefined;
}

function text(res, status, message) {
  setCommonHeaders(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(status).send(message);
  return undefined;
}

/** Log details server-side, return a generic-but-useful message to clients. */
function fail(res, status, message, error) {
  if (error) {
    const detail = error && error.stack ? error.stack : String(error);
    console.error(`[keemz] ${message}`, detail);
  }
  return json(res, status, { error: message });
}

function methodNotAllowed(res, allowed) {
  setCommonHeaders(res);
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { error: `Method not allowed. Use ${allowed.join(' or ')}.` });
}

module.exports = {
  readJsonBody,
  requireJsonContentType,
  setCommonHeaders,
  json,
  text,
  fail,
  methodNotAllowed
};
