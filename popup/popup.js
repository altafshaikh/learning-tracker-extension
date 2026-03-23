// popup/popup.js

var liveTick = null;
var chartRange = 'day';
var chartMode = 'line';
var lastSessionsFull = [];
var lastDomainPieWeek = [];
var lastInsightSnapshot = null;

var INSIGHT_SVG = {
  progress: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M7 12l4-4 4 4 6-6"/></svg>',
  gap: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  suggestion: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 13v2h8v-2a7 7 0 00-4-13z"/></svg>',
  streak: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1-1-2-2-3s-2-2-2-3a2.5 2.5 0 014 0 2.5 2.5 0 014 0c0 1-1 2-2 3s-2 2-2 3a2.5 2.5 0 002.5 2.5"/></svg>',
  domain: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>',
  ontrack: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10z"/><path d="M12 6v6l4 2"/></svg>'
};

var SESS_ICO = '<svg class="sess-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M8 7h8M8 11h5"/></svg>';

var SESS_SYNC_ARROW = '<svg class="sess-sync-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36M20.49 15a9 9 0 01-14.85 3.36"/></svg>';
var SESS_SYNC_CHECK = '<svg class="sess-sync-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

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

function nMs(ms) {
  var n = Number(ms);
  return isNaN(n) ? 0 : n;
}

function fmtTotalLong(ms) {
  ms = nMs(ms);
  if (!ms || ms < 1000) return '0s';
  var sec = Math.floor(ms / 1000);
  var d = Math.floor(sec / 86400);
  sec %= 86400;
  var h = Math.floor(sec / 3600);
  sec %= 3600;
  var m = Math.floor(sec / 60);
  sec %= 60;
  var p = [];
  if (d) p.push(d + 'd');
  if (h) p.push(h + 'h');
  if (m) p.push(m + 'm');
  if (sec > 0 || !p.length) p.push(sec + 's');
  return p.join(' ');
}

