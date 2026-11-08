'use strict';

/*
  Paymob integration (Intention API + Unified Checkout + HMAC verification).

  Reference: https://developers.paymob.com/paymob-docs/developers
    - POST /v1/intention/  with `Authorization: Token <secret key>`
    - Hosted checkout: https://<region>.checkout.paymob.com/?publicKey=&clientSecret=
    - Callbacks: HMAC-SHA512 (hex) over 20 transaction fields, in this order:
        amount_cents, created_at, currency, error_occured,
        has_parent_transaction, id, integration_id, is_3d_secure, is_auth,
        is_capture, is_refunded, is_standalone_payment, is_voided, order.id,
        owner, pending, source_data.pan, source_data.sub_type,
        source_data.type, success
      The digest is sent as the `hmac` query parameter, not as a header.
*/

const { hmacHex, safeEqual } = require('./security');

const asText = value => (value === undefined || value === null ? '' : String(value));

/** Fields used for the POST (processed) transaction callback HMAC. */
function transactionHmacMessage(obj) {
  const source = obj.source_data || {};
  return [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order && obj.order.id,
    obj.owner,
    obj.pending,
    source.pan,
    source.sub_type,
    source.type,
    obj.success
  ]
    .map(asText)
    .join('');
}

/** Fields used for the GET (redirect / response) HMAC — flat `order_id`. */
function redirectHmacMessage(query) {
  const source = {
    pan: query['source_data.pan'],
    sub_type: query['source_data.sub_type'],
    type: query['source_data.type']
  };
  return [
    query.amount_cents,
    query.created_at,
    query.currency,
    query.error_occured,
    query.has_parent_transaction,
    query.id,
    query.integration_id,
    query.is_3d_secure,
    query.is_auth,
    query.is_capture,
    query.is_refunded,
    query.is_standalone_payment,
    query.is_voided,
    query.order_id,
    query.owner,
    query.pending,
    source.pan,
    source.sub_type,
    source.type,
    query.success
  ]
    .map(asText)
    .join('');
}

function verifyHmac(message, received, secret) {
  if (!secret || typeof received !== 'string' || !received.trim()) return false;
  const expected = hmacHex(secret, message, 'sha512');
  return safeEqual(expected, received.trim().toLowerCase());
}

/** Constant-time verification of the callback signature. */
function verifyTransactionHmac(transaction, receivedHmac, secret) {
  if (!transaction || typeof transaction !== 'object') return false;
  // Missing fields would change the signed string; require the essentials.
  if (transaction.id === undefined || transaction.amount_cents === undefined) return false;
  return verifyHmac(transactionHmacMessage(transaction), receivedHmac, secret);
}

/** Optional extra check for the browser redirect (GET query parameters). */
function verifyRedirectHmac(query, receivedHmac, secret) {
  if (!query || typeof query !== 'object') return false;
  return verifyHmac(redirectHmacMessage(query), receivedHmac, secret);
}

/**
 * Create a payment intention. Throws a `PaymobError` with a safe message.
 */
async function createIntention({
  config,
  amount,
  currency,
  items,
  customer,
  orderRef,
  notificationUrl,
  redirectionUrl,
  extras
}) {
  if (!config.secretKey) throw new PaymobError('PAYMOB_SECRET_KEY is not configured.');
  if (!Number.isSafeInteger(config.integrationId) || config.integrationId < 1) {
    throw new PaymobError('PAYMOB_INTEGRATION_ID is not a valid integration id.');
  }

  const body = {
    amount,
    currency,
    payment_methods: [config.integrationId],
    items: items.map(item => ({
      name: item.name.slice(0, 100),
      amount: item.amount,
      description: (item.description || item.name).slice(0, 250),
      quantity: item.quantity
    })),
    billing_data: {
      first_name: customer.firstName,
      last_name: customer.lastName,
      email: customer.email,
      phone_number: customer.phone,
      apartment: 'NA',
      floor: 'NA',
      street: 'NA',
      building: 'NA',
      city: config.city,
      state: config.state,
      country: config.country,
      postal_code: config.postalCode
    },
    extras,
    special_reference: orderRef,
    expiration: 3600,
    notification_url: notificationUrl,
    redirection_url: redirectionUrl
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${config.apiBase}/v1/intention/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new PaymobError(
      error.name === 'AbortError' ? 'Paymob did not respond in time.' : 'Paymob could not be reached.',
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.client_secret) {
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data).slice(0, 500);
    throw new PaymobError('Paymob rejected the checkout request.', {
      status: response.status,
      detail,
      // Safe, actionable hints for the operator (never include secrets).
      hint:
        response.status === 401
          ? 'Check PAYMOB_SECRET_KEY and that it matches test/live mode.'
          : response.status === 404
            ? 'Check PAYMOB_INTEGRATION_ID belongs to this Paymob account.'
            : 'Check the integration currency and amount.'
    });
  }

  return {
    intentionId: data.id || '',
    paymobOrderId: Number(data.intention_order_id || 0) || null,
    clientSecret: String(data.client_secret)
  };
}

/** Build the hosted Unified Checkout URL for the configured region. */
function buildCheckoutUrl({ checkoutBase, publicKey, clientSecret }) {
  if (!publicKey) throw new PaymobError('PAYMOB_PUBLIC_KEY is not configured.');
  const url = new URL(`${checkoutBase.replace(/\/+$/, '')}/`);
  url.searchParams.set('publicKey', publicKey);
  url.searchParams.set('clientSecret', clientSecret);
  return url.toString();
}

class PaymobError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'PaymobError';
    this.meta = meta;
  }
}

module.exports = {
  transactionHmacMessage,
  redirectHmacMessage,
  verifyTransactionHmac,
  verifyRedirectHmac,
  createIntention,
  buildCheckoutUrl,
  PaymobError
};
