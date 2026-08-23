'use strict';

// Lightweight unit tests for the ScrapeShield reliability logic.
// These exercise the real functions exported from server.js and require no
// network access or Bright Data CLI. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProduct, isUsablePrice, detectRecovery } = require('../server.js');

const HEALTHY_PRODUCT = {
  product_name: 'Aurora Wireless Headphones',
  price: { value: 142.75, currency: 'USD', symbol: '$' },
  description: 'Over-ear wireless headphones.',
  rating: 4.6,
  primary_image_url: 'https://example.com/a.jpg',
};

test('a fully populated product is healthy', () => {
  const { status, missingFields } = validateProduct(HEALTHY_PRODUCT);
  assert.equal(status, 'healthy');
  assert.deepEqual(missingFields, []);
});

test('a price object is only usable when it carries a value', () => {
  assert.equal(isUsablePrice({ value: 19.99, currency: 'USD', symbol: '$' }), true);
  assert.equal(isUsablePrice({ value: 0 }), true); // a free item is still a valid price
  assert.equal(isUsablePrice({ value: null, currency: 'USD' }), false);
  assert.equal(isUsablePrice({ currency: 'USD' }), false);
  assert.equal(isUsablePrice(null), false);
});

test('{ value: null } price makes only the price field missing', () => {
  const { status, missingFields } = validateProduct({ ...HEALTHY_PRODUCT, price: { value: null } });
  assert.equal(status, 'degraded');
  assert.deepEqual(missingFields, ['price']);
});

test('recovery from a degraded state reports exactly the previously missing fields', () => {
  const history = { lastStatus: 'degraded', lastMissingFields: ['price'], events: [] };
  const event = detectRecovery(history, 'healthy', '2026-01-01T00:00:00.000Z');
  assert.ok(event, 'expected a recovery event');
  assert.equal(event.previousStatus, 'degraded');
  assert.equal(event.currentStatus, 'healthy');
  assert.deepEqual(event.recoveredFields, ['price']);
});

test('recovery from a failed state does NOT claim all five fields were recovered', () => {
  const history = { lastStatus: 'failed', lastMissingFields: [], events: [] };
  const event = detectRecovery(history, 'healthy', '2026-01-01T00:00:00.000Z');
  assert.ok(event, 'expected a recovery event');
  assert.equal(event.previousStatus, 'failed');
  assert.deepEqual(event.recoveredFields, []);
});

test('no recovery is reported when the previous run was already healthy', () => {
  const history = { lastStatus: 'healthy', lastMissingFields: [], events: [] };
  assert.equal(detectRecovery(history, 'healthy', '2026-01-01T00:00:00.000Z'), null);
});

test('no recovery is reported while a run is still degraded', () => {
  const history = { lastStatus: 'degraded', lastMissingFields: ['price'], events: [] };
  assert.equal(detectRecovery(history, 'degraded', '2026-01-01T00:00:00.000Z'), null);
});
