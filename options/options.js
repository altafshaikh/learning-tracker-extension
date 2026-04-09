// options/options.js

var BACKUP_SCHEMA = 'learning-tracker-extension';
var BACKUP_VERSION = 1;
var EXPORT_KEYS = [
  'lt_sessions',
  'lt_streak',
  'lt_insights',
  'lt_groq_key',
  'lt_model',
  'lt_form_url',
  'lt_auto_submit',
  'lt_form_email',
  'lt_learned_baseline_ms',
  'lt_learning_target_hours',
  'lt_pending_form',
  'lt_youtube_learning_only',
  'lt_domain_gate_enabled',
  'lt_domain_allowlist'
];

var STANDARD_LEARNING_DOMAINS = [
  'Business/Leadership',
  'Technology and Development Practices',
  'Communication Skills',
  'Mandatory Compliance Training',
  'Interpersonal Skills'
];

function showStatus(id, text, type) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.className = 'status ' + type;
  if (type !== 'err') setTimeout(function() { el.className = 'status'; }, 3000);
}

function loadSettingsFromStorage() {
  chrome.storage.local.get([
    'lt_groq_key',
    'lt_model',
    'lt_form_url',
    'lt_auto_submit',
    'lt_learned_baseline_ms',
    'lt_learning_target_hours',
    'lt_youtube_learning_only',
    'lt_domain_gate_enabled',
    'lt_domain_allowlist'
  ], function(r) {
    if (r.lt_groq_key) document.getElementById('groq-key').value = r.lt_groq_key;
    if (r.lt_model) document.getElementById('groq-model').value = r.lt_model;
    if (r.lt_form_url) document.getElementById('form-url').value = r.lt_form_url;
    document.getElementById('auto-submit').checked = !!r.lt_auto_submit;
    var bhMs = Number(r.lt_learned_baseline_ms) || 0;
    var bh = bhMs / 3600000;
    document.getElementById('baseline-hours').value = bh > 0 ? String(Math.round(bh * 10) / 10) : '';
    var th = Number(r.lt_learning_target_hours);
    document.getElementById('target-hours').value =
      !isNaN(th) && th > 0 ? String(th) : '40';
    document.getElementById('yt-learning-only').checked = r.lt_youtube_learning_only !== false;

    document.getElementById('domain-gate-enabled').checked = r.lt_domain_gate_enabled === true;
    var al = Array.isArray(r.lt_domain_allowlist) ? r.lt_domain_allowlist : null;
    if (!al || !al.length) al = STANDARD_LEARNING_DOMAINS.slice();
    document.querySelectorAll('.domain-std-cb').forEach(function (cb) {
      var d = cb.getAttribute('data-domain');
      cb.checked = al.indexOf(d) !== -1;
    });
    var custom = al.filter(function (x) {
      return STANDARD_LEARNING_DOMAINS.indexOf(x) === -1;
    });
    document.getElementById('domain-custom-extra').value = custom.join('\n');
  });
}

loadSettingsFromStorage();

document.getElementById('save-domain-gate').addEventListener('click', function() {
  var allow = [];
  document.querySelectorAll('.domain-std-cb').forEach(function (cb) {
    if (cb.checked) allow.push(cb.getAttribute('data-domain'));
  });
  var extra = document.getElementById('domain-custom-extra').value.split('\n')
    .map(function (l) { return l.trim(); })
    .filter(Boolean);
  extra.forEach(function (line) {
    if (allow.indexOf(line) === -1) allow.push(line);
  });
  var gate = document.getElementById('domain-gate-enabled').checked;
  if (gate && allow.length === 0) {
    return showStatus('domain-gate-status', 'Select at least one domain or turn off the gate.', 'err');
  }
  chrome.storage.local.set({
    lt_domain_gate_enabled: gate,
    lt_domain_allowlist: allow
  }, function() {
    if (chrome.runtime.lastError) {
      return showStatus('domain-gate-status', chrome.runtime.lastError.message, 'err');
    }
    showStatus('domain-gate-status', 'Saved. Reload video tabs to apply.', 'ok');
  });
});

