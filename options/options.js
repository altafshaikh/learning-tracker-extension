// options/options.js

function showStatus(id, text, type) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.className = 'status ' + type;
  if (type !== 'err') setTimeout(function() { el.className = 'status'; }, 3000);
}

function loadSettingsFromStorage() {
  chrome.storage.local.get(['lt_groq_key','lt_model','lt_form_url','lt_auto_submit'], function(r) {
    if (r.lt_groq_key) document.getElementById('groq-key').value = r.lt_groq_key;
    if (r.lt_model) document.getElementById('groq-model').value = r.lt_model;
    if (r.lt_form_url) document.getElementById('form-url').value = r.lt_form_url;
    document.getElementById('auto-submit').checked = !!r.lt_auto_submit;
  });
}

loadSettingsFromStorage();

document.getElementById('apply-defaults').addEventListener('click', function() {
  fetch(chrome.runtime.getURL('config/defaults.json'))
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(d) {
      var patch = {};
      if (d.lt_form_url) patch.lt_form_url = d.lt_form_url;
      if (d.lt_model) patch.lt_model = d.lt_model;
      if (d.lt_auto_submit !== undefined) patch.lt_auto_submit = !!d.lt_auto_submit;
      if (Object.keys(patch).length === 0) {
        return showStatus('bundled-status', 'defaults.json has no lt_form_url / lt_model / lt_auto_submit to apply', 'err');
      }
      chrome.storage.local.set(patch, function() {
        showStatus('bundled-status', 'Applied from config/defaults.json', 'ok');
        loadSettingsFromStorage();
      });
    })
    .catch(function(e) {
      showStatus('bundled-status', 'Could not load defaults.json: ' + e.message, 'err');
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
