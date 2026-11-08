'use strict';

/*
  Server-side catalogue: the single source of truth for prices, availability
  and private download objects. The browser only ever receives public fields.

  PRODUCTS_JSON item fields (all optional except id/name/priceMinor):
    id             string, unique, [a-z0-9-_] only
    name           string
    description    string
    priceMinor     integer, smallest currency unit (piastres for EGP)
    currency       ISO code; must equal PAYMOB_CURRENCY
    active         boolean; only true items are sold
    tags           string[]
    format         string, e.g. "WAV + MIDI"
    glyph          single character used by the store artwork
    image          path to a local asset ("/assets/img/x.jpg")
    previewUrl     optional public audio preview (same origin path only)
    contents       string[]  what the buyer receives
    licence        string    short licence label ("Standard", "Creative")
    bpm / genre / key  optional metadata
    compareAtMinor optional integer shown as a struck-through price
*/

const { parseJsonValue, isCurrencyCode } = require('./util');
const config = require('./config');

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TEXT = 1200;

const cleanString = (value, max = 200) =>
  String(value === undefined || value === null ? '' : value).trim().slice(0, max);

const cleanList = (value, maxItems = 8, maxLength = 40) =>
  Array.isArray(value)
    ? value
        .map(item => cleanString(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

/** Only allow local asset paths for artwork/previews (no remote hotlinks). */
function localPath(value) {
  const raw = cleanString(value, 300);
  if (!raw) return '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  if (!/^\/[A-Za-z0-9._~\-/]+$/.test(raw)) return '';
  return raw;
}

function loadCatalog() {
  const cfg = config.catalogConfig();
  const warnings = [...(cfg.parseErrors || [])];
  let products = cfg.rawProducts;
  let objects = cfg.rawObjects;

  if (!Array.isArray(products)) {
    if (!cfg.productsInvalid) warnings.push('PRODUCTS_JSON is not a JSON array.');
    products = [];
  }
  if (!objects || typeof objects !== 'object' || Array.isArray(objects)) {
    if (!cfg.objectsInvalid) warnings.push('DOWNLOAD_OBJECTS_JSON is not a JSON object.');
    objects = {};
  }

  const seen = new Set();
  const valid = [];

  for (const raw of products) {
    if (!raw || typeof raw !== 'object') {
      warnings.push('Skipped a product that is not an object.');
      continue;
    }
    const id = cleanString(raw.id, 64).toLowerCase();
    if (!ID_PATTERN.test(id)) {
      warnings.push(`Skipped product with invalid id: ${JSON.stringify(raw.id)}`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`Skipped duplicate product id: ${id}`);
      continue;
    }
    seen.add(id);

    if (raw.active !== true) {
      warnings.push(`Product "${id}" is not active and was not published.`);
      continue;
    }
    const priceMinor = Number(raw.priceMinor);
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 1) {
      warnings.push(`Product "${id}" needs a positive integer priceMinor.`);
      continue;
    }
    const currency = cleanString(raw.currency || cfg.currency, 3).toUpperCase();
    if (!isCurrencyCode(currency) || currency !== cfg.currency) {
      warnings.push(`Product "${id}" currency (${currency || 'missing'}) does not match PAYMOB_CURRENCY (${cfg.currency}).`);
      continue;
    }
    const objectKey = objects[id];
    if (typeof objectKey !== 'string' || !objectKey.trim()) {
      warnings.push(`Product "${id}" has no DOWNLOAD_OBJECTS_JSON entry, so it cannot be delivered.`);
      continue;
    }
    const name = cleanString(raw.name, 120);
    if (!name) {
      warnings.push(`Product "${id}" needs a name.`);
      continue;
    }

    const compareAt = Number(raw.compareAtMinor);
    const product = {
      id,
      name,
      description: cleanString(raw.description, MAX_TEXT),
      priceMinor,
      currency,
      tags: cleanList(raw.tags),
      format: cleanString(raw.format, 40) || 'DIGITAL',
      glyph: cleanString(raw.glyph, 2) || '◈',
      image: localPath(raw.image),
      previewUrl: localPath(raw.previewUrl),
      contents: cleanList(raw.contents, 12, 80),
      licence: cleanString(raw.licence, 60) || 'Standard licence',
      bpm: Number.isSafeInteger(Number(raw.bpm)) && Number(raw.bpm) > 0 ? Number(raw.bpm) : null,
      genre: cleanString(raw.genre, 40),
      objectKey: objectKey.trim()
    };
    if (Number.isSafeInteger(compareAt) && compareAt > priceMinor) product.compareAtMinor = compareAt;
    valid.push(product);
  }

  return { products: valid, objectKeys: objects, currency: cfg.currency, warnings };
}

/** The browser-safe projection of a product. Never includes object keys. */
function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor,
    currency: product.currency,
    tags: product.tags,
    format: product.format,
    glyph: product.glyph,
    image: product.image,
    previewUrl: product.previewUrl,
    contents: product.contents,
    licence: product.licence,
    bpm: product.bpm,
    genre: product.genre,
    ...(product.compareAtMinor ? { compareAtMinor: product.compareAtMinor } : {})
  };
}

