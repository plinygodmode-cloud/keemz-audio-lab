const crypto = require('node:crypto');

const parseJson = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const respond = (res, status, payload) => res.status(status).json(payload);
const emailOk = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return respond(res, 405, { error: 'Method not allowed.' });

  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const required = ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_INTEGRATION_ID', 'PAYMOB_HMAC_SECRET', 'PAYMENT_SIGNING_SECRET', 'PRODUCTS_JSON', 'DOWNLOAD_OBJECTS_JSON'];
  const missing = required.filter(key => !process.env[key]);
  if (!siteUrl || missing.length) return respond(res, 503, { error: 'Checkout is not configured yet. Complete the Paymob and store environment setup first.' });

  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== new URL(siteUrl).host) return respond(res, 403, { error: 'Origin not allowed.' }); }
    catch { return respond(res, 403, { error: 'Origin not allowed.' }); }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : parseJson(req.body);
  const requestedItems = body?.items;
  const customer = body?.customer || {};
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 12) {
    return respond(res, 400, { error: 'Your bag is empty or contains too many different items.' });
  }
  const fullName = String(customer.name || '').trim().replace(/\s+/g, ' ');
  const email = String(customer.email || '').trim().toLowerCase();
  const phone = String(customer.phone || '').trim();
  if (fullName.length < 2 || fullName.length > 120 || !emailOk(email) || !/^\+?[0-9 ()-]{8,25}$/.test(phone)) {
    return respond(res, 400, { error: 'Enter a valid name, email and phone number.' });
  }

  const products = parseJson(process.env.PRODUCTS_JSON) || [];
  const downloads = parseJson(process.env.DOWNLOAD_OBJECTS_JSON) || {};
  if (!Array.isArray(products) || !downloads || typeof downloads !== 'object') return respond(res, 500, { error: 'Store catalogue configuration is invalid.' });
  const currency = String(process.env.PAYMOB_CURRENCY || 'EGP').toUpperCase();
  const productMap = new Map(products.filter(p => p?.active === true).map(p => [p.id, p]));
  const normalized = [];
  const seen = new Set();
  for (const row of requestedItems) {
    const id = String(row?.id || '');
    const quantity = Number(row?.quantity);
    const product = productMap.get(id);
    if (!product || !downloads[id] || !Number.isSafeInteger(product.priceMinor) || product.priceMinor < 1 || product.currency !== currency || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || seen.has(id)) {
      return respond(res, 400, { error: 'One or more items are unavailable. Refresh the store and try again.' });
    }
    seen.add(id);
    normalized.push({ id, quantity, name: product.name, amount: product.priceMinor, description: String(product.description || '').slice(0, 250) });
  }

  const amount = normalized.reduce((sum, item) => sum + item.amount * item.quantity, 0);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) return respond(res, 400, { error: 'The order total is invalid.' });

  const nameParts = fullName.split(' ');
  const firstName = nameParts.shift() || 'Customer';
  const lastName = nameParts.join(' ') || firstName;
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const orderData = {
    v: 1,
    nonce,
    createdAt: Date.now(),
    email,
    amount,
    currency,
    items: normalized.map(({ id, quantity }) => ({ id, quantity }))
  };
  const orderPayload = Buffer.from(JSON.stringify(orderData)).toString('base64url');
  const orderSignature = crypto.createHmac('sha256', process.env.PAYMENT_SIGNING_SECRET).update(orderPayload).digest('hex');
  const specialReference = `KAL:${nonce}:${orderSignature}`;
  const baseUrl = (process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com').replace(/\/$/, '');
  const integrationId = Number(process.env.PAYMOB_INTEGRATION_ID);
  if (!Number.isSafeInteger(integrationId) || integrationId < 1) return respond(res, 503, { error: 'Paymob integration ID is invalid.' });

  const intentionBody = {
    amount,
    currency,
    payment_methods: [integrationId],
    items: normalized.map(item => ({ name: item.name, amount: item.amount, description: item.description || item.name, quantity: item.quantity })),
    billing_data: {
      first_name: firstName,
      last_name: lastName,
      email,
      phone_number: phone,
      apartment: 'NA',
      floor: 'NA',
      street: 'NA',
      building: 'NA',
      city: process.env.PAYMOB_CITY || 'Cairo',
      state: process.env.PAYMOB_STATE || 'Cairo',
      country: 'EG',
      postal_code: process.env.PAYMOB_POSTAL_CODE || '00000'
    },
    extras: { order_data: orderPayload },
    special_reference: specialReference,
    expiration: 1800,
    notification_url: `${siteUrl}/api/paymob-webhook`,
    redirection_url: `${siteUrl}/payment-return.html`
  };

  try {
    const response = await fetch(`${baseUrl}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(intentionBody)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.client_secret) {
      console.error('Paymob intention error:', response.status, data);
      return respond(res, 502, { error: 'Paymob could not create this checkout. Check your integration ID, currency and test/live keys.' });
    }
    const checkoutUrl = new URL('/unifiedcheckout/', baseUrl);
    checkoutUrl.searchParams.set('publicKey', process.env.PAYMOB_PUBLIC_KEY);
    checkoutUrl.searchParams.set('clientSecret', data.client_secret);
    return respond(res, 200, { checkoutUrl: checkoutUrl.toString() });
  } catch (error) {
    console.error('Checkout request failed:', error);
    return respond(res, 502, { error: 'Payment service could not be reached. Please try again.' });
  }
};
