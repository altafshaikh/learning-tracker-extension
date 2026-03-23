// options/options.js

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
    'lt_learning_target_hours'
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
  });
}

loadSettingsFromStorage();

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