function fmtShortDur(ms) {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  return (ms / 3600000).toFixed(1) + 'h';
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function fmtLive(ms) {
  if (!ms || ms < 0) return '0:00';
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var h = Math.floor(m / 60);
  s = s % 60;
  m = m % 60;
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
  return m + ':' + pad2(s);
}

function timeAgo(ts) {
  var d = Date.now() - ts, m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function fmtAbsStart(ts) {
  var t = nMs(ts);
  if (!t) return '';
  var d = new Date(t);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function yearProgressPctLocal() {
  var now = new Date();
  var y0 = new Date(now.getFullYear(), 0, 1).getTime();
  var y1 = new Date(now.getFullYear() + 1, 0, 1).getTime();
  return Math.round(((now.getTime() - y0) / (y1 - y0)) * 100);
}

/** Mirrors utils/groq.js inferDomain for pie fallback when the service worker is older. */
function inferDomainLocal(text) {
  text = String(text || '').toLowerCase();
  if (/react|vue|angular|python|js|typescript|aws|docker|git|api|code|dev|cloud|sql|linux/.test(text))
    return 'Technology and Development Practices';
  if (/leadership|management|strategy|business|product|agile|scrum|okr|roadmap/.test(text))
    return 'Business/Leadership';
  if (/communication|writing|presentation|speaking|email|storytelling/.test(text))
    return 'Communication Skills';
  if (/compliance|gdpr|security|privacy|legal|policy|regulation/.test(text))
    return 'Mandatory Compliance Training';
  if (/team|empathy|feedback|coaching|interpersonal|collaboration/.test(text))
    return 'Interpersonal Skills';
  return 'Technology and Development Practices';
}

function onTrackLine(totalMs, targetH, yearPct) {
  var learnedH = nMs(totalMs) / 3600000;
  var expectedH = targetH * (yearPct / 100);
  if (yearPct < 4)
    return 'Early in the year — keep logging sessions; pace compares once more time has passed.';
  if (learnedH >= expectedH * 0.88)
    return 'You are on track versus a simple linear pace to your ' + targetH + 'h goal.';
  var gap = Math.max(0, expectedH - learnedH);
  return 'Roughly ' + gap.toFixed(1) + 'h behind a linear year pace — short regular sessions help close the gap.';
}

function isOnTrackGood(totalMs, targetH, yearPct) {
  var learnedH = nMs(totalMs) / 3600000;
  var expectedH = targetH * (yearPct / 100);
  if (yearPct < 4) return true;
  return learnedH >= expectedH * 0.88;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function compareLastTwoWeeks(sessions) {
  sessions = sessions || [];
  var now = Date.now();
  var w = 7 * 86400000;
  function sumRange(a, b) {
    return sessions.reduce(function(acc, s) {
      var t = nMs(s.startTime);
      if (t >= a && t < b) return acc + nMs(s.durationMs);
      return acc;
    }, 0);
  }
  var cur = sumRange(now - w, now);
  var prev = sumRange(now - 2 * w, now - w);
  var pct = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
  return { curMs: cur, prevMs: prev, pct: pct };
}

function learnerRank(totalHours) {
  if (totalHours < 0.5) return { title: 'First steps', blurb: 'Log your first half hour to unlock Curious mind.' };
  if (totalHours < 5) return { title: 'Curious mind', blurb: 'Next rank at 5h — steady wins.' };
  if (totalHours < 20) return { title: 'Dedicated learner', blurb: 'Next rank at 20h — you are building depth.' };
  if (totalHours < 50) return { title: 'Serious student', blurb: 'Next rank at 50h — impressive focus.' };
  if (totalHours < 120) return { title: 'Knowledge hunter', blurb: 'Next rank at 120h — rare air.' };
  return { title: 'Lifelong legend', blurb: 'Raise your target in Settings and keep going.' };
}

function computeLongestSession(sessions) {
  if (!sessions || !sessions.length) return null;
  var best = null;
  sessions.forEach(function(s) {
    var d = nMs(s.durationMs);
    if (d < 30000) return;
    if (!best || d > best.durationMs) {
      var e = s.enriched || {};
      best = { durationMs: d, title: e.concept || s.title || 'Session' };
    }
  });
  return best;
}

function encouragementText(totalMs, pct, streak) {
  var h = nMs(totalMs) / 3600000;
  if (h < 1 / 60) return '';
  if (pct >= 100) return 'Target met — set a new goal in Settings and celebrate.';
  if (pct >= 75) return 'Almost there — your goal is in sight.';
  if (pct >= 50) return 'Past halfway. Keep the rhythm.';
  if (pct >= 25) return 'Strong progress — consistency compounds.';
  var st = streak || 0;
  if (st >= 5) return st + '-day streak. Showing up is the whole game.';
  if (st >= 2) return st + '-day streak — nice momentum.';
  if (h >= 0.25) return 'Every session counts. You are doing the work.';
  return 'Great start — small blocks add up fast.';
}

function buildSeries(sessions, range) {
  sessions = sessions || [];
  var now = new Date();
  var labels = [];
  var values = [];
  var i;
  var j;
  if (range === 'day') {
    for (i = 0; i < 24; i++) {
      if (i === 0) labels.push('12a');
      else if (i < 12) labels.push(i + 'a');
      else if (i === 12) labels.push('12p');
      else labels.push(i - 12 + 'p');
      values.push(0);
    }
    var start = new Date(now);
    start.setHours(0, 0, 0, 0);
    var end = new Date(start);
    end.setDate(end.getDate() + 1);
    sessions.forEach(function(s) {
      if (s.startTime < start.getTime() || s.startTime >= end.getTime()) return;
      var hr = new Date(s.startTime).getHours();
      values[hr] += nMs(s.durationMs);
    });
  } else if (range === 'week') {
    for (i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      labels.push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]);
      values.push(0);
      var key = d.toDateString();
      sessions.forEach(function(s) {
        var sd = new Date(s.startTime);
        sd.setHours(0, 0, 0, 0);
        if (sd.toDateString() === key) values[values.length - 1] += nMs(s.durationMs);
      });
    }
  } else if (range === 'month') {
    for (j = 29; j >= 0; j--) {
      var d2 = new Date(now);
      d2.setHours(0, 0, 0, 0);
      d2.setDate(d2.getDate() - j);
      labels.push(String(d2.getDate()));
      values.push(0);
      var key2 = d2.toDateString();
      sessions.forEach(function(s) {
        var sd2 = new Date(s.startTime);
        sd2.setHours(0, 0, 0, 0);
        if (sd2.toDateString() === key2) values[values.length - 1] += nMs(s.durationMs);
      });
    }
  } else {
    for (j = 11; j >= 0; j--) {
      var dm = new Date(now.getFullYear(), now.getMonth() - j, 1);
      labels.push(dm.toLocaleString('en', { month: 'short' }));
      values.push(0);
      var y = dm.getFullYear();
      var mo = dm.getMonth();
      sessions.forEach(function(s) {
        var ds = new Date(s.startTime);
        if (ds.getFullYear() === y && ds.getMonth() === mo) values[values.length - 1] += nMs(s.durationMs);
      });
    }
  }
  var total = values.reduce(function(a, b) { return a + b; }, 0);
  return { labels: labels, values: values, totalMs: total };
}

function compareYesterday(sessions) {
  var now = new Date();
  var t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  var t1 = new Date(t0);
  t1.setDate(t1.getDate() + 1);
  var y0 = new Date(t0);
  y0.setDate(y0.getDate() - 1);
  function sumRange(start, end) {
    return sessions.reduce(function(a, s) {
      if (s.startTime >= start && s.startTime < end) return a + nMs(s.durationMs);
      return a;
    }, 0);
  }
  var todayMs = sumRange(t0.getTime(), t1.getTime());
  var yMs = sumRange(y0.getTime(), t0.getTime());
  var pct = yMs === 0 ? (todayMs > 0 ? 100 : 0) : Math.round(((todayMs - yMs) / yMs) * 100);
  return { todayMs: todayMs, yMs: yMs, pct: pct };
}

function buildDomainPie(sessions) {
  var weekAgo = Date.now() - 7 * 86400000;
  var map = {};
  sessions.forEach(function(s) {
    if (nMs(s.startTime) < weekAgo) return;
    var d = (s.enriched && s.enriched.domain) || inferDomainLocal((s.title || '') + ' ' + (s.url || ''));
    map[d] = (map[d] || 0) + nMs(s.durationMs);
  });
  return Object.entries(map).sort(function(a, b) { return b[1] - a[1]; });
}

function renderLineChart(labels, values) {
  var w = 340;
  var h = 120;
  var padL = 28;
  var padR = 8;
  var padT = 8;
  var padB = 18;
  var innerW = w - padL - padR;
  var innerH = h - padT - padB;
  var max = Math.max(1, values.reduce(function(a, b) { return Math.max(a, b); }, 0));
  var n = values.length;
  var pts = [];
  var i;
  for (i = 0; i < n; i++) {
    var x = padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    var y = padT + innerH - (values[i] / max) * innerH;
    pts.push({ x: x, y: y });
  }
  var lineD = pts.map(function(p, idx) { return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
  var areaD = lineD + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (padT + innerH) + ' L' + pts[0].x.toFixed(1) + ' ' + (padT + innerH) + ' Z';

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">';
  svg += '<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8b7cf8" stop-opacity="0.35"/><stop offset="100%" stop-color="#8b7cf8" stop-opacity="0"/></linearGradient></defs>';
  svg += '<path d="' + areaD + '" fill="url(#lg)"/>';
  svg += '<path d="' + lineD + '" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  for (i = 0; i < pts.length; i++) {
    svg += '<circle cx="' + pts[i].x + '" cy="' + pts[i].y + '" r="3" fill="#3ecf8e" stroke="#0e0f12" stroke-width="1"/>';
  }
  svg += '<text x="' + padL + '" y="' + (h - 4) + '" fill="#7c7e8a" font-size="8">' + fmtShortDur(max) + '</text>';
  svg += '</svg>';
  return svg;
}

function renderPieChart(entries) {
  var w = 340;
  var h = 120;
  if (!entries.length) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '"><text x="170" y="60" text-anchor="middle" fill="#7c7e8a" font-size="11">No data this week</text></svg>';
  }
  var total = entries.reduce(function(a, e) { return a + e[1]; }, 0);
  var cx = 70;
  var cy = 60;
  var r = 48;
  var colors = ['#8b7cf8', '#3ecf8e', '#f5a623', '#e85d5d', '#5ec4ff', '#ff8fab'];
  var start = -Math.PI / 2;
  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  entries.slice(0, 6).forEach(function(e, idx) {
    var angle = (e[1] / total) * 2 * Math.PI;
    var x1 = cx + r * Math.cos(start);
    var y1 = cy + r * Math.sin(start);
    start += angle;
    var x2 = cx + r * Math.cos(start);
    var y2 = cy + r * Math.sin(start);
    var large = angle > Math.PI ? 1 : 0;
    svg += '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' + colors[idx % colors.length] + '" stroke="#0e0f12" stroke-width="1"/>';
  });
  var ly = 28;
  entries.slice(0, 5).forEach(function(e, idx) {
    var pct = Math.round((e[1] / total) * 100);
    svg += '<rect x="138" y="' + (ly - 6) + '" width="8" height="8" rx="2" fill="' + colors[idx % colors.length] + '"/>';
    var label = e[0].length > 22 ? e[0].slice(0, 20) + '…' : e[0];
    svg += '<text x="152" y="' + ly + '" fill="#eeedf0" font-size="10">' + label + ' · ' + pct + '%</text>';
    ly += 16;
  });
  svg += '</svg>';
  return svg;
}

function updateChart() {
  var wrap = document.getElementById('chart-svg-wrap');
  var periodEl = document.getElementById('chart-period-total');
  var deltaEl = document.getElementById('chart-delta');
  if (!wrap || !periodEl || !deltaEl) return;

  var series = buildSeries(lastSessionsFull, chartRange);
  periodEl.textContent = fmtShortDur(series.totalMs);

  var cmp = compareYesterday(lastSessionsFull);
  if (chartRange === 'day') {
    var arrow = cmp.pct >= 0 ? '↑' : '↓';
    deltaEl.textContent = arrow + ' ' + Math.abs(cmp.pct) + '% from yesterday';
  } else {
    deltaEl.textContent = '—';
  }

  if (chartMode === 'pie') {
    var pie = lastDomainPieWeek.length ? lastDomainPieWeek : buildDomainPie(lastSessionsFull);
    wrap.innerHTML = renderPieChart(pie);
  } else {
    wrap.innerHTML = renderLineChart(series.labels, series.values);
  }
}

function renderSessions(sessions) {
  var el = document.getElementById('sessions-list');
  if (!el) return;
  if (!sessions || !sessions.length) {
    el.innerHTML = '<div class="empty-sessions"><div class="empty-svg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div>Play a video to start tracking.</div>';
    return;
  }
  el.innerHTML = sessions.slice(0, 20).map(function(s) {
    var e = s.enriched || {};
    var concept = e.concept || s.title || 'Unknown';
    var domain = e.domain || '';
    var dotCls = s.synced ? 'synced' : (s.enriched ? 'pending' : 'enriching');
    var syncBtn;
    if (!s.enriched) {
      syncBtn =
        '<div class="sess-sync-wrap"><button type="button" class="sess-sync-btn" disabled data-session-id="' +
        escAttr(s.id) + '" title="Wait for AI enrichment before syncing">' + SESS_SYNC_ARROW + '</button></div>';
    } else if (s.synced) {
      syncBtn =
        '<div class="sess-sync-wrap"><button type="button" class="sess-sync-btn synced" data-session-id="' +
        escAttr(s.id) + '" data-synced="1" title="Synced to form — click to re-sync">' + SESS_SYNC_CHECK + '</button></div>';
    } else {
      syncBtn =
        '<div class="sess-sync-wrap"><button type="button" class="sess-sync-btn" data-session-id="' +
        escAttr(s.id) + '" data-synced="0" title="Send this session to your Google Form">' + SESS_SYNC_ARROW + '</button></div>';
    }
    var dur = s.durationMs ? fmtHours(s.durationMs) : '';
    var pages = Array.isArray(s.exploredPages) ? s.exploredPages : [];
    var np = pages.length;
    var exploreMeta = '';
    if (np > 1) {
      var tip = pages.slice(0, 15).map(function(p, i) {
        return (i + 1) + '. ' + String(p.title || 'Page').slice(0, 55);
      }).join(' · ');
      exploreMeta =
        '<span class="sdomain" title="' + escHtml(tip).replace(/"/g, '&quot;') + '">' + np + ' pages</span>';
    } else if (s.manualReading) {
      exploreMeta = '<span class="sdomain" title="Tracked with Track this page">Reading</span>';
    }
    return '<div class="session-row">' +
      '<div class="sdot ' + dotCls + '"></div>' +
      SESS_ICO +
      '<div class="sinfo">' +
        '<div class="sconcept" title="' + concept.replace(/"/g, '&quot;') + '">' + concept + '</div>' +
        '<div class="smeta">' +
          (domain ? '<span class="sdomain" title="' + domain.replace(/"/g, '&quot;') + '">' + domain + '</span>' : '') +
          exploreMeta +
          (dur ? '<span title="Watch time">' + dur + '</span>' : '') +
          '<span title="' + (fmtAbsStart(s.startTime) || 'When recorded') + '">' + timeAgo(s.startTime) +
          (fmtAbsStart(s.startTime) ? ' · ' + fmtAbsStart(s.startTime) : '') + '</span>' +
        '</div>' +
      '</div>' +
      syncBtn +
    '</div>';
  }).join('');
}

function domainPairs30d(data) {
  var pairs = (data.domainPieMonth && data.domainPieMonth.length) ? data.domainPieMonth : [];
  if (!pairs.length && lastSessionsFull.length) {
    var cutoff = Date.now() - 30 * 86400000;
    var map = {};
    lastSessionsFull.forEach(function(s) {
      if (nMs(s.startTime) < cutoff) return;
      var d = (s.enriched && s.enriched.domain) || inferDomainLocal((s.title || '') + ' ' + (s.url || ''));
      map[d] = (map[d] || 0) + nMs(s.durationMs);
    });
    pairs = Object.keys(map).map(function(k) { return [k, map[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  }
  return pairs;
}

function renderInsightsDashboard(data) {
  var root = document.getElementById('insights-dashboard');
  if (!root) return;

  var targetH = Number(data.learningTargetHours) || 40;
  if (targetH <= 0) targetH = 40;
  var totalMs = nMs(data.totalLearnedMs);
  var extMs = nMs(data.extensionRecordedMs);
  var baseMs = nMs(data.learnedBaselineMs);
  var targetMs = targetH * 3600000;
  var pct = Math.min(100, Math.round((totalMs / targetMs) * 100));
  var yp = data.yearProgressPct != null ? data.yearProgressPct : yearProgressPctLocal();
  var learnedH = totalMs / 3600000;
  var rank = learnerRank(learnedH);
  var wk = compareLastTwoWeeks(lastSessionsFull);
  var weekCls = wk.pct > 0 ? 'up' : (wk.pct < 0 ? 'down' : 'flat');
  var weekArrow = wk.pct > 0 ? '↑' : (wk.pct < 0 ? '↓' : '→');
  var onGood = isOnTrackGood(totalMs, targetH, yp);
  var onText = onTrackLine(totalMs, targetH, yp);
  var onCls = onGood ? 'good' : 'warn';

  var pairs = domainPairs30d(data);
  var totalD = pairs.reduce(function(a, p) { return a + p[1]; }, 0) || 1;
  var barColors = ['#8b7cf8', '#3ecf8e', '#f5a623', '#e85d5d', '#5ec4ff', '#ff8fab'];
  var barsHtml = '';
  if (pairs.length) {
    barsHtml = pairs.slice(0, 5).map(function(p, idx) {
      var pctBar = Math.max(2, Math.round((p[1] / totalD) * 100));
      var name = p[0].length > 36 ? p[0].slice(0, 34) + '…' : p[0];
      return '<div class="ins-bar-row">' +
        '<div class="ins-bar-top"><span class="ins-bar-name">' + escHtml(name) + '</span>' +
        '<span class="ins-bar-pct">' + fmtHours(p[1]) + ' · ' + pctBar + '%</span></div>' +
        '<div class="ins-bar-track"><div class="ins-bar-fill" style="width:' + pctBar + '%;background:' +
        barColors[idx % barColors.length] + '"></div></div></div>';
    }).join('');
  } else {
    barsHtml = '<div class="total-meta" style="margin:0">No domain data in the last 30 days yet.</div>';
  }

  var longest = computeLongestSession(lastSessionsFull);
  var topDomain = pairs.length ? pairs[0] : null;
  var recLong = longest
    ? '<div class="ins-record"><span class="ir-ico">1</span><div class="ir-body"><div class="ir-title">Longest session</div>' +
      '<div class="ir-val">' + fmtHours(longest.durationMs) + ' · ' + escHtml(longest.title.length > 42 ? longest.title.slice(0, 40) + '…' : longest.title) + '</div></div></div>'
    : '<div class="ins-record"><span class="ir-ico">—</span><div class="ir-body"><div class="ir-title">Longest session</div>' +
      '<div class="ir-val">Finish a session to see your personal best.</div></div></div>';

  var recDom = topDomain
    ? '<div class="ins-record"><span class="ir-ico">★</span><div class="ir-body"><div class="ir-title">Top domain (30d)</div>' +
      '<div class="ir-val">' + escHtml(topDomain[0].length > 44 ? topDomain[0].slice(0, 42) + '…' : topDomain[0]) +
      ' · ' + fmtHours(topDomain[1]) + '</div></div></div>'
    : '<div class="ins-record"><span class="ir-ico">★</span><div class="ir-body"><div class="ir-title">Top domain (30d)</div>' +
      '<div class="ir-val">Track a few sessions to see your focus area.</div></div></div>';

  var recWk =
    '<div class="ins-record"><span class="ir-ico">7</span><div class="ir-body"><div class="ir-title">This week vs prior week</div>' +
    '<div class="ir-val">' + weekArrow + ' ' + Math.abs(wk.pct) + '% · ' + fmtHours(wk.curMs) + ' this week' +
    (wk.prevMs > 0 ? ' vs ' + fmtHours(wk.prevMs) + ' before' : '') + '</div></div></div>';

  root.innerHTML =
    '<div class="ins-hero">' +
    '<svg class="squiggle" viewBox="0 0 120 80" fill="none" aria-hidden="true"><path d="M8 65 C 35 20, 55 75, 85 35 S 105 15, 112 8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' +
    '<div class="ins-hero-top"><div><div class="ins-hero-label">Total learned</div>' +
    '<div class="hero-num" style="font-size:26px;margin:4px 0 0">' + escHtml(fmtTotalLong(totalMs)) + '</div></div>' +
    '<div class="ins-rank-badge" title="Fun rank based on total hours">' + escHtml(rank.title) + '</div></div>' +
    '<div class="total-meta" style="margin:0 0 6px">' + escHtml(rank.blurb) + '</div>' +
    '<div class="ins-week-pill ' + weekCls + '">' + weekArrow + ' ' + Math.abs(wk.pct) + '% vs last week</div>' +
    '<div class="ins-subgrid"><div>Goal<span><strong>' + targetH + 'h</strong></span></div>' +
    '<div>Year progress<span><strong>' + yp + '%</strong> of calendar year</span></div>' +
    '<div>Baseline<span><strong>' + fmtHours(baseMs) + '</strong> before extension</span></div>' +
    '<div>From extension<span><strong>' + fmtHours(extMs) + '</strong> tracked here</span></div></div></div>' +

    '<div class="ins-card"><h3>Progress to target</h3>' +
    '<div class="ins-bar-top" style="margin-bottom:6px"><span class="ins-bar-name">' + pct + '% complete</span>' +
    '<span class="ins-bar-pct">' + fmtHours(totalMs) + ' / ' + targetH + 'h</span></div>' +
    '<div class="ins-bar-track" style="height:10px"><div class="ins-bar-fill" style="width:' + pct +
    '%;background:linear-gradient(90deg,#8b7cf8,#3ecf8e)"></div></div>' +
    '<div class="settings-hint" style="margin-top:8px">Edit target in <a href="#" class="ins-open-settings">Settings</a>.</div></div>' +

    '<div class="ins-card"><h3>Domain balance · last 30 days</h3>' + barsHtml + '</div>' +

    '<div class="ins-ontrack ' + onCls + '"><strong style="display:block;margin-bottom:4px;font-size:10px;opacity:.85;letter-spacing:.06em">' +
    (onGood ? 'ON TRACK' : 'PACE CHECK') + '</strong>' + escHtml(onText) + '</div>' +

    '<div class="ins-card"><h3>Your records</h3><div class="ins-records">' + recLong + recDom + recWk + '</div></div>';

  var a = root.querySelector('.ins-open-settings');
  if (a) {
    a.addEventListener('click', function(ev) {
      ev.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

function renderInsights(insights) {
  var el = document.getElementById('insights-list');
  if (!el) return;
  if (!insights || !insights.length) {
    el.innerHTML = '<div id="insights-placeholder">Enriched sessions unlock short AI tips below. Your stats above use all tracked time.</div>';
    return;
  }
  el.innerHTML = insights.map(function(ins) {
    var svg = INSIGHT_SVG[ins.type] || INSIGHT_SVG.suggestion;
    return '<div class="insight">' +
      '<span class="insight-ico">' + svg + '</span>' +
      '<span>' + escHtml(ins.text || '') + '</span>' +
    '</div>';
  }).join('');
}

function setSyncButton(count) {
  var btn = document.getElementById('btn-sync');
  var badge = document.getElementById('sync-badge');
  if (!btn) return;
  var span = btn.querySelector('span');
  if (count > 0) {
    btn.disabled = false;
    btn.classList.remove('busy');
    if (span) span.textContent = '⟳ Sync Learning';
    if (badge) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    }
  } else {
    btn.disabled = true;
    btn.classList.remove('busy');
    if (span) span.textContent = 'All synced ✓';
    if (badge) badge.style.display = 'none';
  }
}

function resetTrackingBarIdle() {
  var bar = document.getElementById('tracking-bar');
  if (bar) bar.classList.remove('active');
  var rec = document.getElementById('rec-label');
  if (rec) rec.style.display = 'none';
  var title = document.getElementById('tracking-title');
  if (title) title.textContent = 'Open a video tab to track';
  var timerEl = document.getElementById('live-timer');
  if (timerEl) {
    timerEl.textContent = '—';
    timerEl.classList.add('idle');
  }
  var pulse = document.getElementById('tracking-pulse');
  if (pulse) {
    pulse.className = 'tracking-pulse';
    pulse.classList.remove('recording', 'paused');
  }
  var statusDot = document.getElementById('status-dot');
  if (statusDot) {
    statusDot.classList.add('inactive');
    statusDot.title = 'Idle — open a page with video or use Track this page';
    statusDot.setAttribute('aria-label', 'Not tracking');
  }
}

function updateTrackingBarFromStatus(resp) {
  var bar = document.getElementById('tracking-bar');
  var dot = document.getElementById('status-dot');
  var pulse = document.getElementById('tracking-pulse');
  var recLabel = document.getElementById('rec-label');
  var recText = document.getElementById('rec-text');
  var timerEl = document.getElementById('live-timer');
  var titleEl = document.getElementById('tracking-title');

  if (!resp || (!resp.sessionActive && !resp.playing)) {
    resetTrackingBarIdle();
    return;
  }

  if (bar) bar.classList.add('active');
  if (dot) {
    dot.classList.remove('inactive');
    if (resp.playing) {
      dot.title = 'Recording watch time on this tab';
      dot.setAttribute('aria-label', 'Recording');
    } else {
      dot.title = 'Session open — playback paused';
      dot.setAttribute('aria-label', 'Paused');
    }
  }

  if (recLabel) recLabel.style.display = 'flex';
  if (resp.playing) {
    if (recLabel) recLabel.className = 'rec-label';
    if (recText) recText.textContent = 'RECORDING';
    if (pulse) pulse.className = 'tracking-pulse recording';
  } else {
    if (recLabel) recLabel.className = 'rec-label paused';
    if (recText) recText.textContent = 'PAUSED';
    if (pulse) pulse.className = 'tracking-pulse paused';
  }

  if (titleEl) {
    var t = resp.title || 'Learning…';
    if (resp.manualReading && resp.pagesExplored > 1) {
      t += ' · ' + resp.pagesExplored + ' pages';
    }
    titleEl.textContent = t;
  }
  if (timerEl) {
    timerEl.textContent = fmtLive(resp.elapsedMs || 0);
    timerEl.classList.remove('idle');
  }
}

function setTrackingIdleVisible(show) {
  var el = document.getElementById('tracking-idle');
  if (!el) return;
  el.classList.toggle('visible', !!show);
}

function refreshLiveBar() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) {
      resetTrackingBarIdle();
      setTrackingIdleVisible(false);
      return;
    }
    var u = tabs[0].url || '';
    if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('about:') || u.startsWith('devtools://')) {
      resetTrackingBarIdle();
      setTrackingIdleVisible(false);
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'LT_GET_STATUS' }, { frameId: 0 }, function(resp) {
      if (chrome.runtime.lastError) {
        resetTrackingBarIdle();
        setTrackingIdleVisible(false);
        var sdErr = document.getElementById('status-dot');
        if (sdErr) {
          sdErr.classList.add('inactive');
          sdErr.title = 'Idle — this tab does not report tracking (reload the page or open a normal site)';
          sdErr.setAttribute('aria-label', 'Not tracking');
        }
        return;
      }
      updateTrackingBarFromStatus(resp);
      var idleShow = resp && !resp.sessionActive && resp.hasVideo === false;
      setTrackingIdleVisible(!!idleShow);
    });
  });
}

function startLiveTick() {
  if (liveTick) return;
  liveTick = setInterval(refreshLiveBar, 750);
}

function stopLiveTick() {
  if (liveTick) {
    clearInterval(liveTick);
    liveTick = null;
  }
}

function checkKey(callback) {
  chrome.storage.local.get(['lt_groq_key'], function(r) {
    var hasKey = !!r.lt_groq_key;
    var ban = document.getElementById('no-key-banner');
    if (ban) ban.style.display = hasKey ? 'none' : 'block';
    if (callback) callback(hasKey);
  });
}

function applyLearningTotals(data) {
  var totalEl = document.getElementById('total-learned-display');
  var pctEl = document.getElementById('progress-pct');
  var fillEl = document.getElementById('progress-fill');
  var meta = document.getElementById('total-meta-start');
  var encEl = document.getElementById('total-encourage');
  if (!totalEl || !pctEl || !fillEl || !meta) return;

  var total = nMs(data.totalLearnedMs);
  var targetH = Number(data.learningTargetHours);
  if (isNaN(targetH) || targetH <= 0) targetH = 40;
  var targetMs = targetH * 3600000;
  var pct = Math.min(100, Math.round((total / targetMs) * 100));

  totalEl.textContent = fmtTotalLong(total);
  pctEl.textContent = pct + '%';
  fillEl.style.width = pct + '%';

  if (encEl) {
    var line = encouragementText(total, pct, data.streak && data.streak.current);
    encEl.textContent = line || '';
    encEl.style.display = line ? 'block' : 'none';
  }

  if (data.firstSessionStart) {
    meta.textContent = 'Tracking since ' + new Date(nMs(data.firstSessionStart)).toLocaleDateString() +
      ' · Extension ' + fmtTotalLong(data.extensionRecordedMs) + ' + baseline ' + fmtTotalLong(data.learnedBaselineMs) + '.';
  } else {
    meta.textContent = 'Add a baseline in Settings if you studied before this extension; new sessions add automatically.';
  }
}

function setActiveTab(name) {
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    var on = b.getAttribute('data-tab') === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
}

function load() {
  checkKey();
  stopLiveTick();
  startLiveTick();
  refreshLiveBar();

  msg('LT_GET_DATA').then(function(data) {
    if (!data.ok) return;

    lastSessionsFull = (data.allSessions && data.allSessions.length)
      ? data.allSessions
      : (data.sessions || []);
    lastDomainPieWeek = data.domainPieWeek || [];
    lastInsightSnapshot = data;

    var todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    var todaySessions = (data.sessions || []).filter(function(s) {
      return nMs(s.startTime) >= todayStart.getTime();
    });
    var todayMs = todaySessions.reduce(function(a, s) { return a + nMs(s.durationMs); }, 0);
    document.getElementById('s-hrs').textContent = fmtHours(todayMs) || '0.0';
    document.getElementById('s-sess').textContent = String(todaySessions.length);
    document.getElementById('s-streak').textContent = (data.streak && data.streak.current) || 0;

    applyLearningTotals(data);
    updateChart();
    renderSessions(data.sessions || []);
    renderInsightsDashboard(data);
    renderInsights(data.insights || []);
    setSyncButton(data.unsyncedCount || 0);
  });
}

document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    setActiveTab(btn.getAttribute('data-tab'));
  });
});

document.getElementById('chart-range-btns').addEventListener('click', function(ev) {
  var t = ev.target.closest('.range-btn');
  if (!t) return;
  chartRange = t.getAttribute('data-range');
  document.querySelectorAll('.range-btn').forEach(function(b) {
    b.classList.toggle('active', b === t);
  });
  updateChart();
});

document.querySelectorAll('.mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    chartMode = btn.getAttribute('data-mode');
    document.querySelectorAll('.mode-btn').forEach(function(b) {
      b.classList.toggle('active', b === btn);
    });
    updateChart();
  });
});