/**
 * Validate requested cart lines against the catalogue.
 * Returns { ok:true, items, amount } or { ok:false, status, error }.
 */
function resolveLineItems(requested, catalog = loadCatalog()) {
  const cfg = config.catalogConfig();
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, status: 400, error: 'Your bag is empty.' };
  }
  if (requested.length > cfg.maxDistinctItems) {
    return { ok: false, status: 400, error: `A single order can contain at most ${cfg.maxDistinctItems} different packs.` };
  }

  const byId = new Map(catalog.products.map(product => [product.id, product]));
  const seen = new Set();
  const items = [];
  let amount = 0;

  for (const line of requested) {
    if (!line || typeof line !== 'object') return { ok: false, status: 400, error: 'One or more items are invalid.' };
    const id = cleanString(line.id, 64).toLowerCase();
    const quantity = Number(line.quantity);
    if (!ID_PATTERN.test(id) || seen.has(id)) {
      return { ok: false, status: 400, error: 'One or more items are unavailable. Refresh the store and try again.' };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > cfg.maxQuantityPerItem) {
      return { ok: false, status: 400, error: `Each pack must have a quantity between 1 and ${cfg.maxQuantityPerItem}.` };
    }
    const product = byId.get(id);
    if (!product) {
      return { ok: false, status: 400, error: 'One or more items are no longer available. Refresh the store and try again.' };
    }
    seen.add(id);
    const lineTotal = product.priceMinor * quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      return { ok: false, status: 400, error: 'The order total is invalid.' };
    }
    amount += lineTotal;
    items.push({
      id: product.id,
      name: product.name,
      amount: product.priceMinor,
      quantity,
      description: cleanString(product.description || product.name, 250)
    });
  }

  if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, status: 400, error: 'The order total is invalid.' };
  if (amount > cfg.maxOrderTotalMinor) {
    return { ok: false, status: 400, error: 'This order total is larger than the online store allows. Please get in touch directly.' };
  }

  return { ok: true, items, amount, currency: catalog.currency };
}

/** Used by the download endpoint to make sure a product is still sellable. */
function findProduct(id, catalog = loadCatalog()) {
  return catalog.products.find(product => product.id === String(id || '').toLowerCase()) || null;
}

/** Convenience for tests: parse values exactly like the environment does. */
function parseEnvCatalog(productsJson, objectsJson) {
  return {
    products: parseJsonValue(productsJson, []),
    objects: parseJsonValue(objectsJson, {})
  };
}

module.exports = {
  loadCatalog,
  publicProduct,
  resolveLineItems,
  findProduct,
  parseEnvCatalog
};
