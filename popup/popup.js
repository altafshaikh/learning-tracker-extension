// popup/popup.js

var DOMAIN_ICONS = {
  'Business/Leadership': '📊',
  'Technology and Development Practices': '💻',
  'Communication Skills': '🗣',
  'Mandatory Compliance Training': '📋',
  'Interpersonal Skills': '🤝'
};
var INSIGHT_ICONS = { progress:'📈', gap:'🎯', suggestion:'💡', streak:'🔥' };

function msg(type, extra) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function(r) {
      resolve(r || {});
    });
  });
}

function fmtHours(ms) {
  var h = ms / 3600000;
  if (h < 0.1) return Math.round(ms / 60000) + 'm';
  return h.toFixed(1) + 'h';
}

function timeAgo(ts) {
  var d = Date.now() - ts, m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSessions(sessions) {
  var el = document.getElementById('sessions-list');
  if (!sessions || !sessions.length) {
    el.innerHTML = '<div class="empty-sessions"><div class="empty-ico">▶</div>Play any video to start tracking your learning journey.</div>';
    return;
  }
  el.innerHTML = sessions.slice(0, 20).map(function(s) {
    var e = s.enriched || {};
    var concept = e.concept || s.title || 'Unknown';
    var domain = e.domain || '';
    var dotCls = s.synced ? 'synced' : (s.enriched ? 'pending' : 'enriching');
    var dur = s.durationMs ? fmtHours(s.durationMs) : '';
    return '<div class="session-row">' +
      '<div class="sdot ' + dotCls + '"></div>' +
      '<div class="sinfo">' +
        '<div class="sconcept" title="' + concept + '">' + concept + '</div>' +
        '<div class="smeta">' +
          (domain ? '<span class="sdomain">' + (DOMAIN_ICONS[domain] || '📖') + ' ' + domain + '</span>' : '') +
          (dur ? '<span>' + dur + '</span>' : '') +
          '<span>' + timeAgo(s.startTime) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderInsights(insights) {
  var el = document.getElementById('insights-list');
  if (!insights || !insights.length) {
    el.innerHTML = '<div id="insights-placeholder">Insights generate after a few sessions are captured.</div>';
    return;
  }
  el.innerHTML = insights.map(function(ins) {
    return '<div class="insight">' +
      '<span class="insight-ico">' + (INSIGHT_ICONS[ins.type] || '✦') + '</span>' +
      '<span>' + ins.text + '</span>' +
    '</div>';
  }).join('');
}

function setSyncButton(count) {
  var btn = document.getElementById('btn-sync');
  var badge = document.getElementById('sync-badge');
  if (count > 0) {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.querySelector('span').textContent = '⟳ Sync Learning';
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    btn.disabled = true;
    btn.querySelector('span').textContent = 'All synced ✓';
    badge.style.display = 'none';
  }
}

// ── Check if any tab is currently tracking ────────────────────────────────────
function checkTrackingStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'LT_GET_STATUS' }, function(resp) {
      var bar = document.getElementById('tracking-bar');
      var dot = document.getElementById('status-dot');
      if (chrome.runtime.lastError || !resp) return;
      if (resp.playing) {
        bar.classList.add('active');
        dot.classList.remove('inactive');
        document.getElementById('tracking-title').textContent = resp.title || 'Tracking…';
      } else {
        bar.classList.remove('active');
        dot.classList.add('inactive');
      }
    });
  });
}

// ── Check API key ─────────────────────────────────────────────────────────────
function checkKey(callback) {
  chrome.storage.local.get(['lt_groq_key'], function(r) {
    var hasKey = !!r.lt_groq_key;
    document.getElementById('no-key-banner').style.display = hasKey ? 'none' : 'block';
    document.getElementById('insights-section').style.opacity = hasKey ? '1' : '0.5';
    if (callback) callback(hasKey);
  });
}

// ── Main load ─────────────────────────────────────────────────────────────────
function load() {
  checkKey();
  checkTrackingStatus();

  msg('LT_GET_DATA').then(function(data) {
    if (!data.ok) return;

    // Stats — today's hours from sessions today
    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
    var todaySessions = (data.sessions || []).filter(function(s) {
      return s.startTime >= todayStart.getTime();
    });
    var todayMs = todaySessions.reduce(function(a, s) { return a + (s.durationMs || 0); }, 0);
    document.getElementById('s-hrs').textContent = fmtHours(todayMs) || '0.0';
    document.getElementById('s-sess').textContent = String(todaySessions.length);
    document.getElementById('s-streak').textContent = (data.streak && data.streak.current) || 0;

    renderSessions(data.sessions || []);
    renderInsights(data.insights || []);
    setSyncButton(data.unsyncedCount || 0);
  });
}

// ── Button handlers ───────────────────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', load);

document.getElementById('btn-settings').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

document.getElementById('link-settings').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-insights').addEventListener('click', function() {
  var btn = this;
  btn.textContent = '…';
  btn.disabled = true;
  msg('LT_REFRESH_INSIGHTS').then(function(r) {
    if (r.insights) renderInsights(r.insights);
    btn.textContent = 'Refresh';
    btn.disabled = false;
  });
});

document.getElementById('btn-sync').addEventListener('click', function() {
  var btn = this;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.querySelector('span').textContent = 'Opening form…';
  document.getElementById('sync-badge').style.display = 'none';

  chrome.storage.local.get(['lt_auto_submit'], function(r) {
    msg('LT_SYNC_ALL', { autoSubmit: !!r.lt_auto_submit }).then(function(result) {
      if (result.ok) {
        btn.querySelector('span').textContent = 'Synced ' + (result.synced || 0) + ' ✓';
        setTimeout(load, 1500);
      } else if (result.reason === 'no_form_url') {
        btn.querySelector('span').textContent = 'Set Form URL first!';
        btn.classList.remove('busy');
        btn.disabled = false;
        setTimeout(function() { chrome.runtime.openOptionsPage(); }, 1000);
      } else {
        btn.querySelector('span').textContent = 'Error — retry';
        btn.classList.remove('busy');
        btn.disabled = false;
      }
    });
  });
});

// Stop button in tracking bar
document.getElementById('btn-stop').addEventListener('click', function() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'LT_MANUAL_STOP' });
    document.getElementById('tracking-bar').classList.remove('active');
    document.getElementById('status-dot').classList.add('inactive');
    setTimeout(load, 500);
  });
});

load();
