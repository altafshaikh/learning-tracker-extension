import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllowlistDomain, buildClassificationCatalog, DOMAINS } from '../utils/groq.js';

test('resolveAllowlistDomain exact and case-insensitive', function () {
  var list = ['Technology and Development Practices'];
  assert.equal(resolveAllowlistDomain('Technology and Development Practices', list), list[0]);
  assert.equal(resolveAllowlistDomain('technology and development practices', list), list[0]);
});

test('resolveAllowlistDomain typo Practice vs Practices', function () {
  var list = ['Technology and Development Practices'];
  assert.equal(
    resolveAllowlistDomain('Technology and Development Practice', list),
    list[0]
  );
});

test('resolveAllowlistDomain extra spaces', function () {
  var list = ['Technology and Development Practices'];
  assert.equal(
    resolveAllowlistDomain('  Technology  and   Development Practices  ', list),
    list[0]
  );
});

test('resolveAllowlistDomain full line embedded in longer string', function () {
  var list = ['Technology and Development Practices'];
  assert.equal(
    resolveAllowlistDomain(
      'Technology and Development Practices (confirmed)',
      list
    ),
    list[0]
  );
});

test('resolveAllowlistDomain rejects null and unknown', function () {
  var list = DOMAINS.slice();
  assert.equal(resolveAllowlistDomain('null', list), null);
  assert.equal(resolveAllowlistDomain('', list), null);
  assert.equal(resolveAllowlistDomain('Cooking', list), null);
});

test('buildClassificationCatalog includes all DOMAINS plus custom allowlist-only labels', function () {
  var allow = ['Business/Leadership', 'Data & Visualization'];
  var cat = buildClassificationCatalog(allow);
  assert.ok(cat.length >= DOMAINS.length + 1);
  assert.ok(cat.includes('Technology and Development Practices'));
  assert.ok(cat.includes('Data & Visualization'));
});
