'use strict';

/*
  Central environment/configuration reader.
  Nothing in here may be imported by browser code — it reads server secrets.
*/

const { parseJsonValue, isCurrencyCode } = require('./util');

const isProduction = () =>
  process.env.VERCEL_ENV === 'production' ||
  (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV);

const cleanUrl = value => String(value || '').trim().replace(/\/+$/, '');

/**
 * Canonical public origin used in Paymob callbacks and download emails.
 * Falls back to the Vercel deployment URL so preview deployments work.
 */
function siteUrl() {
  const explicit = cleanUrl(process.env.SITE_URL);
  if (explicit) return explicit;
  const vercel = cleanUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  if (vercel) return vercel.startsWith('http') ? vercel : `https://${vercel}`;
  return '';
}

/** Origins allowed to call the JSON APIs from a browser. */
function allowedOrigins() {
  const origins = new Set();
  const canonical = siteUrl();
  if (canonical) {
    try {
      const url = new URL(canonical);
      origins.add(`${url.protocol}//${url.host}`);
    } catch {
      /* ignore malformed SITE_URL; the health endpoint reports it */
    }
  }
  for (const extra of String(process.env.ALLOWED_ORIGINS || '').split(',')) {
    const value = cleanUrl(extra);
    if (!value) continue;
    try {
      const url = new URL(value);
      origins.add(`${url.protocol}//${url.host}`);
    } catch {
      /* ignore */
    }
  }
  return [...origins];
}

/**
 * When true (default outside production) the in-memory order store is
 * accepted so `npm run dev` works without Redis. In production fulfilment
 * fails closed unless KV/Upstash is configured.
 */
