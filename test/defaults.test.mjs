import { test } from 'node:test';
import assert from 'node:assert';

test('seedBundledDefaultsIfEmpty fills empty storage from bundled JSON', async () => {
  const storage = {};

  globalThis.chrome = {
    runtime: {
      getURL: function (p) {
        return 'chrome-extension://fake/' + p;
      }
    },
    storage: {
      local: {
        get: function (keys, cb) {
          var out = {};
          keys.forEach(function (k) {
            out[k] = storage[k];
          });
          cb(out);
        },
        set: function (obj, cb) {
          Object.assign(storage, obj);
          if (cb) cb();
        }
      }
    }
  };

  globalThis.fetch = async function (url) {
    assert.ok(String(url).includes('defaults.json'));
    return {
      ok: true,
      json: async function () {
        return {
          lt_form_url: 'https://docs.google.com/forms/d/e/test/viewform',
          lt_model: 'llama-3.3-70b-versatile',
          lt_auto_submit: false
        };
      }
    };
  };

  const { seedBundledDefaultsIfEmpty } = await import('../utils/defaults.js');
  var patch = await seedBundledDefaultsIfEmpty();

  assert.ok(patch);
  assert.strictEqual(storage.lt_form_url, 'https://docs.google.com/forms/d/e/test/viewform');
  assert.strictEqual(storage.lt_model, 'llama-3.3-70b-versatile');
  assert.strictEqual(storage.lt_auto_submit, false);

  delete globalThis.chrome;
  delete globalThis.fetch;
});

test('seedBundledDefaultsIfEmpty does not overwrite existing lt_form_url', async () => {
  const storage = {
    lt_form_url: 'https://docs.google.com/forms/d/e/existing/viewform',
    lt_model: 'old-model',
    lt_auto_submit: true
  };

  globalThis.chrome = {
    runtime: { getURL: function (p) { return 'chrome-extension://fake/' + p; } },
    storage: {
      local: {
        get: function (keys, cb) {
          var out = {};
          keys.forEach(function (k) { out[k] = storage[k]; });
          cb(out);
        },
        set: function (obj, cb) {
          Object.assign(storage, obj);
          if (cb) cb();
        }
      }
    }
  };

  globalThis.fetch = async function () {
    return {
      ok: true,
      json: async function () {
        return {
          lt_form_url: 'https://docs.google.com/forms/d/e/new/viewform',
          lt_model: 'llama-3.3-70b-versatile',
          lt_auto_submit: false
        };
      }
    };
  };

  const { seedBundledDefaultsIfEmpty } = await import('../utils/defaults.js');
  var patch = await seedBundledDefaultsIfEmpty();

  assert.strictEqual(patch, null);
  assert.strictEqual(storage.lt_form_url, 'https://docs.google.com/forms/d/e/existing/viewform');

  delete globalThis.chrome;
  delete globalThis.fetch;
});
