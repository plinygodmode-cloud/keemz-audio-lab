'use strict';

const config = require('../lib/config');
const { json, fail, readJsonBody, requireJsonContentType, methodNotAllowed } = require('../lib/http');
const { readReturnToken, clientIp } = require('../lib/security');
const { getOrder, updateOrder, rateLimit } = require('../lib/store');
const { loadCatalog } = require('../lib/catalog');
const { STATUS, buildDownloadLinks } = require('../lib/orders');
const { sendEmail, deliveryEmail } = require('../lib/email');

/*
  GET  /api/order-status?ref=KAL-...&t=<signed token>
  POST /api/order-status   { ref, token }  -> re-send download links

  The signed return token is only ever created by /api/checkout and appears
  in the customer's own Paymob redirection URL, so it can only reveal that
  customer's order. It never permits downloading another order's files.
*/

function readParams(req, body) {
  const query = req.query || {};
  return {
    ref: String(body?.ref || query.ref || '').trim(),
    token: String(body?.token || query.t || '').trim()
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  if (req.method === 'POST' && !requireJsonContentType(req)) {
    return json(res, 415, { error: 'Requests must be sent as JSON.' });
  }

  const secrets = config.signingSecrets();
  if (!secrets.payment) {
    return json(res, 503, { error: 'Order lookup is not configured.' });
  }

  let body = null;
  if (req.method === 'POST') {
    const parsed = readJsonBody(req);
    if (!parsed.ok) return json(res, parsed.status, { error: parsed.error });
    body = parsed.value;
  }

  const { ref, token } = readParams(req, body);
  const tokenPayload = readReturnToken(token, secrets.payment);
  if (!tokenPayload || tokenPayload.ref !== ref) {
    return json(res, 403, { error: 'This order link could not be verified.' });
  }

  let order;
  try {
    order = await getOrder(ref);
  } catch (error) {
    return fail(res, 503, 'The order service is unavailable. Please try again shortly.', error);
  }
  if (!order) return json(res, 404, { error: 'We could not find that order. It may have expired.' });

  if (req.method === 'GET') {
    const items = (order.items || []).map(item => ({ name: item.name, quantity: item.quantity }));
    return json(res, 200, {
      ref: order.ref,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      createdAt: order.createdAt,
      paidAt: order.paidAt || null,
      delivered: Boolean(order.delivery?.deliveredAt),
      items
    });
  }

  /* ---------------------------- resend --------------------------------- */
  if (order.status !== STATUS.PAID) {
    return json(res, 409, { error: 'Download links are sent only after a confirmed payment.' });
  }

  const ip = clientIp(req);
  const burst = await rateLimit(`resend:ref:${ref}`, { limit: 3, windowSeconds: 3600 });
  const perIp = await rateLimit(`resend:ip:${ip}`, { limit: 10, windowSeconds: 3600 });
  if (!burst.allowed || !perIp.allowed) {
    res.setHeader('Retry-After', String(Math.max(burst.retryAfter, perIp.retryAfter)));
    return json(res, 429, { error: 'These links were re-sent recently. Please check your inbox and spam folder.' });
  }

  const emailConfig = config.emailConfig();
  if (!emailConfig.resendKey || !emailConfig.from) {
    return json(res, 503, { error: 'Email delivery is not configured, so links cannot be re-sent.' });
  }

  try {
    const catalogue = loadCatalog();
    const { links, expiresAt } = buildDownloadLinks(order, {
      siteUrl: config.siteUrl(),
      downloadSecret: secrets.download,
      catalogue
    });
    const message = deliveryEmail({
      order,
      links,
      siteUrl: config.siteUrl(),
      expiresOn: new Date(expiresAt).toUTCString()
    });
    await sendEmail({
      apiKey: emailConfig.resendKey,
      from: emailConfig.from,
      to: order.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: emailConfig.replyTo || emailConfig.contactTo || undefined,
      idempotencyKey: `kal-resend-${order.ref}-${Math.floor(Date.now() / 60000)}`
    });
    await updateOrder(order.ref, { lastResendAt: Date.now() }).catch(() => {});
    return json(res, 200, { ok: true });
  } catch (error) {
    return fail(res, 502, 'The links could not be re-sent. Please contact the studio.', error);
  }
};
