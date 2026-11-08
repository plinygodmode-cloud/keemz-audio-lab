const crypto = require('node:crypto');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
};
const parseJson = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const required = ['DOWNLOAD_TOKEN_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'DOWNLOAD_OBJECTS_JSON'];
  if (required.some(key => !process.env[key])) return res.status(503).send('Downloads are not configured');

  try {
    const token = String(req.query?.token || new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('token') || '');
    const [payload, receivedSig] = token.split('.');
    if (!payload || !receivedSig) return res.status(400).send('Invalid download link');
    const expectedSig = crypto.createHmac('sha256', process.env.DOWNLOAD_TOKEN_SECRET).update(payload).digest('hex');
    if (!safeEqualHex(expectedSig, receivedSig)) return res.status(403).send('Invalid download signature');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.email || !data.transactionId || !Number.isFinite(data.exp) || data.exp < Date.now()) return res.status(410).send('This download link has expired');
    const objects = parseJson(process.env.DOWNLOAD_OBJECTS_JSON) || {};
    const key = objects[data.id];
    if (typeof key !== 'string' || !key) return res.status(404).send('Download not found');

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
    });
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }), { expiresIn: 90 });
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (error) {
    console.error('Download link error:', error);
    return res.status(500).send('Could not prepare the download. Please contact support.');
  }
};
