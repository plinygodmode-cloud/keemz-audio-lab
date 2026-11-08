'use strict';

/*
  Order domain model. Orders are created *before* the customer is sent to
  Paymob, so the webhook never has to trust anything the browser sent: it
  looks the order up by its signed reference and compares the amount,
  currency and item list against this record.
*/

const { makeOrderRef, issueDownloadToken } = require('./security');

const STATUS = {
  CREATED: 'created',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  VOIDED: 'voided',
  DELIVERY_FAILED: 'delivery_failed'
};

const TERMINAL_BAD = new Set([STATUS.REFUNDED, STATUS.VOIDED]);

function downloadTtlMs() {
  const hours = Number(process.env.DOWNLOAD_LINK_TTL_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 30) : 24 * 7;
  return safe * 60 * 60 * 1000;
}

function createOrder({ customer, items, amount, currency, ip, userAgent }) {
  const now = Date.now();
  return {
    v: 2,
    ref: makeOrderRef(),
    status: STATUS.CREATED,
    createdAt: now,
    updatedAt: now,
    amount,
    currency,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    items: items.map(item => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      quantity: item.quantity
    })),
    paymob: { intentionId: null, orderId: null, transactionId: null },
    delivery: { emailId: null, deliveredAt: null, attempts: 0 },
    meta: {
      ip: String(ip || '').slice(0, 64),
      userAgent: String(userAgent || '').slice(0, 240)
    }
  };
}

/**
 * Build one signed download URL per purchased pack.
 * The token proves (via HMAC) which order and product it unlocks and when it
 * expires; the download endpoint re-checks the stored order before signing an
 * R2 URL, so revoking an order also revokes its links.
 */
function buildDownloadLinks(order, { siteUrl, downloadSecret, catalogue }) {
  const expiresAt = Date.now() + downloadTtlMs();
  const links = order.items.map(item => {
    const product = catalogue.products.find(entry => entry.id === item.id);
    const token = issueDownloadToken(
      {
        ref: order.ref,
        productId: item.id,
        transactionId: order.paymob?.transactionId || '',
        email: order.email
      },
      downloadSecret,
      downloadTtlMs()
    );
    return {
      id: item.id,
      name: product?.name || item.name,
      format: product?.format || 'DIGITAL',
      quantity: item.quantity,
      licence: product?.licence || 'Standard licence',
      url: `${siteUrl}/api/download?token=${encodeURIComponent(token)}`,
      expiresAt
    };
  });
  return { links, expiresAt };
}

/** True when a stored order matches what Paymob says was paid. */
function matchesPayment(order, transaction) {
  if (!order || !transaction) return false;
  const paid = Number(transaction.amount_cents);
  if (!Number.isSafeInteger(paid) || paid !== Number(order.amount)) return false;
  if (String(transaction.currency || '').toUpperCase() !== String(order.currency).toUpperCase()) return false;
  return Array.isArray(order.items) && order.items.length > 0;
}

module.exports = {
  STATUS,
  TERMINAL_BAD,
  createOrder,
  buildDownloadLinks,
  matchesPayment,
  downloadTtlMs
};
