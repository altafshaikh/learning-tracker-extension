// background/service-worker.js
import {
  addSession, updateSession, getSessions, deleteSession,
  getSettings, getUnsyncedSessions, getWeekStats,
  getStreak, bumpStreak, generateId,
  getInsights, saveInsights
} from '../utils/storage.js';
import {
  enrichSession,
  generateInsights,
  inferDomain,
  classifyTrackAllowlist,
  resolveAllowlistDomain,
  DOMAINS
} from '../utils/groq.js';
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

function manualPauseKey(tabId) {
  return 'lt_mpause_' + tabId;
}

/** Save a paused manual reading session when the tab navigates away (cross-origin = paused, not ended). */
async function finalizeStashedManualOnTabClose(tabId) {
  var key = manualPauseKey(tabId);
  var raw = await chrome.storage.session.get(key);
  var snap = raw[key];
  if (!snap) return;
  await chrome.storage.session.remove(key);
  var dur = num(snap.totalPlayMs, 0);
  if (dur < 30000) return;
  var sessionRow = {
    id: snap.id || generateId(),
    title: snap.title,
    url: snap.url,
    startTime: num(snap.startTime, Date.now()),
    endTime: Date.now(),
    durationMs: dur,
    enriched: null,
    synced: false,
    createdAt: Date.now(),
    manualReading: true,
    exploredPages: Array.isArray(snap.exploredPages) ? snap.exploredPages : []
  };
  await addSession(sessionRow);
  setTimeout(function() { runEnrich(sessionRow.id); }, 200);
  await updateBadge();
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

function effectiveEnrichDomains(settings) {
  var a = settings.lt_domain_allowlist;
  if (Array.isArray(a) && a.length) return a;
  return DOMAINS;
}

// ── Enrich a session with Groq ────────────────────────────────────────────────
async function runEnrich(id) {
  var settings = await getSettings();
  if (!settings.lt_groq_key) return;

  var sessions = await getSessions();
  var s = sessions.find(function(x) { return x.id === id; });
  if (!s) return;

  try {
    var enriched = await enrichSession(
      settings.lt_groq_key,
      s,
      settings.lt_model,
      effectiveEnrichDomains(settings)
    );
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

  // Content script: Groq pre-check — only track if title/URL fits allowed domain list
  if (msg.type === 'LT_CLASSIFY_TRACK') {
    var settingsC = await getSettings();
    if (!settingsC.lt_domain_gate_enabled) {
      return { ok: true, track: true, skipped: true };
    }
    var list = settingsC.lt_domain_allowlist;
    if (!Array.isArray(list) || !list.length) {
      return { ok: true, track: false, reason: 'empty_allowlist' };
    }
    if (!settingsC.lt_groq_key) {
      return { ok: true, track: false, reason: 'no_key' };
    }
    var out = await classifyTrackAllowlist(
      settingsC.lt_groq_key,
      msg.title,
      msg.url,
      settingsC.lt_model,
      list
    );
    return {
      ok: true,
      track: out.track,
      domain: out.domain,
      classifiedDomain: out.classifiedDomain,
      blockedByAllowlist: !!out.blockedByAllowlist,
      notLearning: !!out.notLearning,
      predictedDomain: out.predictedDomain || null,
      predictedAlreadyAllowed: !!out.predictedAlreadyAllowed,
      nonLearningHint: out.nonLearningHint || null,
      classifyErrorFallback: !!out.classifyErrorFallback
    };
  }

  if (msg.type === 'LT_ADD_DOMAIN_TO_ALLOWLIST') {
    var label = String(msg.domain || '').trim();
    if (!label) return { ok: false, error: 'empty_domain' };
    var settingsAdd = await getSettings();
    var cur = Array.isArray(settingsAdd.lt_domain_allowlist)
      ? settingsAdd.lt_domain_allowlist.slice()
      : [];
    if (resolveAllowlistDomain(label, cur)) {
      return { ok: true, already: true, allowlist: cur };
    }
    cur.push(label);
    await new Promise(function (resolve) {
      chrome.storage.local.set({ lt_domain_allowlist: cur }, resolve);
    });
    return { ok: true, allowlist: cur };
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
      createdAt: Date.now(),
      manualReading: !!s.manualReading,
      exploredPages: Array.isArray(s.exploredPages) ? s.exploredPages : []
    };

    await addSession(session);
    // Enrich async — don't block
    setTimeout(function() { runEnrich(session.id); }, 200);
    return { ok: true };
  }

  // Popup: get all data for display (single source for Charts + Insights totals)
  if (msg.type === 'LT_GET_DATA') {
    var settingsData = await getSettings();
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
      hasGroqKey: !!settingsData.lt_groq_key,
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

  // Popup: delete a session
  if (msg.type === 'LT_DELETE_SESSION') {
    var ok = await deleteSession(msg.sessionId);
    await updateBadge();
    return { ok: ok };
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

  // Popup: sync one session to Google Form (forceResync allows already-synced rows)
  if (msg.type === 'LT_SYNC_SESSION') {
    return await doSync(msg.sessionId, msg.autoSubmit, { forceResync: !!msg.forceResync });
  }

  // Manual reading: stash on pagehide (pause), resume when returning to same origin
  if (msg.type === 'LT_MANUAL_STASH') {
    var tid = sender.tab && sender.tab.id;
    if (tid == null || !msg.snapshot) return { ok: false, reason: 'bad_stash' };
    await chrome.storage.session.set({ [manualPauseKey(tid)]: msg.snapshot });
    return { ok: true };
  }

  if (msg.type === 'LT_MANUAL_TRY_RESUME') {
    var tid2 = sender.tab && sender.tab.id;
    if (tid2 == null) return { ok: false, reason: 'no_tab' };
    var k = manualPauseKey(tid2);
    var raw2 = await chrome.storage.session.get(k);
    var snap2 = raw2[k];
    if (!snap2) return { ok: false, reason: 'no_stash' };
    if (String(msg.origin || '') !== String(snap2.origin || '')) {
      return { ok: false, reason: 'origin_mismatch' };
    }
    return { ok: true, snapshot: snap2 };
  }

  if (msg.type === 'LT_MANUAL_CLEAR_STASH') {
    var tid3 = sender.tab && sender.tab.id;
    if (tid3 != null) await chrome.storage.session.remove(manualPauseKey(tid3));
    return { ok: true };
  }

  // Popup: sync all pending — one tab, wait for each formResponse before next
  if (msg.type === 'LT_SYNC_ALL') {
    var pendingAll = await getUnsyncedSessions();
    if (!pendingAll.length) return { ok: true, synced: 0, total: 0 };
    var settingsAll = await getSettings();
    if (!settingsAll.lt_form_url) return { ok: false, reason: 'no_form_url' };
    var reuseTabId = null;
    var okCount = 0;
    var batchFailReason = null;
    for (var j = 0; j < pendingAll.length; j++) {
      var rBatch = await doSync(pendingAll[j].id, msg.autoSubmit, {
        reuseTabId: reuseTabId,
        syncBatch: true
      });
      if (rBatch.tabId) reuseTabId = rBatch.tabId;
      if (rBatch.ok) okCount++;
      else {
        batchFailReason = rBatch.reason || 'sync_failed';
        break;
      }
      if (j < pendingAll.length - 1) await sleep(600);
    }
    if (reuseTabId && settingsAll.lt_form_url) {
      try {
        await chrome.tabs.update(reuseTabId, { url: settingsAll.lt_form_url, active: true });
        await waitForTabComplete(reuseTabId, 25000);
      } catch (eNav) {}
    }
    var allDone = okCount === pendingAll.length;
    return {
      ok: allDone,
      synced: okCount,
      total: pendingAll.length,
      reason: allDone ? undefined : batchFailReason
    };
  }

  return { ok: false, reason: 'unknown_type' };
}

// ── Form sync ─────────────────────────────────────────────────────────────────
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise(function(resolve) {
    var resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(tid);
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function(t) {
      try {
        if (t && t.status === 'complete') done();
      } catch (e) {}
    });
    var tid = setTimeout(done, timeoutMs || 35000);
  });
}

/** True when tab URL is post-submit confirmation (…/formResponse). */
function waitForFormResponseUrl(tabId, timeoutMs) {
  return new Promise(function(resolve) {
    var resolved = false;
    function finish(hit) {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(tid);
      resolve(hit);
    }
    function isFormResponse(url) {
      return url && /docs\.google\.com\/forms\/.*\/formResponse/i.test(String(url));
    }
    function listener(id, info, tab) {
      if (id !== tabId) return;
      var u = (info && info.url) || (tab && tab.url) || '';
      if (isFormResponse(u)) finish(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function(t) {
      try {
        if (t && isFormResponse(t.url)) finish(true);
      } catch (e) {}
    });
    var tid = setTimeout(function() { finish(false); }, timeoutMs || 180000);
  });
}

/**
 * @param {{ reuseTabId?: number, syncBatch?: boolean, forceResync?: boolean }} [opts]
 */
async function doSync(sessionId, autoSubmit, opts) {
  opts = opts || {};
  var settings = await getSettings();
  if (!settings.lt_form_url) return { ok: false, reason: 'no_form_url' };

  var sessions = await getSessions();
  var s = sessions.find(function(x) { return x.id === sessionId; });
  if (!s) return { ok: false, reason: 'not_found' };
  if (s.synced && !opts.forceResync) return { ok: false, reason: 'already_synced' };
  if (!s.enriched) return { ok: false, reason: 'not_enriched' };

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
    sessionId: sessionId,
    formEmail: (settings.lt_form_email || '').trim(),
    viewFormUrl: settings.lt_form_url
  };

  await new Promise(function(resolve) {
    chrome.storage.local.set({ lt_pending_form: formData }, resolve);
  });

  var tabId;
  if (opts.reuseTabId) {
    tabId = opts.reuseTabId;
    await chrome.tabs.update(tabId, { url: settings.lt_form_url, active: true });
    await waitForTabComplete(tabId, 35000);
  } else {
    var tab = await chrome.tabs.create({ url: settings.lt_form_url, active: true });
    tabId = tab.id;
    await waitForTabComplete(tabId, 35000);
  }

  await sleep(2000);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/form-filler.js']
    });
  } catch (err) {
    return { ok: false, reason: 'script_inject_failed', error: err.message, tabId: tabId };
  }

  var waitMs = autoSubmit ? 180000 : 900000;
  var sawResponse = await waitForFormResponseUrl(tabId, waitMs);
  if (!sawResponse) {
    return { ok: false, reason: 'response_timeout', tabId: tabId };
  }

  await sleep(500);

  await updateSession(sessionId, { synced: true, syncedAt: Date.now() });
  await updateBadge();

  if (!opts.syncBatch && settings.lt_form_url) {
    try {
      await chrome.tabs.update(tabId, { url: settings.lt_form_url, active: true });
      await waitForTabComplete(tabId, 25000);
    } catch (e2) {}
  }

  return { ok: true, tabId: tabId };
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

chrome.tabs.onRemoved.addListener(function(tabId) {
  finalizeStashedManualOnTabClose(tabId);
});

startup();
console.log('[LT] Service worker ready');
