'use strict';

const crypto = require('node:crypto');

const config = require('../lib/config');
const { readJsonBody, text } = require('../lib/http');
const { verifyTransactionHmac } = require('../lib/paymob');
const { getOrder, saveOrder, updateOrder, claim, releaseClaim, storeInfo } = require('../lib/store');
const { loadCatalog } = require('../lib/catalog');
const { STATUS, matchesPayment, buildDownloadLinks } = require('../lib/orders');
const { sendEmail, deliveryEmail } = require('../lib/email');
const { safeEqual, isOrderRef } = require('../lib/security');

/*
  POST /api/paymob-webhook?hmac=<hex>

  Paymob's "transaction processed" callback. Rules enforced here:
    1. The HMAC-SHA512 over the 20 documented fields must verify.
    2. The order must exist in our own store (created by /api/checkout).
    3. Amount, currency and item list must match the stored order.
    4. Only a successful, non-pending, non-refunded transaction delivers.
    5. Each transaction id can be fulfilled exactly once (atomic claim),
       so Paymob retries and replayed callbacks cannot duplicate delivery.
    6. A delivery failure is retried by Paymob (non-2xx) and never
       recorded as delivered.
*/

function hmacFromRequest(req) {
  if (req.query && typeof req.query.hmac === 'string') return req.query.hmac;
  try {
    return new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('hmac') || '';
  } catch {
    return '';
  }
}

/**
 * Backwards compatibility: earlier intentions carried a signed order payload
 * inside `extras`. It is HMAC-signed with PAYMENT_SIGNING_SECRET, so it is
 * still trustworthy, but new orders are always read from the store.
 */
