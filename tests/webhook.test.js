'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv, resetStore, call, transaction, signCallback, stubFetch, jsonResponse } = require('./helpers');
const handler = require('../api/paymob-webhook');
const { saveOrder, getOrder } = require('../lib/store');

let restore = () => {};
test.beforeEach(() => {
  restore = applyEnv();
  resetStore();
});
test.afterEach(() => restore());

async function seedOrder(overrides = {}) {
  const order = {
    v: 2,
    ref: 'KAL-0123456789abcdef01234567',
    status: 'created',
    createdAt: Date.now(),
    amount: 25000,
    currency: 'EGP',
    email: 'buyer@example.com',
    name: 'Buyer Name',
    phone: '+201001234567',
    items: [{ id: 'drill-essentials', name: 'Drill Essentials', amount: 25000, quantity: 1 }],
    paymob: { intentionId: 'pi_1', orderId: 555, transactionId: null },
    delivery: { emailId: null, deliveredAt: null, attempts: 0 },
    ...overrides
  };
  await saveOrder(order);
  return order;
}

function callbackOptions(obj, { hmac } = {}) {
  return {
    method: 'POST',
    body: { type: 'TRANSACTION', obj },
    query: { hmac: hmac === undefined ? signCallback(obj) : hmac },
    url: `/api/paymob-webhook?hmac=${hmac === undefined ? signCallback(obj) : hmac}`
  };
}

test('rejects a forged signature and never calls Resend', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_1' }));
  try {
    const order = await seedOrder();
    const obj = transaction({ ref: order.ref, amount: 25000 });
    const res = await call(handler, callbackOptions(obj, { hmac: 'deadbeef' }));
    assert.equal(res.statusCode, 401);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('rejects a payload tampered after signing (amount swapped)', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_1' }));
  try {
    const order = await seedOrder();
    const obj = transaction({ ref: order.ref, amount: 25000 });
    const hmac = signCallback(obj);
    obj.amount_cents = 100;
    const res = await call(handler, callbackOptions(obj, { hmac }));
    assert.equal(res.statusCode, 401);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('a verified successful payment delivers exactly one email', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const order = await seedOrder();
    const obj = transaction({ ref: order.ref, amount: 25000, id: 777001 });
    const res = await call(handler, callbackOptions(obj));
    assert.equal(res.statusCode, 200);
    assert.equal(stub.calls.length, 1);

    const request = JSON.parse(stub.calls[0].options.body);
    assert.deepEqual(request.to, ['buyer@example.com']);
    assert.match(request.html, /api\/download\?token=/);
    assert.equal(stub.calls[0].options.headers['Idempotency-Key'], 'kal-delivery-777001');

    const stored = await getOrder(order.ref);
    assert.equal(stored.status, 'paid');
    assert.equal(stored.paymob.transactionId, '777001');
    assert.ok(stored.delivery.deliveredAt);
  } finally {
    stub.restore();
  }
});

test('a duplicate callback for the same transaction does not send twice', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const order = await seedOrder();
    const obj = transaction({ ref: order.ref, amount: 25000, id: 777002 });
    const first = await call(handler, callbackOptions(obj));
    const second = await call(handler, callbackOptions(obj));
    const third = await call(handler, callbackOptions(obj));
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(third.statusCode, 200);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('a different successful transaction for the same order still delivers (customer paid twice)', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const order = await seedOrder();
    await call(handler, callbackOptions(transaction({ ref: order.ref, amount: 25000, id: 880001 })));
    await call(handler, callbackOptions(transaction({ ref: order.ref, amount: 25000, id: 880002 })));
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('failed and pending payments never deliver', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const failedOrder = await seedOrder({ ref: 'KAL-aaaaaaaaaaaaaaaaaaaaaaaa' });
    const failed = transaction({ ref: failedOrder.ref, amount: 25000, success: false, id: 5001 });
    const resFailed = await call(handler, callbackOptions(failed));
    assert.equal(resFailed.statusCode, 200);
    assert.match(resFailed.payload, /no fulfilment/i);

    const pendingOrder = await seedOrder({ ref: 'KAL-bbbbbbbbbbbbbbbbbbbbbbbb' });
    const pending = transaction({ ref: pendingOrder.ref, amount: 25000, pending: true, id: 5002 });
    assert.equal((await call(handler, callbackOptions(pending))).statusCode, 200);

    const refundedOrder = await seedOrder({ ref: 'KAL-cccccccccccccccccccccccc', status: 'paid' });
    const refunded = transaction({ ref: refundedOrder.ref, amount: 25000, id: 5003 });
    refunded.is_refunded = true;
    assert.equal((await call(handler, callbackOptions(refunded))).statusCode, 200);

    const voidedOrder = await seedOrder({ ref: 'KAL-dddddddddddddddddddddddd' });
    const voided = transaction({ ref: voidedOrder.ref, amount: 25000, id: 5004 });
    voided.is_voided = true;
    assert.equal((await call(handler, callbackOptions(voided))).statusCode, 200);

    assert.equal(stub.calls.length, 0);
    assert.equal((await getOrder(failedOrder.ref)).status, 'failed');
    assert.equal((await getOrder(pendingOrder.ref)).status, 'created');
    assert.equal((await getOrder(refundedOrder.ref)).status, 'refunded');
    assert.equal((await getOrder(voidedOrder.ref)).status, 'voided');
  } finally {
    stub.restore();
  }
});

test('an amount mismatch is never fulfilled', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const order = await seedOrder();
    // Underpaying signature is valid (real Paymob HMAC) but the amount differs.
    const obj = transaction({ ref: order.ref, amount: 100, id: 6001 });
    const res = await call(handler, callbackOptions(obj));
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /did not match/i);
    assert.equal(stub.calls.length, 0);
    assert.equal((await getOrder(order.ref)).status, 'created');
  } finally {
    stub.restore();
  }
});

