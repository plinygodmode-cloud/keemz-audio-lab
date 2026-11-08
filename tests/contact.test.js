'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv, resetStore, call, stubFetch, jsonResponse } = require('./helpers');
const handler = require('../api/contact');

let restore = () => {};
test.beforeEach(() => {
  restore = applyEnv();
  resetStore();
});
test.afterEach(() => restore());

const valid = {
  name: 'Mariam Adel',
  email: 'mariam@example.com',
  service: 'Mixing & mastering',
  message: 'I have a four-track EP that needs mixing and mastering before March.'
};

test('sends a validated inquiry and returns a reference', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'mail_1' }));
  try {
    const res = await call(handler, { method: 'POST', body: valid, headers: { origin: 'https://keemzaudiolab.test' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.match(res.payload.reference, /^KAL-INQ-[0-9A-F]{8}$/);

    const sent = JSON.parse(stub.calls[0].options.body);
    assert.deepEqual(sent.to, ['studio@keemzaudiolab.test']);
    assert.equal(sent.reply_to, 'mariam@example.com');
    assert.match(sent.subject, /Mixing & mastering/);
    assert.ok(sent.text.includes(valid.message));
  } finally {
    stub.restore();
  }
});

test('escapes HTML in the notification email', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'mail_2' }));
  try {
    await call(handler, {
      method: 'POST',
      body: { ...valid, name: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script> needs mixing' }
    });
    const sent = JSON.parse(stub.calls[0].options.body);
    assert.ok(!sent.html.includes('<script>'));
    assert.ok(!sent.html.includes('<img src=x'));
    assert.ok(sent.html.includes('&lt;script&gt;'));
  } finally {
    stub.restore();
  }
});

test('validates service, email and message length', async () => {
  const cases = [
    { ...valid, service: 'Free work please' },
    { ...valid, email: 'nope' },
    { ...valid, message: 'short' },
    { ...valid, name: 'X' },
    { ...valid, message: 'x'.repeat(5001) }
  ];
  for (const body of cases) {
    resetStore(); // isolate each attempt from the per-IP quota
    const res = await call(handler, { method: 'POST', body });
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
  }
});

test('silently accepts honeypot submissions without sending mail', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'mail_3' }));
  try {
    const res = await call(handler, { method: 'POST', body: { ...valid, website: 'https://spam.example' } });
    assert.equal(res.statusCode, 200);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('rejects cross-origin posts and non-JSON bodies', async () => {
  const cross = await call(handler, { method: 'POST', body: valid, headers: { origin: 'https://evil.example' } });
  assert.equal(cross.statusCode, 403);
  const form = await call(handler, {
    method: 'POST',
    body: valid,
    headers: { 'content-type': 'text/plain' }
  });
  assert.equal(form.statusCode, 415);
});

test('returns 503 when email is not configured', async () => {
  restore();
  restore = applyEnv({ RESEND_API_KEY: '', CONTACT_TO_EMAIL: '' });
  const res = await call(handler, { method: 'POST', body: valid });
  assert.equal(res.statusCode, 503);
});

test('reports provider failures instead of pretending to succeed', async () => {
  const stub = stubFetch(() => jsonResponse({ message: 'domain not verified' }, 422));
  try {
    const res = await call(handler, { method: 'POST', body: valid });
    assert.equal(res.statusCode, 502);
    assert.match(res.payload.error, /rejected/i);
  } finally {
    stub.restore();
  }
});

test('rate limits repeated submissions', async () => {
  const stub = stubFetch(() => jsonResponse({ id: 'mail_4' }));
  try {
    let last;
    for (let i = 0; i < 5; i += 1) last = await call(handler, { method: 'POST', body: valid });
    assert.equal(last.statusCode, 429);
  } finally {
    stub.restore();
  }
});

test('requires a Turnstile token when a secret is configured', async () => {
  restore();
  restore = applyEnv({ TURNSTILE_SECRET_KEY: 'turnstile-secret' });
  const stub = stubFetch(() => jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
  try {
    const res = await call(handler, { method: 'POST', body: valid });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /spam check/i);
  } finally {
    stub.restore();
  }
});