function legacyOrderFromExtras(obj, paymentSecret, reference) {
  const payload = obj?.payment_key_claims?.extra?.order_data;
  if (typeof payload !== 'string' || !payload || !paymentSecret) return null;

  // Two historic formats: `<payload>.<signature>` in extras, or a signature
  // carried in the special reference `KAL:<nonce>:<signature>`.
  let body = payload;
  let signature = '';
  if (payload.includes('.')) {
    [body, signature] = payload.split('.');
  } else if (typeof reference === 'string') {
    const parts = reference.split(':');
    signature = parts.length === 3 ? parts[2] : '';
  }
  if (!body || !signature) return null;

  const expected = crypto.createHmac('sha256', paymentSecret).update(body).digest('hex');
  if (!safeEqual(expected, signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.amount)) return null;
    return {
      v: 1,
      // Keep the modern reference shape so download tokens stay valid.
      ref: `KAL-${crypto.createHash('sha256').update(body).digest('hex').slice(0, 24)}`,
      status: STATUS.CREATED,
      createdAt: Number(data.createdAt) || Date.now(),
      amount: data.amount,
      currency: String(data.currency),
      email: String(data.email || ''),
      items: data.items.map(item => ({ id: String(item.id), quantity: Number(item.quantity) })),
      paymob: {}
    };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return text(res, 405, 'Method not allowed');

  const paymob = config.paymobConfig();
  const secrets = config.signingSecrets();
  const email = config.emailConfig();
  const site = config.siteUrl();
  const store = storeInfo();

  const missing = [];
  if (!paymob.hmacSecret) missing.push('PAYMOB_HMAC_SECRET');
  if (!secrets.payment) missing.push('PAYMENT_SIGNING_SECRET');
  if (!secrets.download) missing.push('DOWNLOAD_TOKEN_SECRET');
  if (!email.resendKey) missing.push('RESEND_API_KEY');
  if (!email.from) missing.push('EMAIL_FROM');
  if (!site) missing.push('SITE_URL');
  if (missing.length) {
    console.error('[keemz] webhook cannot fulfil — missing config:', missing.join(', '));
    // 503 asks Paymob to retry once the deployment is fixed.
    return text(res, 503, 'Fulfilment is not configured');
  }
  if (!store.durable && !config.allowEphemeralStore()) {
    console.error('[keemz] webhook cannot fulfil — no durable order store configured.');
    return text(res, 503, 'Order store is not configured');
  }

  const body = readJsonBody(req, { maxBytes: 256 * 1024 });
  if (!body.ok) return text(res, body.status, body.error);
  const payload = body.value;
  const obj = payload?.obj;
  if (!obj || (payload.type && payload.type !== 'TRANSACTION')) {
    return text(res, 400, 'Unsupported callback payload');
  }

  const receivedHmac = hmacFromRequest(req);
  if (!verifyTransactionHmac(obj, receivedHmac, paymob.hmacSecret)) {
    console.warn('[keemz] webhook rejected: invalid HMAC', { transaction: obj?.id });
    return text(res, 401, 'Invalid callback signature');
  }

  const catalogue = loadCatalog();
  const reference = String(obj?.order?.merchant_order_id || obj?.order?.special_reference || '').trim();
  let order = null;

  if (isOrderRef(reference)) {
    try {
      order = await getOrder(reference);
    } catch (error) {
      console.error('[keemz] webhook could not read order store:', error.message);
      return text(res, 503, 'Order store unavailable; retry later');
    }
  }

  let fromLegacyPayload = false;
  if (!order) {
    const legacy = legacyOrderFromExtras(obj, secrets.payment, reference);
    if (legacy) {
      order = legacy;
      fromLegacyPayload = true;
      console.warn('[keemz] fulfilling a legacy intention via signed extras:', legacy.ref);
    }
  }

  if (!order) {
    console.error('[keemz] webhook: no matching order for reference', JSON.stringify(reference));
    // 404 with a retry hint: an order created milliseconds ago may still be
    // propagating. Paymob retries, which is what we want.
    return text(res, 404, 'Order not found; retry later');
  }

  if (payload.type && String(obj.integration_id || '') !== String(paymob.integrationId)) {
    // Not fatal: merchants can run several integrations (card, wallet).
    console.warn('[keemz] callback integration differs from PAYMOB_INTEGRATION_ID', {
      received: obj.integration_id,
      configured: paymob.integrationId
    });
  }

  const transactionId = String(obj.id || '');
  if (!transactionId) return text(res, 400, 'Missing transaction id');

  // --- Non-delivering outcomes -------------------------------------------
  if (obj.is_refunded === true || obj.is_voided === true) {
    const nextStatus = obj.is_refunded === true ? STATUS.REFUNDED : STATUS.VOIDED;
    if (!fromLegacyPayload) {
      await updateOrder(order.ref, {
        status: nextStatus,
        paymob: { ...(order.paymob || {}), transactionId },
        refundedAt: obj.is_refunded === true ? Date.now() : order.refundedAt,
        voidedAt: obj.is_voided === true ? Date.now() : order.voidedAt
      }).catch(error => console.error('[keemz] failed to record refund:', error.message));
    }
    console.log('[keemz] recorded', nextStatus, 'transaction', transactionId);
    return text(res, 200, 'Verified; no delivery for refunded or voided transaction');
  }

  if (obj.pending === true) {
    // The customer may still complete the payment; do not mark the order
    // failed and do not deliver.
    return text(res, 200, 'Verified pending transaction; waiting for a final result');
  }

  if (obj.success !== true || obj.error_occured === true) {
    if (!fromLegacyPayload && order.status !== STATUS.PAID) {
      await updateOrder(order.ref, {
        status: STATUS.FAILED,
        lastFailureAt: Date.now(),
        paymob: { ...(order.paymob || {}), transactionId }
      }).catch(error => console.error('[keemz] failed to record failed payment:', error.message));
    }
    return text(res, 200, 'Verified non-success transaction; no fulfilment');
  }

  // --- Amount / currency / item reconciliation ---------------------------
  if (!matchesPayment(order, obj)) {
    console.error('[keemz] webhook amount/currency mismatch — not fulfilling', {
      ref: order.ref,
      expected: { amount: order.amount, currency: order.currency },
      received: { amount: obj.amount_cents, currency: obj.currency }
    });
    return text(res, 200, 'Verified callback did not match the stored order; no fulfilment');
  }

  // --- Idempotency: one fulfilment per transaction ------------------------
  let claimed;
  try {
    claimed = await claim(`txn:${transactionId}`);
  } catch (error) {
    console.error('[keemz] could not claim transaction (retry later):', error.message);
    return text(res, 503, 'Could not lock transaction; retry later');
  }
  if (!claimed) {
    console.log('[keemz] duplicate callback ignored for transaction', transactionId);
    return text(res, 200, 'Duplicate callback ignored; already fulfilled');
  }

  const paidAt = Date.now();
  try {
    const { links, expiresAt } = buildDownloadLinks(order, {
      siteUrl: site,
      downloadSecret: secrets.download,
      catalogue
    });
    const message = deliveryEmail({
      order,
      links,
      siteUrl: site,
      expiresOn: new Date(expiresAt).toUTCString()
    });

    const sent = await sendEmail({
      apiKey: email.resendKey,
      from: email.from,
      to: order.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: email.replyTo || email.contactTo || undefined,
      bcc: email.deliveryBcc ? [email.deliveryBcc] : undefined,
      idempotencyKey: `kal-delivery-${transactionId}`
    });

    if (!fromLegacyPayload) {
      await updateOrder(order.ref, {
        status: STATUS.PAID,
        paidAt,
        paymob: { ...(order.paymob || {}), transactionId },
        delivery: {
          emailId: sent.id,
          deliveredAt: Date.now(),
          attempts: Number(order.delivery?.attempts || 0) + 1
        }
      });
    }

    if (fromLegacyPayload) {
      // Persist the reconstructed order so its download links can be
      // re-validated (and revoked) like any other order.
      await saveOrder({
        ...order,
        status: STATUS.PAID,
        paidAt,
        updatedAt: Date.now(),
        paymob: { ...(order.paymob || {}), transactionId },
        delivery: { emailId: sent.id, deliveredAt: Date.now(), attempts: 1 }
      }).catch(error => console.error('[keemz] could not persist legacy order:', error.message));
    }

    console.log('[keemz] delivered order', order.ref, 'transaction', transactionId);
    return text(res, 200, 'Payment verified and digital delivery sent');
  } catch (error) {
    console.error('[keemz] delivery failed; releasing claim so Paymob can retry:', error.message, error.meta || '');
    await releaseClaim(`txn:${transactionId}`).catch(() => {});
    if (!fromLegacyPayload) {
      await updateOrder(order.ref, {
        status: order.status === STATUS.PAID ? STATUS.PAID : STATUS.DELIVERY_FAILED,
        paymob: { ...(order.paymob || {}), transactionId },
        delivery: {
          emailId: order.delivery?.emailId || null,
          deliveredAt: order.delivery?.deliveredAt || null,
          attempts: Number(order.delivery?.attempts || 0) + 1
        }
      }).catch(() => {});
    }
    // Non-2xx so Paymob retries the callback instead of losing the sale.
    return text(res, 500, 'Verified payment but delivery failed; retry later');
  }
};
