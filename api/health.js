'use strict';

const config = require('../lib/config');
const { json, methodNotAllowed } = require('../lib/http');
const { storeInfo } = require('../lib/store');
const { loadCatalog } = require('../lib/catalog');
const { safeEqual } = require('../lib/security');

/*
  GET /api/health
  Public: a tiny readiness summary (no configuration names, no secrets).
  Private: append ?token=<HEALTH_TOKEN> (or x-health-token header) to get the
  list of missing environment variables and catalogue warnings. Useful on a
  fresh deployment; safe to keep because it never returns values.
*/
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const store = storeInfo();
  const readiness = config.storeReadiness();
  const turnstile = config.turnstileConfig();
  const email = config.emailConfig();

  const summary = {
    ok: true,
    service: 'keemz-audio-lab',
    time: new Date().toISOString(),
    store: { backend: store.backend, durable: store.durable },
    checkout: { ready: readiness.ready },
    email: { configured: Boolean(email.resendKey && email.from && email.contactTo) },
    spamProtection: { turnstile: Boolean(turnstile.secret) }
  };

  const expected = String(process.env.HEALTH_TOKEN || '').trim();
  const provided = String(req.query?.token || req.headers['x-health-token'] || '').trim();
  const authorised = expected && provided && safeEqual(expected, provided);

  if (!authorised) return json(res, 200, summary);

  let catalogue = { products: [], warnings: ['catalogue could not be read'] };
  try {
    catalogue = loadCatalog();
  } catch (error) {
    catalogue.warnings.push(error.message);
  }

  return json(res, 200, {
    ...summary,
    missing: readiness.missing,
    catalogue: {
      publishedProducts: catalogue.products.length,
      currency: catalogue.currency,
      warnings: catalogue.warnings
    }
  });
};