document.getElementById('yt-learning-only').addEventListener('change', function() {
  var on = document.getElementById('yt-learning-only').checked;
  chrome.storage.local.set({ lt_youtube_learning_only: on }, function() {
    if (chrome.runtime.lastError) {
      return showStatus('yt-filter-status', chrome.runtime.lastError.message, 'err');
    }
    showStatus('yt-filter-status', on ? 'Saved. Reload YouTube watch tabs to apply.' : 'Saved. All categories will be tracked again.', 'ok');
  });
});

document.getElementById('save-learning-goals').addEventListener('click', function() {
  var bhRaw = String(document.getElementById('baseline-hours').value || '').trim();
  var thRaw = String(document.getElementById('target-hours').value || '').trim();
  var bh = bhRaw === '' ? 0 : parseFloat(bhRaw);
  var th = thRaw === '' ? 40 : parseFloat(thRaw);
  if (isNaN(bh) || bh < 0) bh = 0;
  if (isNaN(th) || th < 1) th = 40;
  chrome.storage.local.set({
    lt_learned_baseline_ms: Math.round(bh * 3600000),
    lt_learning_target_hours: th
  }, function() {
    if (chrome.runtime.lastError) {
      return showStatus('learning-goals-status', chrome.runtime.lastError.message, 'err');
    }
    showStatus('learning-goals-status', 'Saved. Open the extension popup to see updated totals.', 'ok');
  });
});

document.getElementById('save-key').addEventListener('click', function() {
  var key = document.getElementById('groq-key').value.trim();
  var model = document.getElementById('groq-model').value;
  if (!key) return showStatus('key-status', 'Enter your API key', 'err');
  chrome.storage.local.set({ lt_groq_key: key, lt_model: model }, function() {
    showStatus('key-status', 'Saved!', 'ok');
  });
});

document.getElementById('test-key').addEventListener('click', async function() {
  var key = document.getElementById('groq-key').value.trim();
  var model = document.getElementById('groq-model').value;
  if (!key) return showStatus('key-status', 'Enter your API key first', 'err');
  showStatus('key-status', 'Testing…', 'info');
  try {
    var r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 })
    });
    if (r.ok) {
      var d = await r.json();
      showStatus('key-status', '✓ Connected! Model: ' + d.model, 'ok');
    } else {
      var e = await r.json().catch(function(){return{};});
      showStatus('key-status', 'Error: ' + (e.error && e.error.message || r.statusText), 'err');
    }
  } catch(e) {
    showStatus('key-status', 'Network error: ' + e.message, 'err');
  }
});

document.getElementById('save-form').addEventListener('click', function() {
  var url = document.getElementById('form-url').value.trim();
  if (!url || !url.includes('docs.google.com/forms')) {
    return showStatus('form-status', 'Please enter a valid Google Forms URL', 'err');
  }
  chrome.storage.local.set({ lt_form_url: url }, function() {
    showStatus('form-status', 'Saved!', 'ok');
  });
});

document.getElementById('open-form').addEventListener('click', function() {
  var url = document.getElementById('form-url').value.trim();
  if (url) chrome.tabs.create({ url: url });
});

document.getElementById('save-prefs').addEventListener('click', function() {
  var autoSubmit = document.getElementById('auto-submit').checked;
  chrome.storage.local.set({ lt_auto_submit: autoSubmit }, function() {
    showStatus('prefs-status', 'Saved!', 'ok');
  });
});

document.getElementById('clear-data').addEventListener('click', function() {
  if (!confirm('Delete ALL session data? This cannot be undone.')) return;
  chrome.storage.local.remove(['lt_sessions','lt_streak','lt_insights','lt_pending_form'], function() {
    showStatus('clear-status', 'All session data cleared', 'info');
  });
});

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function backupFilenameDate() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

