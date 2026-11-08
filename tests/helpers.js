'use strict';

/*
  Minimal request/response harness so the Vercel handlers can be exercised
  with node:test, without Vercel, a database or any network access.
*/

const crypto = require('node:crypto');
const { transactionHmacMessage } = require('../lib/paymob');
const { __resetMemory } = require('../lib/store');

const BASE_ENV = {
  NODE_ENV: 'test',
  VERCEL_ENV: 'development',
  ALLOW_EPHEMERAL_STORE: 'true',
  SITE_URL: 'https://keemzaudiolab.test',
  PAYMOB_BASE_URL: 'https://accept.paymob.com',
  PAYMOB_SECRET_KEY: 'sk_test_example',
  PAYMOB_PUBLIC_KEY: 'pk_test_example',
  PAYMOB_INTEGRATION_ID: '123456',
  PAYMOB_HMAC_SECRET: 'hmac-test-secret',
  PAYMOB_CURRENCY: 'EGP',
  PAYMENT_SIGNING_SECRET: 'payment-signing-secret',
  DOWNLOAD_TOKEN_SECRET: 'download-token-secret',
  RESEND_API_KEY: 're_test_example',
  EMAIL_FROM: 'Keemz Audio Lab <orders@keemzaudiolab.test>',
  CONTACT_TO_EMAIL: 'studio@keemzaudiolab.test',
  PRODUCTS_JSON: JSON.stringify([
    {
      id: 'drill-essentials',
      name: 'Drill Essentials',
      description: 'Twelve construction kits.',
      priceMinor: 25000,
      currency: 'EGP',
      active: true,
      tags: ['WAV', 'MIDI'],
      format: 'WAV + MIDI',
      glyph: '◈'
    },
    {
      id: 'ambient-textures',
      name: 'Ambient Textures',
      description: 'Long-form atmospheres.',
      priceMinor: 12000,
      currency: 'EGP',
      active: true,
      tags: ['WAV'],
      format: 'WAV',
      glyph: '◉'
    },
    {
      id: 'inactive-pack',
      name: 'Not for sale',
      description: 'Should never be public.',
      priceMinor: 5000,
      currency: 'EGP',
      active: false
    },
    {
      id: 'wrong-currency',
      name: 'Wrong currency',
      priceMinor: 5000,
      currency: 'USD',
      active: true
    }
  ]),
  DOWNLOAD_OBJECTS_JSON: JSON.stringify({
    'drill-essentials': 'packs/drill-essentials.zip',
    'ambient-textures': 'packs/ambient-textures.zip',
    'inactive-pack': 'packs/inactive.zip',
    'wrong-currency': 'packs/wrong.zip'
  }),
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'kal-private'
};

function applyEnv(overrides = {}) {
  const saved = {};
  const merged = { ...BASE_ENV, ...overrides };
  for (const key of Object.keys(merged)) {
    saved[key] = process.env[key];
    if (merged[key] === undefined) delete process.env[key];
    else process.env[key] = merged[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function resetStore() {
  __resetMemory();
}

function mockRequest({ method = 'GET', body, headers = {}, query = {}, url = '/' } = {}) {
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (body !== undefined && lowerHeaders['content-type'] === undefined) {
    lowerHeaders['content-type'] = 'application/json';
  }
  return {
    method,
    url,
    query,
    headers: { host: 'keemzaudiolab.test', ...lowerHeaders },
    body,
    socket: { remoteAddress: '203.0.113.9' }
  };
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    payload: undefined,
    kind: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    getHeader(key) {
      return this.headers[key.toLowerCase()];
    },
    json(value) {
      this.payload = value;
      this.kind = 'json';
      return this;
    },
    send(value) {
      this.payload = value;
      this.kind = 'text';
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  return res;
}

async function call(handler, options = {}) {
  const req = mockRequest(options);
  const res = mockResponse();
  await handler(req, res);
  return res;
}

/** Build a Paymob transaction object as Paymob would send it. */
function transaction({ amount = 25000, currency = 'EGP', ref = 'KAL-abc', success = true, id = 9001, pending = false, orderId = 555, extras } = {}) {
  return {
    id,
    pending,
    amount_cents: amount,
    success,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: 123456,
    has_parent_transaction: false,
    error_occured: success === false,
    created_at: '2026-01-01T10:00:00.000000',
    currency,
    owner: 42,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    order: { id: orderId, merchant_order_id: ref },
    payment_key_claims: extras ? { extra: extras } : { extra: {} }
  };
}

function signCallback(obj, secret = process.env.PAYMOB_HMAC_SECRET || BASE_ENV.PAYMOB_HMAC_SECRET) {
  return crypto.createHmac('sha512', secret).update(transactionHmacMessage(obj)).digest('hex');
}

/** Replace global.fetch for the duration of a test. */
function stubFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    }
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

module.exports = {
  BASE_ENV,
  applyEnv,
  resetStore,
  mockRequest,
  mockResponse,
  call,
  transaction,
  signCallback,
  stubFetch,
  jsonResponse
};
