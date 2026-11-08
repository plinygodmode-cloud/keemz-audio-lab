'use strict';

const path = require('node:path');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const config = require('../lib/config');
const { escapeHtml } = require('../lib/util');
const { readDownloadToken } = require('../lib/security');
const { getOrder, storeInfo } = require('../lib/store');
const { loadCatalog } = require('../lib/catalog');
const { STATUS } = require('../lib/orders');

/*
  GET /api/download?token=<signed token>

  The token identifies the order, the product and the expiry — but it is not
  the only control. The order is re-read from the store and must still be
  paid, and the product must still belong to that order. Only then is a
  short-lived (default 120s) signed R2 URL issued. The bucket itself stays
  private: no object key or credential ever reaches the browser.
*/

function page(res, status, title, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} — Keemz Audio Lab</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100svh;display:grid;place-items:center;background:#04060c;color:#eaf2fa;
       font:300 15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px}
  main{max-width:560px;text-align:center;border:1px solid rgba(0,207,255,.24);padding:clamp(28px,6vw,52px);
       background:linear-gradient(160deg,rgba(0,207,255,.06),rgba(0,255,138,.02))}
  .k{font-size:10px;letter-spacing:.32em;color:#00cfff;text-transform:uppercase}
  h1{font-size:clamp(1.5rem,4vw,2.1rem);margin:18px 0 12px;letter-spacing:-.03em}
  p{color:#9fb0c6;font-size:13px;margin:0 0 26px}
  a{color:#00cfff;text-decoration:none;border-bottom:1px solid rgba(0,207,255,.4);padding-bottom:3px;font-size:12px;letter-spacing:.08em}
</style></head>
<body><main><p class="k">Keemz Audio Lab</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
    message
  )}</p><a href="/">Back to the lab</a></main></body></html>`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return page(res, 405, 'Method not allowed', 'Download links can only be opened directly in a browser.');
  }

  const r2 = config.r2Config();
  const secrets = config.signingSecrets();
  if (!secrets.download || !r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
    console.error('[keemz] download endpoint is not configured');
    return page(res, 503, 'Downloads are not available', 'The download service is not configured yet. Please contact the studio.');
  }

  let token = '';
  try {
    token = String(req.query?.token || new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('token') || '');
  } catch {
    token = String(req.query?.token || '');
  }
  if (!token) return page(res, 400, 'Missing download link', 'This link is incomplete. Use the link from your delivery email.');

  const payload = readDownloadToken(token, secrets.download);
  if (!payload) {
    return page(res, 403, 'This link is not valid', 'The link could not be verified. It may have been copied incorrectly or expired. Contact the studio if your purchase is recent.');
  }

  const store = storeInfo();
  if (!store.durable && !config.allowEphemeralStore()) {
    console.error('[keemz] download blocked — no durable order store');
    return page(res, 503, 'Downloads are temporarily unavailable', 'The order service is unavailable. Please try again shortly.');
  }

  let order;
  try {
    order = await getOrder(payload.ref);
  } catch (error) {
    console.error('[keemz] download could not read order store:', error.message);
    return page(res, 503, 'Downloads are temporarily unavailable', 'The order service is unavailable. Please try again shortly.');
  }

  if (!order) {
    return page(res, 404, 'Order not found', 'We could not find the order for this link. It may have expired. Contact the studio and we will re-send it.');
  }
  if (order.status !== STATUS.PAID) {
    return page(res, 403, 'This order is not paid', 'Downloads unlock only after the payment provider confirms the payment.');
  }
  const line = (order.items || []).find(item => item.id === payload.pid);
  if (!line) {
    return page(res, 403, 'This pack is not part of that order', 'The link references a product that is not in this order.');
  }
  if (order.paymob?.transactionId && payload.txn && String(order.paymob.transactionId) !== String(payload.txn)) {
    return page(res, 403, 'This link is no longer valid', 'A newer payment record replaced this link. Use the most recent delivery email.');
  }

  const catalogue = loadCatalog();
  const objectKey =
    catalogue.objectKeys[payload.pid] ||
    (catalogue.products.find(product => product.id === payload.pid) || {}).objectKey ||
    '';
  if (!objectKey) {
    console.error('[keemz] download missing object key for product', payload.pid);
    return page(res, 404, 'File not available', 'The file for this pack is missing. Please contact the studio.');
  }

  try {
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
      forcePathStyle: false
    });
    const filename = path.posix.basename(objectKey) || `${payload.pid}.zip`;
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
        ResponseContentType: 'application/octet-stream'
      }),
      { expiresIn: r2.signedUrlSeconds }
    );
    res.setHeader('Location', url);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(302).end();
  } catch (error) {
    console.error('[keemz] R2 signing failed:', error.message);
    return page(res, 500, 'Download could not be prepared', 'Something went wrong while preparing the file. Please try again, or contact the studio.');
  }
};