test('an unknown order reference is not fulfilled', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'email_ok' }));
  try {
    const obj = transaction({ ref: 'KAL-ffffffffffffffffffffffff', amount: 25000, id: 7001 });
    const res = await call(handler, callbackOptions(obj));
    assert.equal(res.statusCode, 404);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('a delivery failure returns 500 and a retry succeeds exactly once', async () => {
  let attempt = 0;
  const stub = stubFetch(() => {
    attempt += 1;
    return attempt === 1 ? jsonResponse({ message: 'provider down' }, 503) : jsonResponse({ id: 'email_retry' });
  });
  try {
    const order = await seedOrder();
    const obj = transaction({ ref: order.ref, amount: 25000, id: 9001 });

    const failed = await call(handler, callbackOptions(obj));
    assert.equal(failed.statusCode, 500);
    assert.equal((await getOrder(order.ref)).status, 'delivery_failed');

    const retried = await call(handler, callbackOptions(obj));
    assert.equal(retried.statusCode, 200);
    assert.equal((await getOrder(order.ref)).status, 'paid');
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('the webhook refuses to run without configuration', async () => {
  restore();
  restore = applyEnv({ PAYMOB_HMAC_SECRET: '' });
  const res = await call(handler, { method: 'POST', body: { type: 'TRANSACTION', obj: transaction() } });
  assert.equal(res.statusCode, 503);
});

test('a signed legacy extras payload is still fulfilled', async () => {
  const crypto = require('node:crypto');
  const stub = stubFetch(() => jsonResponse({ id: 'email_legacy' }));
  try {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        nonce: 'legacy1',
        createdAt: Date.now(),
        email: 'legacy@example.com',
        amount: 12000,
        currency: 'EGP',
        items: [{ id: 'ambient-textures', quantity: 1 }]
      })
    ).toString('base64url');
    const signature = crypto.createHmac('sha256', 'payment-signing-secret').update(payload).digest('hex');
    const obj = transaction({
      ref: 'KAL:legacy1:' + signature,
      amount: 12000,
      id: 424242,
      extras: { order_data: payload }
    });
    const res = await call(handler, callbackOptions(obj));
    assert.equal(res.statusCode, 200);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});
