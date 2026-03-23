// background/service-worker.js
import {
  addSession, updateSession, getSessions,
  getSettings, getUnsyncedSessions, getWeekStats,
  getStreak, bumpStreak, generateId,
  getInsights, saveInsights
} from '../utils/storage.js';
import { enrichSession, generateInsights } from '../utils/groq.js';

// ── Badge helper ──────────────────────────────────────────────────────────────
async function updateBadge() {
  var unsynced = await getUnsyncedSessions();
  var count = unsynced.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#3ecf8e' });
}

// ── Enrich a session with Groq ────────────────────────────────────────────────
async function runEnrich(id) {
  var settings = await getSettings();
  if (!settings.lt_groq_key) return;

  var sessions = await getSessions();
  var s = sessions.find(function(x) { return x.id === id; });
  if (!s) return;

  try {
    var enriched = await enrichSession(settings.lt_groq_key, s, settings.lt_model);
    await updateSession(id, { enriched: enriched });
    await bumpStreak();
    await updateBadge();

    // Regenerate insights every 3 sessions
    var all = await getSessions();
    if (all.filter(function(x){ return x.enriched; }).length % 3 === 0) {
      var insights = await generateInsights(settings.lt_groq_key, all, settings.lt_model);
      if (insights && insights.length) await saveInsights(insights);
    }
  } catch(e) {
    console.error('[SW] Enrich error:', e.message);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  handle(msg, sender).then(sendResponse).catch(function(e) {
    sendResponse({ ok: false, error: e.message });
  });
  return true;
});

async function handle(msg, sender) {
  // Content script: playback started (optional; avoids unknown_type noise)
  if (msg.type === 'LT_PLAYING') {
    return { ok: true };
  }

  // Content script: video session ended
  if (msg.type === 'LT_SESSION_END') {
    var s = msg.session;
    if (!s || s.durationMs < 30000) return { ok: false, reason: 'too_short' };

    var session = {
      id: s.id || generateId(),
      title: s.title,
      url: s.url,
      startTime: s.startTime,
      endTime: s.endTime || Date.now(),
      durationMs: s.durationMs,
      enriched: null,
      synced: false,
      createdAt: Date.now()
    };

    await addSession(session);
    // Enrich async — don't block
    setTimeout(function() { runEnrich(session.id); }, 200);
    return { ok: true };
  }

  // Popup: get all data for display
  if (msg.type === 'LT_GET_DATA') {
    var sessions = await getSessions();
    var stats = await getWeekStats();
    var streak = await getStreak();
    var insights = await getInsights();
    var unsynced = await getUnsyncedSessions();
    return {
      ok: true,
      sessions: sessions.slice(-30).reverse(),
      stats: stats,
      streak: streak,
      insights: insights,
      unsyncedCount: unsynced.length
    };
  }

  // Popup: manually trigger Groq insights refresh
  if (msg.type === 'LT_REFRESH_INSIGHTS') {
    var settings = await getSettings();
    if (!settings.lt_groq_key) return { ok: false, reason: 'no_key' };
    var sessions = await getSessions();
    var insights = await generateInsights(settings.lt_groq_key, sessions, settings.lt_model);
    if (insights && insights.length) await saveInsights(insights);
    return { ok: true, insights: insights };
  }

  // Popup: sync one session to Google Form
  if (msg.type === 'LT_SYNC_SESSION') {
    return await doSync(msg.sessionId, msg.autoSubmit);
  }

  // Popup: sync all pending
  if (msg.type === 'LT_SYNC_ALL') {
    var pending = await getUnsyncedSessions();
    if (!pending.length) return { ok: true, synced: 0 };
    var results = [];
    for (var i = 0; i < pending.length; i++) {
      var r = await doSync(pending[i].id, msg.autoSubmit);
      results.push(r);
      if (i < pending.length - 1) await sleep(2500);
    }
    var count = results.filter(function(r){ return r.ok; }).length;
    return { ok: true, synced: count, total: pending.length };
  }

  return { ok: false, reason: 'unknown_type' };
}

// ── Form sync ─────────────────────────────────────────────────────────────────
async function doSync(sessionId, autoSubmit) {
  var settings = await getSettings();
  if (!settings.lt_form_url) return { ok: false, reason: 'no_form_url' };

  var sessions = await getSessions();
  var s = sessions.find(function(x) { return x.id === sessionId; });
  if (!s) return { ok: false, reason: 'not_found' };

  var e = s.enriched || {};
  var formData = {
    concept: e.concept || s.title,
    hours: String(e.hours || Math.round(s.durationMs / 36000) / 100),
    date: new Date(s.startTime).toISOString().split('T')[0],
    domain: e.domain || 'Technology and Development Practices',
    sourceUrl: s.url,
    skillset: e.skillset || '',
    epicLink: e.epicLink || '',
    autoSubmit: !!autoSubmit,
    sessionId: sessionId
  };

  // Store form data for the content script to pick up
  await new Promise(function(resolve) {
    chrome.storage.local.set({ lt_pending_form: formData }, resolve);
  });

  // Open form in new tab and inject filler when loaded
  var tab = await chrome.tabs.create({ url: settings.lt_form_url, active: true });

  await new Promise(function(resolve) {
    var listener = function(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout safety
    setTimeout(resolve, 10000);
  });

  await sleep(1500); // React hydration settle time

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/form-filler.js']
    });
  } catch(e) {
    return { ok: false, reason: 'script_inject_failed', error: e.message };
  }

  // Mark as synced
  await updateSession(sessionId, { synced: true, syncedAt: Date.now() });
  await updateBadge();

  return { ok: true };
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// ── Startup ───────────────────────────────────────────────────────────────────
updateBadge();
console.log('[LT] Service worker ready');
