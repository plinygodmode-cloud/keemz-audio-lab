'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv, resetStore, call } = require('./helpers');
const handler = require('../api/download');
const { saveOrder } = require('../lib/store');
const { issueDownloadToken, signPayload } = require('../lib/security');

const SECRET = 'download-token-secret';
const REF = 'KAL-0123456789abcdef01234567';

let restore = () => {};
test.beforeEach(() => {
  restore = applyEnv();
  resetStore();
});
test.afterEach(() => restore());

async function seedPaidOrder(overrides = {}) {
  await saveOrder({
    v: 2,
    ref: REF,
    status: 'paid',
    createdAt: Date.now(),
    amount: 25000,
    currency: 'EGP',
    email: 'buyer@example.com',
    items: [{ id: 'drill-essentials', name: 'Drill Essentials', amount: 25000, quantity: 1 }],
    paymob: { transactionId: '777001' },
    delivery: { deliveredAt: Date.now() },
    ...overrides
  });
}

const tokenFor = (overrides = {}) =>
  issueDownloadToken(
    {
      ref: REF,
      productId: 'drill-essentials',
      transactionId: '777001',
      email: 'buyer@example.com',
      ...overrides
    },
    SECRET
  );

const get = token => call(handler, { method: 'GET', query: { token }, url: `/api/download?token=${token}` });

test('rejects a missing token', async () => {
  const res = await call(handler, { method: 'GET', query: {}, url: '/api/download' });
  assert.equal(res.statusCode, 400);
});

test('rejects a tampered token', async () => {
  const token = tokenFor();
  const [body] = token.split('.');
  const forged = `${body}.${'0'.repeat(64)}`;
  const res = await get(forged);
  assert.equal(res.statusCode, 403);
});

test('rejects a token signed with the wrong secret', async () => {
  const res = await get(tokenFor({}) .replace(/\.[a-f0-9]+$/, '.') + 'a'.repeat(64));
  assert.equal(res.statusCode, 403);
});

test('rejects an expired token', async () => {
  const expired = signPayload(
    { v: 1, ref: REF, pid: 'drill-essentials', txn: '777001', em: 'buyer@example.com', iat: Date.now() - 1000, exp: Date.now() - 10 },
    SECRET
  );
  const res = await get(expired);
  assert.equal(res.statusCode, 403);
});

test('refuses when the order is unpaid', async () => {
  await seedPaidOrder({ status: 'created' });
  const res = await get(tokenFor());
  assert.equal(res.statusCode, 403);
  assert.match(String(res.payload), /not paid/i);
});

test('refuses a product that is not in the order', async () => {
  await seedPaidOrder();
  const res = await get(tokenFor({ productId: 'ambient-textures' }));
  assert.equal(res.statusCode, 403);
});

test('refuses a token from a replaced transaction', async () => {
  await seedPaidOrder({ paymob: { transactionId: '999999' } });
  const res = await get(tokenFor());
  assert.equal(res.statusCode, 403);
});

test('redirects to a short-lived signed R2 URL for a valid paid order', async () => {
  await seedPaidOrder();
  const res = await get(tokenFor());
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['cache-control'], 'no-store');
  const location = new URL(res.headers.location);
  // Cloudflare R2 uses virtual-hosted style: <bucket>.<account>.r2.cloudflarestorage.com
  assert.equal(location.host, 'kal-private.test-account.r2.cloudflarestorage.com');
  assert.equal(location.pathname, '/packs/drill-essentials.zip');
  assert.match(res.headers.location, /X-Amz-Signature=/);
  assert.match(res.headers.location, /response-content-disposition=attachment/);
  assert.ok(Number(location.searchParams.get('X-Amz-Expires')) <= 900);
});

test('never exposes R2 credentials or object keys in the response body', async () => {
  await seedPaidOrder();
  const res = await get(tokenFor());
  const serialised = JSON.stringify(res.payload || '');
  assert.ok(!serialised.includes('test-secret'));
  assert.ok(!serialised.includes('packs/'));
});

test('does not answer non-GET methods', async () => {
  const res = await call(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});
