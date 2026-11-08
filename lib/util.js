'use strict';

/*
  Small, dependency-free helpers shared by API routes.
  Everything here is pure so it can be unit tested without a server.
*/

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escape a value for safe use in HTML text and quoted attributes. */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

/** Parse a JSON string, returning `fallback` instead of throwing. */
function parseJsonValue(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** True when a string looks like a single email address. */
function isEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 5 || email.length > 200) return false;
  if (/[\s<>",;]/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/** Trim, collapse whitespace and cap the length of free text. */
function singleLine(value, max = 200) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Strip control characters from multi-line text while keeping newlines. */
function multiLine(value, max = 5000) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

/** Keep digits and a leading `+`, for tel: and Paymob billing data. */
function normalizePhone(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return `${plus ? '+' : ''}${digits}`;
}

/** True when a phone number has a plausible international/Egyptian shape. */
function isPhone(value) {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/** Integer coercion that never returns NaN. */
function toInt(value, fallback = 0) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

/** Currency codes accepted by the store (ISO-4217 style, upper case). */
function isCurrencyCode(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Mask an email for display on public status pages. */
function maskEmail(value) {
  const email = String(value || '');
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? '***' : ''}@${domain}`;
}

module.exports = {
  escapeHtml,
  parseJsonValue,
  isEmail,
  singleLine,
  multiLine,
  normalizePhone,
  isPhone,
  toInt,
  isCurrencyCode,
  maskEmail
};