document.getElementById('export-data').addEventListener('click', function() {
  chrome.storage.local.get(EXPORT_KEYS, function(r) {
    if (chrome.runtime.lastError) {
      return showStatus('backup-status', chrome.runtime.lastError.message, 'err');
    }
    var data = {};
    for (var i = 0; i < EXPORT_KEYS.length; i++) {
      var k = EXPORT_KEYS[i];
      if (r[k] !== undefined) data[k] = r[k];
    }
    var payload = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: data
    };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'learning-tracker-backup-' + backupFilenameDate() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('backup-status', 'Backup downloaded.', 'ok');
  });
});

function extractBackupData(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid file: not an object');
  if (parsed.schema === BACKUP_SCHEMA && parsed.data && typeof parsed.data === 'object') {
    if (parsed.version != null && parsed.version !== BACKUP_VERSION) {
      throw new Error('Unsupported backup version: ' + parsed.version);
    }
    return parsed.data;
  }
  var data = {};
  var n = 0;
  for (var i = 0; i < EXPORT_KEYS.length; i++) {
    var k = EXPORT_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(parsed, k)) {
      data[k] = parsed[k];
      n++;
    }
  }
  if (n > 0) return data;
  throw new Error('Invalid file: not a Learning Tracker backup');
}

function parseBackupJson(text) {
  return extractBackupData(JSON.parse(text));
}

function sanitizeSessions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(s) {
    return s && typeof s === 'object' && s.id != null && String(s.id).length > 0;
  });
}

document.getElementById('import-pick').addEventListener('click', function() {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', function(ev) {
  var f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!f) return;

  var mergeOnly = document.getElementById('import-mode-merge').checked;
  var reader = new FileReader();
  reader.onload = function() {
    try {
      var data = parseBackupJson(reader.result);
      if (mergeOnly) {
        var incoming = sanitizeSessions(data.lt_sessions);
        if (!incoming.length) {
          throw new Error('No sessions found in this backup');
        }
        chrome.storage.local.get(['lt_sessions'], function(cur) {
          if (chrome.runtime.lastError) {
            return showStatus('backup-status', chrome.runtime.lastError.message, 'err');
          }
          var existing = sanitizeSessions(cur.lt_sessions);
          var byId = {};
          for (var i = 0; i < existing.length; i++) byId[String(existing[i].id)] = existing[i];
          for (var j = 0; j < incoming.length; j++) {
            var row = incoming[j];
            byId[String(row.id)] = row;
          }
          var merged = Object.keys(byId).map(function(k) { return byId[k]; });
          merged.sort(function(a, b) {
            return (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
          });
          chrome.storage.local.set({ lt_sessions: merged }, function() {
            if (chrome.runtime.lastError) {
              return showStatus('backup-status', chrome.runtime.lastError.message, 'err');
            }
            showStatus('backup-status', 'Merged ' + incoming.length + ' session(s) from file. Total: ' + merged.length + '.', 'ok');
            loadSettingsFromStorage();
          });
        });
        return;
      }

      if (!confirm('Restore data from this file? Values in the backup will overwrite matching keys in the extension.')) {
        return;
      }

      var patch = {};
      for (var k = 0; k < EXPORT_KEYS.length; k++) {
        var key = EXPORT_KEYS[k];
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          if (key === 'lt_sessions') patch[key] = sanitizeSessions(data.lt_sessions);
          else patch[key] = data[key];
        }
      }
      if (Object.keys(patch).length === 0) {
        throw new Error('No recognized keys in backup file');
      }

      chrome.storage.local.set(patch, function() {
        if (chrome.runtime.lastError) {
          return showStatus('backup-status', chrome.runtime.lastError.message, 'err');
        }
        showStatus('backup-status', 'Restored ' + Object.keys(patch).length + ' key(s). Reload the popup if it is open.', 'ok');
        loadSettingsFromStorage();
      });
    } catch (e) {
      showStatus('backup-status', e.message || 'Import failed', 'err');
    }
  };
  reader.onerror = function() {
    showStatus('backup-status', 'Could not read file', 'err');
  };
  reader.readAsText(f);
});
