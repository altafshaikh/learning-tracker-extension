// utils/storage.js

export function get(key) {
  return new Promise(function(resolve) {
    chrome.storage.local.get([key], function(r) { resolve(r[key] ?? null); });
  });
}

export function set(key, value) {
  return new Promise(function(resolve) {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

export async function getSessions() {
  return (await get('lt_sessions')) || [];
}

export async function addSession(s) {
  var sessions = await getSessions();
  sessions.push(s);
  if (sessions.length > 500) sessions = sessions.slice(-500);
  await set('lt_sessions', sessions);
}

export async function updateSession(id, patch) {
  var sessions = await getSessions();
  var idx = sessions.findIndex(function(s) { return s.id === id; });
  if (idx !== -1) {
    sessions[idx] = Object.assign({}, sessions[idx], patch);
    await set('lt_sessions', sessions);
    return sessions[idx];
  }
  return null;
}

export async function deleteSession(id) {
  var sessions = await getSessions();
  var idx = sessions.findIndex(function(s) { return s.id === id; });
  if (idx !== -1) {
    sessions.splice(idx, 1);
    await set('lt_sessions', sessions);
    return true;
  }
  return false;
}

export async function getSettings() {
  var keys = ['lt_groq_key', 'lt_model', 'lt_form_url', 'lt_auto_submit', 'lt_form_email'];
  return new Promise(function(resolve) {
    chrome.storage.local.get(keys, resolve);
  });
}

export async function getUnsyncedSessions() {
  var sessions = await getSessions();
  return sessions.filter(function(s) { return !s.synced && s.enriched; });
}

export async function getWeekStats() {
  var sessions = await getSessions();
  var weekAgo = Date.now() - 7 * 24 * 3600000;
  var week = sessions.filter(function(s) { return s.startTime > weekAgo && s.durationMs > 60000; });
  var totalMs = week.reduce(function(a, s) { return a + (s.durationMs || 0); }, 0);
  var byDomain = {};
  week.forEach(function(s) {
    var d = (s.enriched && s.enriched.domain) || 'Unknown';
    byDomain[d] = (byDomain[d] || 0) + (s.durationMs || 0);
  });
  var topDomain = Object.entries(byDomain).sort(function(a,b){ return b[1]-a[1]; })[0];
  return {
    totalHours: Math.round(totalMs / 360000) / 10,
    sessionCount: week.length,
    topDomain: topDomain ? topDomain[0] : null,
    byDomain: byDomain
  };
}

export async function getStreak() {
  var streak = (await get('lt_streak')) || { current: 0, longest: 0, lastDate: null };
  return streak;
}

export async function bumpStreak() {
  var today = new Date().toDateString();
  var streak = await getStreak();
  if (streak.lastDate === today) return streak;
  var yesterday = new Date(Date.now() - 86400000).toDateString();
  var current = streak.lastDate === yesterday ? streak.current + 1 : 1;
  var updated = { current: current, longest: Math.max(streak.longest, current), lastDate: today };
  await set('lt_streak', updated);
  return updated;
}

export async function getInsights() {
  return (await get('lt_insights')) || [];
}

export async function saveInsights(insights) {
  await set('lt_insights', insights);
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
