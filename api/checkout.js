'use strict';

const config = require('../lib/config');
const { json, fail, readJsonBody, requireJsonContentType, methodNotAllowed } = require('../lib/http');
const { checkOrigin, clientIp, issueReturnToken } = require('../lib/security');
const { isEmail, isPhone, normalizePhone, singleLine } = require('../lib/util');
const { loadCatalog, resolveLineItems } = require('../lib/catalog');
const { createOrder, STATUS } = require('../lib/orders');
const { saveOrder, updateOrder, rateLimit } = require('../lib/store');
const { createIntention, buildCheckoutUrl, PaymobError } = require('../lib/paymob');

/*
  POST /api/checkout
  Body: { items: [{ id, quantity }], customer: { name, email, phone } }

  The browser never sends prices. The order is persisted first, then a
  Paymob intention is created with our signed reference, so the callback can
  be reconciled against a record the customer cannot influence.
*/
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!requireJsonContentType(req)) {
    return json(res, 415, { error: 'Checkout requests must be sent as JSON.' });
  }

  const origin = checkOrigin(req, config.allowedOrigins());
  if (!origin.ok) {
    console.warn('[keemz] checkout origin rejected:', origin.reason, req.headers.origin);
    return json(res, 403, { error: 'This request came from an unrecognised origin.' });
  }

  const ip = clientIp(req);
  const limit = await rateLimit(`checkout:${ip}`, { limit: 8, windowSeconds: 600 });
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit.remaining)));
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return json(res, 429, { error: 'Too many checkout attempts. Please wait a few minutes and try again.' });
  }

  const readiness = config.storeReadiness();
  if (!readiness.ready) {
    console.error('[keemz] checkout blocked — missing configuration:', readiness.missing.join(', '));
    return json(res, 503, {
      error:
        'The store is not accepting payments yet. Checkout is disabled until payment, delivery and email settings are complete.'
    });
  }

  const body = readJsonBody(req);
  if (!body.ok) return json(res, body.status, { error: body.error });

  const requestedItems = body.value?.items;
  const rawCustomer = body.value?.customer || {};
  const name = singleLine(rawCustomer.name, 120);
  const email = String(rawCustomer.email || '').trim().toLowerCase();
  const phone = normalizePhone(rawCustomer.phone);

  if (name.length < 2) return json(res, 400, { error: 'Please enter your full name.' });
  if (!isEmail(email)) return json(res, 400, { error: 'Please enter a valid email address for delivery.' });
  if (!isPhone(phone)) return json(res, 400, { error: 'Please enter a valid phone number including country code.' });

  const catalog = loadCatalog();
  const resolved = resolveLineItems(requestedItems, catalog);
  if (!resolved.ok) return json(res, resolved.status, { error: resolved.error });

  const paymob = config.paymobConfig();
  const secrets = config.signingSecrets();
  const site = config.siteUrl();

  const order = createOrder({
    customer: { name, email, phone },
    items: resolved.items,
    amount: resolved.amount,
    currency: resolved.currency,
    ip,
    userAgent: req.headers['user-agent']
  });

  try {
    await saveOrder(order);
  } catch (error) {
    return fail(res, 503, 'The order could not be saved. Please try again in a moment.', error);
  }

  const nameParts = name.split(' ');
  const firstName = nameParts.shift() || 'Customer';
  const lastName = nameParts.join(' ') || firstName;
  const returnToken = issueReturnToken(order.ref, secrets.payment);

  const redirectionUrl = new URL(`${site}/payment-return`);
  redirectionUrl.searchParams.set('ref', order.ref);
  redirectionUrl.searchParams.set('t', returnToken);

  try {
    const intention = await createIntention({
      config: paymob,
      amount: order.amount,
      currency: order.currency,
      items: resolved.items,
      customer: { firstName, lastName, email, phone },
      orderRef: order.ref,
      notificationUrl: `${site}/api/paymob-webhook`,
      redirectionUrl: redirectionUrl.toString(),
      // Kept for backwards compatibility with older deployed intentions.
      extras: { kal_ref: order.ref, kal_v: 2 }
    });

    await updateOrder(order.ref, {
      paymob: {
        intentionId: intention.intentionId,
        orderId: intention.paymobOrderId,
        transactionId: null
      }
    });

    const checkoutUrl = buildCheckoutUrl({
      checkoutBase: paymob.checkoutBase,
      publicKey: paymob.publicKey,
      clientSecret: intention.clientSecret
    });

    return json(res, 200, { checkoutUrl, reference: order.ref });
  } catch (error) {
    await updateOrder(order.ref, { status: STATUS.FAILED }).catch(() => {});
    if (error instanceof PaymobError) {
      console.error('[keemz] Paymob intention failed:', {
        message: error.message,
        status: error.meta?.status,
        detail: error.meta?.detail,
        hint: error.meta?.hint
      });
      const isConfigProblem = error.meta?.status === 401 || error.meta?.status === 404;
      return json(res, 502, {
        error: isConfigProblem
          ? 'The payment integration is not configured correctly, so checkout cannot start. Please contact the studio.'
          : 'The payment provider could not create this checkout. No money has been taken — please try again.'
      });
    }
    return fail(res, 502, 'The payment provider could not be reached. No money has been taken — please try again.', error);
  }
};
