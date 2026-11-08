const readJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const products = readJson(process.env.PRODUCTS_JSON, []);
  const downloadObjects = readJson(process.env.DOWNLOAD_OBJECTS_JSON, {});
  const currency = String(process.env.PAYMOB_CURRENCY || 'EGP').toUpperCase();
  if (!Array.isArray(products) || !downloadObjects || typeof downloadObjects !== 'object') {
    return res.status(500).json({ error: 'Store catalogue configuration is invalid.' });
  }

  const visible = products.filter(p => p && p.active === true &&
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.name === 'string' && p.name.length > 0 &&
    Number.isSafeInteger(p.priceMinor) && p.priceMinor > 0 &&
    typeof p.currency === 'string' && p.currency === currency && /^[A-Z]{3}$/.test(p.currency) &&
    typeof downloadObjects[p.id] === 'string' && downloadObjects[p.id].length > 0
  ).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    priceMinor: p.priceMinor,
    currency: p.currency,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 8) : [],
    glyph: p.glyph || '◈',
    format: p.format || 'DIGITAL'
  }));

  return res.status(200).json({ products: visible });
};
