// Bundled config/defaults.json — single source for form URL / model / prefs (not secrets).

var KEYS = ['lt_form_url', 'lt_model', 'lt_auto_submit', 'lt_form_email', 'lt_learning_target_hours', 'lt_learned_baseline_ms'];

export async function fetchBundledDefaults() {
  var url = chrome.runtime.getURL('config/defaults.json');
  var r = await fetch(url);
  if (!r.ok) throw new Error('defaults.json: ' + r.status);
  return await r.json();
}

/** Fill storage only where a key is missing or empty (first run / dev convenience). */
export async function seedBundledDefaultsIfEmpty() {
  try {
    var d = await fetchBundledDefaults();
  } catch (e) {
    console.warn('[LT] seed defaults:', e.message);
    return null;
  }
  return new Promise(function(resolve) {
    chrome.storage.local.get(KEYS, function(current) {
      var patch = {};
      KEYS.forEach(function(k) {
        var fromFile = d[k];
        if (fromFile === undefined || fromFile === '') return;
        var cur = current[k];
        if (cur == null || cur === '') patch[k] = fromFile;
      });
      if (Object.keys(patch).length) {
        chrome.storage.local.set(patch, function() {
          resolve(patch);
        });
      } else resolve(null);
    });
  });
}
