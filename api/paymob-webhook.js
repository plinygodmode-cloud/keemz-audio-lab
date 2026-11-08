const crypto = require('node:crypto');

const parseJson = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
};
const text = value => value === undefined || value === null ? '' : String(value);

function verifyPaymobHmac(obj, received) {
  const fields = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, obj.order?.id, obj.owner, obj.pending,
    obj.source_data?.pan, obj.source_data?.sub_type, obj.source_data?.type, obj.success
  ];
  const message = fields.map(text).join('');
  const expected = crypto.createHmac('sha512', process.env.PAYMOB_HMAC_SECRET).update(message).digest('hex');
  return safeEqualHex(expected, String(received || '').toLowerCase());
}

function verifyOrderReference(reference, payload, signedOrder) {
  if (!reference || !payload || !signedOrder || typeof signedOrder.nonce !== 'string' || !process.env.PAYMENT_SIGNING_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.PAYMENT_SIGNING_SECRET).update(payload).digest('hex');
  return reference === `KAL:${signedOrder.nonce}:${expected}`;
}

async function sendDeliveryEmail({ email, items, transactionId, siteUrl }) {
  const products = parseJson(process.env.PRODUCTS_JSON) || [];
  const objects = parseJson(process.env.DOWNLOAD_OBJECTS_JSON) || {};
  const productMap = new Map(products.filter(p => p?.active === true).map(p => [p.id, p]));
  const links = [];
  for (const item of items) {
    const product = productMap.get(item.id);
    if (!product || !objects[item.id]) throw new Error(`Missing active product or private object for ${item.id}`);
    const tokenData = Buffer.from(JSON.stringify({ id: item.id, email, transactionId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
    const tokenSig = crypto.createHmac('sha256', process.env.DOWNLOAD_TOKEN_SECRET).update(tokenData).digest('hex');
    const url = `${siteUrl}/api/download?token=${encodeURIComponent(`${tokenData}.${tokenSig}`)}`;
    links.push(`<li style="margin:0 0 14px"><a href="${url}" style="color:#00cfff;text-decoration:none">Download ${String(product.name).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</a> <span style="color:#8b94a5">× ${item.quantity}</span></li>`);
  }
  const html = `<!doctype html><html><body style="margin:0;background:#050811;color:#eef4fa;font-family:Arial,sans-serif;padding:32px"><div style="max-width:560px;margin:auto;background:#0b111d;border:1px solid #1c2a3c;padding:30px"><p style="color:#00cfff;letter-spacing:3px;font-size:11px">KEEMZ AUDIO LAB</p><h1 style="font-size:25px">Your sounds are ready.</h1><p style="color:#aab6c7;line-height:1.7">Payment confirmed. Your private download links are below. Each link remains available for 7 days.</p><ul style="padding-left:20px;line-height:1.8">${links.join('')}</ul><p style="color:#78879b;font-size:12px">Order reference: ${String(transactionId)}</p><p style="color:#78879b;font-size:12px">Keep this email for your records. For help, reply to this message.</p></div></body></html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `kal-delivery-${transactionId}`
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: 'Your Keemz Audio Lab downloads are ready', html })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend delivery failed: ${response.status} ${JSON.stringify(data)}`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const required = ['PAYMOB_HMAC_SECRET', 'PAYMENT_SIGNING_SECRET', 'DOWNLOAD_TOKEN_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'PRODUCTS_JSON', 'DOWNLOAD_OBJECTS_JSON', 'SITE_URL'];
  if (required.some(key => !process.env[key])) return res.status(503).send('Fulfilment is not configured');

  const body = req.body && typeof req.body === 'object' ? req.body : parseJson(req.body);
  const obj = body?.obj;
  const receivedHmac = req.query?.hmac || new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('hmac');
  if (body?.type !== 'TRANSACTION' || !obj || !verifyPaymobHmac(obj, receivedHmac)) {
    return res.status(401).send('Invalid callback signature');
  }
  if (obj.success !== true || obj.pending === true || obj.is_voided === true || obj.is_refunded === true) {
    return res.status(200).send('Verified non-success transaction; no fulfilment');
  }

  try {
    const extras = obj.payment_key_claims?.extra || {};
    const orderPayload = String(extras.order_data || '');
    if (!orderPayload) throw new Error('Signed order payload is missing');
    const signedOrder = JSON.parse(Buffer.from(orderPayload, 'base64url').toString('utf8'));
    const reference = obj.order?.merchant_order_id || obj.merchant_order_id || '';
    if (!verifyOrderReference(reference, orderPayload, signedOrder)) throw new Error('Signed order reference is invalid');
    if (Date.now() - Number(signedOrder.createdAt) > 2 * 60 * 60 * 1000 || signedOrder.createdAt > Date.now() + 60_000) throw new Error('Order reference expired');
    if (Number(obj.amount_cents) !== Number(signedOrder.amount) || String(obj.currency) !== String(signedOrder.currency)) throw new Error('Paid amount or currency does not match order');
    if (!Array.isArray(signedOrder.items) || !signedOrder.items.length || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signedOrder.email)) throw new Error('Signed order data is incomplete');
    const siteUrl = process.env.SITE_URL.replace(/\/$/, '');
    await sendDeliveryEmail({ email: signedOrder.email, items: signedOrder.items, transactionId: String(obj.id), siteUrl });
    return res.status(200).send('Payment verified and digital delivery queued');
  } catch (error) {
    console.error('Paymob callback processing error:', error);
    return res.status(500).send('Verified callback could not be fulfilled; retry later');
  }
};
