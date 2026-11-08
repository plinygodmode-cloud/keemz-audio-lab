'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv } = require('./helpers');
const { loadCatalog, resolveLineItems, publicProduct } = require('../lib/catalog');

let restore = () => {};
test.beforeEach(() => {
  restore = applyEnv();
});
test.afterEach(() => restore());

test('only active, correctly priced, deliverable products are published', () => {
  const catalog = loadCatalog();
  const ids = catalog.products.map(product => product.id).sort();
  assert.deepEqual(ids, ['ambient-textures', 'drill-essentials']);
  assert.ok(catalog.warnings.some(w => w.includes('inactive-pack')));
  assert.ok(catalog.warnings.some(w => w.includes('wrong-currency')));
});

test('public product projection never leaks the private object key', () => {
  const catalog = loadCatalog();
  const view = publicProduct(catalog.products[0]);
  assert.equal(view.objectKey, undefined);
  assert.ok(!JSON.stringify(view).includes('packs/'));
});

test('products with mismatched currency are treated as unavailable at checkout', () => {
  const catalog = loadCatalog();
  const result = resolveLineItems([{ id: 'wrong-currency', quantity: 1 }], catalog);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('server computes the total from catalogue prices, ignoring client hints', () => {
  const catalog = loadCatalog();
  const result = resolveLineItems(
    [
      { id: 'drill-essentials', quantity: 2, priceMinor: 1, amount: 1 },
      { id: 'ambient-textures', quantity: 1, priceMinor: 1 }
    ],
    catalog
  );
  assert.equal(result.ok, true);
  assert.equal(result.amount, 25000 * 2 + 12000);
  assert.equal(result.currency, 'EGP');
  assert.deepEqual(
    result.items.map(item => [item.id, item.amount, item.quantity]),
    [
      ['drill-essentials', 25000, 2],
      ['ambient-textures', 12000, 1]
    ]
  );
});

test('quantity, duplicate and shape validation', () => {
  const catalog = loadCatalog();
  assert.equal(resolveLineItems([], catalog).status, 400);
  assert.equal(resolveLineItems([{ id: 'drill-essentials', quantity: 0 }], catalog).status, 400);
  assert.equal(resolveLineItems([{ id: 'drill-essentials', quantity: 11 }], catalog).status, 400);
  assert.equal(resolveLineItems([{ id: 'drill-essentials', quantity: 1.5 }], catalog).status, 400);
  assert.equal(
    resolveLineItems(
      [
        { id: 'drill-essentials', quantity: 1 },
        { id: 'drill-essentials', quantity: 1 }
      ],
      catalog
    ).status,
    400
  );
  assert.equal(resolveLineItems([{ id: '../../etc/passwd', quantity: 1 }], catalog).status, 400);
  assert.equal(resolveLineItems('nope', catalog).status, 400);
});

test('a malformed PRODUCTS_JSON does not crash and publishes nothing', () => {
  restore();
  restore = applyEnv({ PRODUCTS_JSON: '{not json', DOWNLOAD_OBJECTS_JSON: '[]' });
  const catalog = loadCatalog();
  assert.deepEqual(catalog.products, []);
  assert.ok(catalog.warnings.length >= 2);
});
