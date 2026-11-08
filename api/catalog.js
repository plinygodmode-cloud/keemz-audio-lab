'use strict';

const { json, fail, methodNotAllowed, setCommonHeaders } = require('../lib/http');
const { loadCatalog, publicProduct } = require('../lib/catalog');

/*
  GET /api/catalog
  Public product feed. Prices here are informational only — checkout always
  recomputes them from the same server-side environment variables.
*/
module.exports = async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const catalog = loadCatalog();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return json(res, 200, {
      products: catalog.products.map(publicProduct),
      currency: catalog.currency,
      count: catalog.products.length
    });
  } catch (error) {
    return fail(res, 500, 'The sample catalogue could not be loaded right now.', error);
  }
};