function allowEphemeralStore() {
  const flag = String(process.env.ALLOW_EPHEMERAL_STORE || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return !isProduction();
}

function currency() {
  const value = String(process.env.PAYMOB_CURRENCY || 'EGP').toUpperCase();
  return isCurrencyCode(value) ? value : 'EGP';
}

function region() {
  const value = String(process.env.PAYMOB_REGION || 'eg').trim().toLowerCase();
  return ['eg', 'ksa', 'uae', 'om'].includes(value) ? value : 'eg';
}

/** Paymob REST base (intention API), e.g. https://accept.paymob.com */
function paymobApiBase() {
  const configured = cleanUrl(process.env.PAYMOB_BASE_URL);
  if (configured) return configured;
  return {
    eg: 'https://accept.paymob.com',
    ksa: 'https://ksa.paymob.com',
    uae: 'https://uae.paymob.com',
    om: 'https://oman.paymob.com'
  }[region()];
}

/**
 * Hosted Unified Checkout origin. Per Paymob's current documentation this is
 * https://eg.checkout.paymob.com/ (NOT accept.paymob.com/unifiedcheckout).
 */
function paymobCheckoutBase() {
  const configured = cleanUrl(process.env.PAYMOB_CHECKOUT_URL);
  if (configured) return configured;
  return {
    eg: 'https://eg.checkout.paymob.com',
    ksa: 'https://ksa.checkout.paymob.com',
    uae: 'https://uae.checkout.paymob.com',
    om: 'https://om.checkout.paymob.com'
  }[region()];
}

const CONTACT_SERVICES = [
  'Beat production',
  'Sound design',
  'Mixing & mastering',
  'Stem separation',
  'Custom sample pack',
  'Other / collaboration'
];

function contactServices() {
  const configured = String(process.env.CONTACT_SERVICES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return configured.length ? configured : CONTACT_SERVICES;
}

/** Products/objects/limits shared by catalogue, checkout and delivery. */
function catalogConfig() {
  const productsText = process.env.PRODUCTS_JSON;
  const objectsText = process.env.DOWNLOAD_OBJECTS_JSON;
  const parsedProducts = productsText ? parseJsonValue(productsText, null) : [];
  const parsedObjects = objectsText ? parseJsonValue(objectsText, null) : {};
  const parseErrors = [];
  if (productsText && parsedProducts === null) parseErrors.push('PRODUCTS_JSON is not valid JSON.');
  if (objectsText && parsedObjects === null) parseErrors.push('DOWNLOAD_OBJECTS_JSON is not valid JSON.');
  return {
    rawProducts: parsedProducts === null ? [] : parsedProducts,
    productsInvalid: parsedProducts === null,
    rawObjects: parsedObjects === null ? {} : parsedObjects,
    objectsInvalid: parsedObjects === null,
    parseErrors,
    currency: currency(),
    maxDistinctItems: 12,
    maxQuantityPerItem: 10,
    maxOrderTotalMinor: 100_000_000
  };
}

function paymobConfig() {
  return {
    secretKey: String(process.env.PAYMOB_SECRET_KEY || '').trim(),
    publicKey: String(process.env.PAYMOB_PUBLIC_KEY || '').trim(),
    integrationId: Number(process.env.PAYMOB_INTEGRATION_ID || 0),
    hmacSecret: String(process.env.PAYMOB_HMAC_SECRET || '').trim(),
    currency: currency(),
    region: region(),
    apiBase: paymobApiBase(),
    checkoutBase: paymobCheckoutBase(),
    city: String(process.env.PAYMOB_CITY || 'Cairo').trim(),
    state: String(process.env.PAYMOB_STATE || 'Cairo').trim(),
    postalCode: String(process.env.PAYMOB_POSTAL_CODE || '00000').trim(),
    country: String(process.env.PAYMOB_COUNTRY || 'EG').trim().toUpperCase()
  };
}

function emailConfig() {
  return {
    resendKey: String(process.env.RESEND_API_KEY || '').trim(),
    from: String(process.env.EMAIL_FROM || '').trim(),
    replyTo: String(process.env.EMAIL_REPLY_TO || '').trim(),
    contactTo: String(process.env.CONTACT_TO_EMAIL || '').trim(),
    deliveryBcc: String(process.env.DELIVERY_BCC_EMAIL || '').trim()
  };
}

function turnstileConfig() {
  return {
    secret: String(process.env.TURNSTILE_SECRET_KEY || '').trim(),
    // Optional: when set, tokens are validated against this host only.
    expectedHostname: String(process.env.TURNSTILE_EXPECTED_HOSTNAME || '').trim()
  };
}

function r2Config() {
  return {
    accountId: String(process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: String(process.env.R2_BUCKET_NAME || '').trim(),
    signedUrlSeconds: Math.min(Math.max(Number(process.env.R2_SIGNED_URL_SECONDS) || 120, 30), 900)
  };
}

function signingSecrets() {
  return {
    payment: String(process.env.PAYMENT_SIGNING_SECRET || '').trim(),
    download: String(process.env.DOWNLOAD_TOKEN_SECRET || '').trim()
  };
}

/**
 * Everything that must be configured before the store may take money.
 * Fulfilment and email delivery are deliberately part of this gate: we do
 * not accept a payment we cannot deliver.
 */
function storeReadiness() {
  const paymob = paymobConfig();
  const email = emailConfig();
  const r2 = r2Config();
  const secrets = signingSecrets();
  const catalog = catalogConfig();

  const missing = [];
  const site = siteUrl();
  if (!site) missing.push('SITE_URL');
  else if (isProduction() && !site.startsWith('https://')) {
    // Paymob will not call back to an http:// origin, and we do not want to
    // take a payment we cannot fulfil.
    missing.push('SITE_URL (must be an https origin in production)');
  }
  if (!paymob.secretKey) missing.push('PAYMOB_SECRET_KEY');
  if (!paymob.publicKey) missing.push('PAYMOB_PUBLIC_KEY');
  if (!Number.isSafeInteger(paymob.integrationId) || paymob.integrationId < 1) missing.push('PAYMOB_INTEGRATION_ID');
  if (!paymob.hmacSecret) missing.push('PAYMOB_HMAC_SECRET');
  if (!secrets.payment) missing.push('PAYMENT_SIGNING_SECRET');
  if (!secrets.download) missing.push('DOWNLOAD_TOKEN_SECRET');
  if (!email.resendKey) missing.push('RESEND_API_KEY');
  if (!email.from) missing.push('EMAIL_FROM');
  if (!Array.isArray(catalog.rawProducts)) missing.push('PRODUCTS_JSON (must be a JSON array)');
  if (!catalog.rawObjects || typeof catalog.rawObjects !== 'object' || Array.isArray(catalog.rawObjects)) {
    missing.push('DOWNLOAD_OBJECTS_JSON (must be a JSON object)');
  }
  if (!r2.accountId) missing.push('R2_ACCOUNT_ID');
  if (!r2.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!r2.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!r2.bucket) missing.push('R2_BUCKET_NAME');

  const { durable } = require('./store').storeInfo();
  if (!durable && !allowEphemeralStore()) missing.push('KV_REST_API_URL + KV_REST_API_TOKEN (order store)');

  return { ready: missing.length === 0, missing };
}

module.exports = {
  isProduction,
  siteUrl,
  allowedOrigins,
  allowEphemeralStore,
  currency,
  region,
  paymobApiBase,
  paymobCheckoutBase,
  paymobConfig,
  emailConfig,
  turnstileConfig,
  r2Config,
  signingSecrets,
  catalogConfig,
  contactServices,
  storeReadiness,
  CONTACT_SERVICES
};
