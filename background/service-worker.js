// background/service-worker.js
import {
  addSession, updateSession, getSessions,
  getSettings, getUnsyncedSessions, getWeekStats,
  getStreak, bumpStreak, generateId,
  getInsights, saveInsights
} from '../utils/storage.js';
import { enrichSession, generateInsights, inferDomain } from '../utils/groq.js';
import { seedBundledDefaultsIfEmpty } from '../utils/defaults.js';

function num(x, d) {
  var n = Number(x);
  return isNaN(n) ? (d != null ? d : 0) : n;
}

function normalizeSession(s) {
  return Object.assign({}, s, {
    durationMs: num(s.durationMs, 0),
    startTime: num(s.startTime, 0),
    endTime: s.endTime != null ? num(s.endTime, 0) : s.endTime,
    createdAt: s.createdAt != null ? num(s.createdAt, 0) : s.createdAt
  });
}

function computeDomainSpreadMs(sessions, daysBack) {
  var cutoff = Date.now() - (daysBack || 30) * 86400000;
  var map = {};
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var st = num(s.startTime, 0);
    if (st < cutoff) continue;
    var d = (s.enriched && s.enriched.domain) || inferDomain((s.title || '') + ' ' + (s.url || ''));
    map[d] = (map[d] || 0) + num(s.durationMs, 0);
  }
  return map;
}

function domainSpreadToText(map) {
  var lines = Object.keys(map)
    .map(function(k) { return [k, map[k]]; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(e) {
      return '- ' + e[0] + ': ' + Math.round(e[1] / 60000) + ' min';
    });
  return lines.length ? lines.join('\n') : '(no sessions in window)';
}

function domainSpreadToSortedPairs(map) {
  return Object.keys(map)
    .map(function(k) { return [k, map[k]]; })
    .sort(function(a, b) { return b[1] - a[1]; });
}

function yearProgressPct() {
  var now = new Date();
  var y0 = new Date(now.getFullYear(), 0, 1).getTime();
  var y1 = new Date(now.getFullYear() + 1, 0, 1).getTime();
  return Math.round(((now.getTime() - y0) / (y1 - y0)) * 100);
}

async function buildInsightCtx(sessions) {
  var learnPrefs = await new Promise(function(resolve) {
    chrome.storage.local.get(['lt_learned_baseline_ms', 'lt_learning_target_hours'], resolve);
  });
  var baseline = num(learnPrefs.lt_learned_baseline_ms, 0);
  var extMs = sessions.reduce(function(a, s) { return a + num(s.durationMs, 0); }, 0);
  var targetH = num(learnPrefs.lt_learning_target_hours, 40);
  if (targetH <= 0) targetH = 40;
  var spreadMap = computeDomainSpreadMs(sessions, 30);
  return {
    targetHours: targetH,
    totalLearnedMs: baseline + extMs,
    domainSpreadText: domainSpreadToText(spreadMap),
    yearProgressPct: yearProgressPct()
  };
}

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
      var normalized = all.map(normalizeSession);
      var ctx = await buildInsightCtx(normalized);
      var insights = await generateInsights(settings.lt_groq_key, normalized, settings.lt_model, ctx);
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
    var dur = s ? num(s.durationMs, 0) : 0;
    if (!s || dur < 30000) return { ok: false, reason: 'too_short' };

    var session = {
      id: s.id || generateId(),
      title: s.title,
      url: s.url,
      startTime: num(s.startTime, Date.now()),
      endTime: s.endTime || Date.now(),
      durationMs: dur,
      enriched: null,
      synced: false,
      createdAt: Date.now()
    };

    await addSession(session);
    // Enrich async — don't block
    setTimeout(function() { runEnrich(session.id); }, 200);
    return { ok: true };
  }

  // Popup: get all data for display (single source for Charts + Insights totals)
  if (msg.type === 'LT_GET_DATA') {
    var rawSessions = await getSessions();
    var sessions = rawSessions.map(normalizeSession);
    var stats = await getWeekStats();
    var streak = await getStreak();
    var insights = await getInsights();
    var unsynced = await getUnsyncedSessions();
    var learnPrefs = await new Promise(function(resolve) {
      chrome.storage.local.get(['lt_learned_baseline_ms', 'lt_learning_target_hours'], resolve);
    });
    var extMs = sessions.reduce(function(a, s) { return a + num(s.durationMs, 0); }, 0);
    var baseline = num(learnPrefs.lt_learned_baseline_ms, 0);
    var targetH = num(learnPrefs.lt_learning_target_hours, 40);
    if (targetH <= 0) targetH = 40;
    var earliest = null;
    for (var si = 0; si < sessions.length; si++) {
      var t0 = num(sessions[si].startTime, 0);
      if (earliest == null || t0 < earliest) earliest = t0;
    }
    var spread7 = computeDomainSpreadMs(sessions, 7);
    var spread30 = computeDomainSpreadMs(sessions, 30);
    var pairs30 = domainSpreadToSortedPairs(spread30);
    var yp = yearProgressPct();
    var totalLearnedMs = baseline + extMs;
    var ctxSnap = {
      targetHours: targetH,
      totalLearnedMs: totalLearnedMs,
      domainSpreadText: domainSpreadToText(spread30),
      yearProgressPct: yp
    };
    return {
      ok: true,
      sessions: sessions.slice(-30).reverse(),
      allSessions: sessions,
      stats: stats,
      streak: streak,
      insights: insights,
      unsyncedCount: unsynced.length,
      learnedBaselineMs: baseline,
      learningTargetHours: targetH,
      extensionRecordedMs: extMs,
      totalLearnedMs: totalLearnedMs,
      firstSessionStart: earliest,
      domainPieWeek: domainSpreadToSortedPairs(spread7),
      domainPieMonth: pairs30,
      yearProgressPct: yp,
      insightContext: ctxSnap
    };
  }

  // Popup: manually trigger Groq insights refresh
  if (msg.type === 'LT_REFRESH_INSIGHTS') {
    var settings = await getSettings();
    if (!settings.lt_groq_key) return { ok: false, reason: 'no_key' };
    var sessionsR = (await getSessions()).map(normalizeSession);
    var ctxR = await buildInsightCtx(sessionsR);
    var insights = await generateInsights(settings.lt_groq_key, sessionsR, settings.lt_model, ctxR);
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

// ── Startup: seed config/defaults.json into empty storage keys (single source in repo) ──
async function startup() {
  await seedBundledDefaultsIfEmpty();
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(function() {
  startup();
});

startup();
console.log('[LT] Service worker ready');
