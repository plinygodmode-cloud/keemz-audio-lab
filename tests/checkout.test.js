'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv, resetStore, call, stubFetch, jsonResponse } = require('./helpers');
const handler = require('../api/checkout');
const { getOrder } = require('../lib/store');

let restore = () => {};
test.beforeEach(() => {
  restore = applyEnv();
  resetStore();
});
test.afterEach(() => restore());

const validBody = {
  items: [{ id: 'drill-essentials', quantity: 2 }],
  customer: { name: 'Nour Hassan', email: 'nour@example.com', phone: '+201001234567' }
};

test('rejects non-POST requests', async () => {
  const res = await call(handler, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('rejects form-encoded bodies (CSRF surface)', async () => {
  const res = await call(handler, {
    method: 'POST',
    body: validBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://keemzaudiolab.test' }
  });
  assert.equal(res.statusCode, 415);
});

test('rejects a cross-site origin', async () => {
  const res = await call(handler, {
    method: 'POST',
    body: validBody,
    headers: { origin: 'https://evil.example' }
  });
  assert.equal(res.statusCode, 403);
});

test('accepts the configured site origin', async () => {
  const stub = stubFetch(() => jsonResponse({ client_secret: 'cs_test_1', id: 'pi_1', intention_order_id: 987 }));
  try {
    const res = await call(handler, {
      method: 'POST',
      body: validBody,
      headers: { origin: 'https://keemzaudiolab.test' }
    });
    assert.equal(res.statusCode, 200);
  } finally {
    stub.restore();
  }
});

test('returns 503 with a clear message when configuration is incomplete', async () => {
  restore();
  restore = applyEnv({ PAYMOB_SECRET_KEY: '', R2_BUCKET_NAME: '' });
  const res = await call(handler, { method: 'POST', body: validBody });
  assert.equal(res.statusCode, 503);
  assert.match(res.payload.error, /not accepting payments/i);
});

test('validates the customer details', async () => {
  const cases = [
    { ...validBody, customer: { name: 'A', email: 'nour@example.com', phone: '+201001234567' } },
    { ...validBody, customer: { name: 'Nour Hassan', email: 'not-an-email', phone: '+201001234567' } },
    { ...validBody, customer: { name: 'Nour Hassan', email: 'nour@example.com', phone: '12' } }
  ];
  for (const body of cases) {
    const res = await call(handler, { method: 'POST', body });
    assert.equal(res.statusCode, 400, JSON.stringify(body.customer));
  }
});

test('rejects an empty bag and unknown products', async () => {
  assert.equal((await call(handler, { method: 'POST', body: { ...validBody, items: [] } })).statusCode, 400);
  const unknown = await call(handler, {
    method: 'POST',
    body: { ...validBody, items: [{ id: 'made-up-pack', quantity: 1 }] }
  });
  assert.equal(unknown.statusCode, 400);
});

test('creates a hosted checkout on the documented Unified Checkout host', async () => {
  let sentBody;
  const stub = stubFetch((url, options) => {
    assert.equal(url, 'https://accept.paymob.com/v1/intention/');
    assert.equal(options.headers.Authorization, 'Token sk_test_example');
    sentBody = JSON.parse(options.body);
    return jsonResponse({ client_secret: 'cs_test_abc', id: 'pi_test_1', intention_order_id: 4242 });
  });
  try {
    const res = await call(handler, { method: 'POST', body: validBody });
    assert.equal(res.statusCode, 200);

    // Server-side pricing: 2 x 25000
    assert.equal(sentBody.amount, 50000);
    assert.equal(sentBody.currency, 'EGP');
    assert.equal(sentBody.payment_methods[0], 123456);
    assert.equal(sentBody.expiration, 3600);
    assert.match(sentBody.special_reference, /^KAL-[a-f0-9]{24}$/);
    assert.equal(sentBody.notification_url, 'https://keemzaudiolab.test/api/paymob-webhook');
    assert.match(sentBody.redirection_url, /^https:\/\/keemzaudiolab\.test\/payment-return\?ref=KAL-/);

    const url = new URL(res.payload.checkoutUrl);
    assert.equal(url.origin, 'https://eg.checkout.paymob.com');
    assert.equal(url.pathname, '/');
    assert.equal(url.searchParams.get('publicKey'), 'pk_test_example');
    assert.equal(url.searchParams.get('clientSecret'), 'cs_test_abc');

    const order = await getOrder(res.payload.reference);
    assert.equal(order.status, 'created');
    assert.equal(order.amount, 50000);
    assert.equal(order.paymob.intentionId, 'pi_test_1');
    assert.equal(order.paymob.orderId, 4242);
  } finally {
    stub.restore();
  }
});

test('marks the order failed and returns a useful error when Paymob rejects', async () => {
  const stub = stubFetch(() => jsonResponse({ detail: 'Invalid integration' }, 404));
  try {
    const res = await call(handler, { method: 'POST', body: validBody });
    assert.equal(res.statusCode, 502);
    assert.match(res.payload.error, /not configured correctly|payment/i);
  } finally {
    stub.restore();
  }
});

test('rate limits repeated checkout attempts from one IP', async () => {
  const stub = stubFetch(() => jsonResponse({ client_secret: 'cs', id: 'pi', intention_order_id: 1 }));
  try {
    let last;
    for (let i = 0; i < 9; i += 1) {
      last = await call(handler, { method: 'POST', body: validBody });
    }
    assert.equal(last.statusCode, 429);
  } finally {
    stub.restore();
  }
});