document.getElementById('btn-refresh').addEventListener('click', load);

document.getElementById('btn-settings').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

document.getElementById('link-settings').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

var linkGoals = document.getElementById('link-learning-goals');
if (linkGoals) {
  linkGoals.addEventListener('click', function(ev) {
    ev.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

document.getElementById('btn-insights').addEventListener('click', function() {
  var btn = this;
  btn.textContent = '…';
  btn.disabled = true;
  msg('LT_REFRESH_INSIGHTS')
    .then(function(r) {
      if (r.insights) renderInsights(r.insights);
    })
    .then(function() {
      btn.textContent = 'Refresh AI';
      btn.disabled = false;
    })
    .catch(function() {
      btn.textContent = 'Refresh AI';
      btn.disabled = false;
    });
});

document.getElementById('btn-sync').addEventListener('click', function() {
  var btn = this;
  btn.disabled = true;
  btn.classList.add('busy');
  var span0 = btn.querySelector('span');
  if (span0) span0.textContent = 'Syncing one at a time…';
  var sb = document.getElementById('sync-badge');
  if (sb) sb.style.display = 'none';

  chrome.storage.local.get(['lt_auto_submit'], function(r) {
    msg('LT_SYNC_ALL', { autoSubmit: !!r.lt_auto_submit }).then(function(result) {
      var sp = btn.querySelector('span');
      var tot = result.total != null ? result.total : 0;
      var done = result.synced != null ? result.synced : 0;
      if (result.reason === 'no_form_url') {
        if (sp) sp.textContent = 'Set Form URL first!';
        btn.classList.remove('busy');
        btn.disabled = false;
        setTimeout(function() { chrome.runtime.openOptionsPage(); }, 1000);
        return;
      }
      if (result.ok && tot >= 0) {
        if (sp) sp.textContent = 'Synced ' + done + '/' + (tot || done) + ' ✓';
        setTimeout(load, 1200);
        return;
      }
      if (done > 0) {
        if (sp) sp.textContent = 'Stopped at ' + done + '/' + tot + (result.reason ? ' (' + result.reason + ')' : '');
        btn.classList.remove('busy');
        btn.disabled = false;
        setTimeout(load, 1200);
        return;
      }
      if (sp) sp.textContent = 'Error — retry' + (result.reason ? ' (' + result.reason + ')' : '');
      btn.classList.remove('busy');
      btn.disabled = false;
    });
  });
});

var singleSessionSyncBusy = false;
document.getElementById('sessions-list').addEventListener('click', function(ev) {
  var syncB = ev.target.closest('.sess-sync-btn');
  if (!syncB || syncB.disabled || singleSessionSyncBusy) return;
  var sid = syncB.getAttribute('data-session-id');
  if (!sid) return;
  var isResync = syncB.getAttribute('data-synced') === '1';
  singleSessionSyncBusy = true;
  syncB.classList.add('busy');
  chrome.storage.local.get(['lt_auto_submit'], function(r) {
    msg('LT_SYNC_SESSION', {
      sessionId: sid,
      autoSubmit: !!r.lt_auto_submit,
      forceResync: isResync
    }).then(function(res) {
      singleSessionSyncBusy = false;
      syncB.classList.remove('busy');
      load();
      if (res && res.reason === 'no_form_url') chrome.runtime.openOptionsPage();
    }).catch(function() {
      singleSessionSyncBusy = false;
      syncB.classList.remove('busy');
    });
  });
});

document.getElementById('btn-complete').addEventListener('click', function() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'LT_SESSION_COMPLETE' }, { frameId: 0 }, function(resp) {
      if (chrome.runtime.lastError) return;
      refreshLiveBar();
      load();
    });
  });
});

function sendStartManualRead() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'LT_START_MANUAL_READ' }, { frameId: 0 }, function(r) {
      if (chrome.runtime.lastError) {
        alert('Open a normal web page (not chrome://) and reload the tab if tracking never started.');
        return;
      }
      setTimeout(function() {
        refreshLiveBar();
        load();
      }, 200);
    });
  });
}

document.getElementById('btn-track-page-idle').addEventListener('click', sendStartManualRead);

chrome.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName !== 'local' || !changes.lt_sessions) return;
  load();
});

load();
