'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { transaction, signCallback, applyEnv } = require('./helpers');
const { verifyTransactionHmac, transactionHmacMessage, verifyRedirectHmac } = require('../lib/paymob');
const {
  safeEqual,
  signPayload,
  verifyPayload,
  makeOrderRef,
  isOrderRef,
  issueReturnToken,
  readReturnToken,
  checkOrigin
} = require('../lib/security');
const { isEmail, normalizePhone, escapeHtml, singleLine } = require('../lib/util');

const SECRET = 'hmac-test-secret';

test('HMAC is computed over the 20 documented fields in order', () => {
  const obj = transaction({ amount: 12345, ref: 'KAL-0123456789abcdef01234567', id: 99 });
  const message = transactionHmacMessage(obj);
  assert.equal(
    message,
    [
      12345,
      obj.created_at,
      'EGP',
      'false',
      'false',
      99,
      123456,
      'true',
      'false',
      'false',
      'false',
      'true',
      'false',
      555,
      42,
      'false',
      '2346',
      'MasterCard',
      'card',
      'true'
    ].join('')
  );
  assert.equal(verifyTransactionHmac(obj, signCallback(obj), SECRET), true);
  assert.equal(verifyTransactionHmac(obj, signCallback(obj, 'other'), SECRET), false);
  assert.equal(verifyTransactionHmac(obj, '', SECRET), false);
  assert.equal(verifyTransactionHmac(obj, signCallback(obj), ''), false);
});

test('a single mutated signed field invalidates the HMAC', () => {
  const obj = transaction();
  const hmac = signCallback(obj);
  for (const mutate of [
    o => (o.success = false),
    o => (o.pending = true),
    o => (o.currency = 'USD'),
    o => (o.order.id = 999),
    o => (o.source_data.pan = '1111')
  ]) {
    const copy = JSON.parse(JSON.stringify(obj));
    mutate(copy);
    assert.equal(verifyTransactionHmac(copy, hmac, SECRET), false);
  }
});

test('redirect (GET) HMAC uses the flat order_id field', () => {
  const query = {
    amount_cents: '1000',
    created_at: '2026-01-01T10:00:00',
    currency: 'EGP',
    error_occured: 'false',
    has_parent_transaction: 'false',
    id: '123',
    integration_id: '456',
    is_3d_secure: 'true',
    is_auth: 'false',
    is_capture: 'false',
    is_refunded: 'false',
    is_standalone_payment: 'true',
    is_voided: 'false',
    order_id: '789',
    owner: '1',
    pending: 'false',
    'source_data.pan': '2346',
    'source_data.sub_type': 'MasterCard',
    'source_data.type': 'card',
    success: 'true'
  };
  const message = Object.values(query).join('');
  const hmac = crypto.createHmac('sha512', SECRET).update(message).digest('hex');
  assert.equal(verifyRedirectHmac(query, hmac, SECRET), true);
  assert.equal(verifyRedirectHmac(query, hmac, 'nope'), false);
});

test('constant-time compare handles differing lengths without throwing', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', 'a'), false);
  assert.equal(safeEqual(undefined, undefined), true);
});

test('signed payloads detect tampering', () => {
  const token = signPayload({ ref: 'KAL-1' }, SECRET);
  assert.equal(verifyPayload(token, SECRET).ref, 'KAL-1');
  assert.equal(verifyPayload(token, 'wrong'), null);
  assert.equal(verifyPayload(`${token}x`, SECRET), null);
  const [body] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ref: 'KAL-2' })).toString('base64url');
  assert.equal(verifyPayload(`${forged}.${token.split('.')[1]}`, SECRET), null);
  assert.equal(verifyPayload(body, SECRET), null);
  assert.equal(verifyPayload(null, SECRET), null);
});

test('order references have a fixed, verifiable shape', () => {
  const ref = makeOrderRef();
  assert.match(ref, /^KAL-[a-f0-9]{24}$/);
  assert.equal(isOrderRef(ref), true);
  assert.equal(isOrderRef('KAL:abc:def'), false);
  assert.equal(isOrderRef('../../x'), false);
  assert.equal(isOrderRef(null), false);
});

test('return tokens expire and cannot be repointed', () => {
  const ref = makeOrderRef();
  const token = issueReturnToken(ref, SECRET, 1000);
  assert.equal(readReturnToken(token, SECRET).ref, ref);

  const expired = signPayload({ v: 1, ref, iat: Date.now() - 5000, exp: Date.now() - 1 }, SECRET);
  assert.equal(readReturnToken(expired, SECRET), null);
  assert.equal(readReturnToken(token, 'other-secret'), null);
});

test('origin enforcement', () => {
  const allowed = ['https://keemzaudiolab.test'];
  assert.equal(checkOrigin({ headers: { origin: 'https://keemzaudiolab.test' } }, allowed).ok, true);
  assert.equal(checkOrigin({ headers: { origin: 'https://evil.test' } }, allowed).ok, false);
  assert.equal(checkOrigin({ headers: { origin: 'not a url' } }, allowed).ok, false);
  assert.equal(checkOrigin({ headers: {} }, allowed).ok, true);
  // Same-origin requests are allowed even without an explicit allowlist, so
  // preview deployments work; other hosts still fail.
  const previewReq = { headers: { origin: 'https://preview-abc.vercel.app', host: 'preview-abc.vercel.app' } };
  assert.equal(checkOrigin(previewReq, []).ok, true);
  assert.equal(checkOrigin({ headers: { origin: 'https://evil.test', host: 'preview-abc.vercel.app' } }, []).ok, false);
  assert.equal(checkOrigin({ headers: { origin: 'javascript:alert(1)', host: 'x.test' } }, []).ok, false);
});

test('input helpers reject hostile values', () => {
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('a b@c.com'), false);
  assert.equal(isEmail('a@b.com\r\nBcc: x@y.com'), false);
  assert.equal(normalizePhone('+20 (100) 123-4567'), '+201001234567');
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(singleLine('a\nb\tc', 10), 'a b c');
});

test('missing secrets never verify anything', () => {
  const original = process.env.PAYMOB_HMAC_SECRET;
  delete process.env.PAYMOB_HMAC_SECRET;
  try {
    const obj = transaction();
    assert.equal(verifyTransactionHmac(obj, signCallback(obj), undefined), false);
  } finally {
    if (original !== undefined) process.env.PAYMOB_HMAC_SECRET = original;
  }
  applyEnv();
});
