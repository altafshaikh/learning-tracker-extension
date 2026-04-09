// utils/groq.js — Groq API (OpenAI-compatible)

const BASE = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export const DOMAINS = [
  'Business/Leadership',
  'Technology and Development Practices',
  'Communication Skills',
  'Mandatory Compliance Training',
  'Interpersonal Skills'
];

async function chat(apiKey, model, messages, jsonMode) {
  var body = {
    model: model || DEFAULT_MODEL,
    messages: messages,
    max_tokens: 512,
    temperature: 0.1
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  var res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    var err = await res.json().catch(function() { return {}; });
    throw new Error('Groq ' + res.status + ': ' + (err.error && err.error.message || res.statusText));
  }

  var data = await res.json();
  return data.choices[0].message.content;
}

export async function testKey(apiKey) {
  try {
    await chat(apiKey, DEFAULT_MODEL, [{ role: 'user', content: 'Say OK' }], false);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

/** Trim, collapse spaces, lowercase; normalize & → and for model quirks. */
function normalizeDomainLabel(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' and ')
    .toLowerCase();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  var la = a.length;
  var lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  var i;
  var j;
  var prev = new Array(lb + 1);
  var cur = new Array(lb + 1);
  for (j = 0; j <= lb; j++) prev[j] = j;
  for (i = 1; i <= la; i++) {
    cur[0] = i;
    for (j = 1; j <= lb; j++) {
      var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    var t = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

/**
 * Map model output to a canonical allowlist entry (exact / near-exact / substring).
 */
export function resolveAllowlistDomain(raw, allowlist) {
  if (!allowlist || !allowlist.length) return null;
  var n = normalizeDomainLabel(raw);
  if (!n || n === 'null') return null;
  var i;
  var best = null;
  var bestLen = 0;
  for (i = 0; i < allowlist.length; i++) {
    var a = String(allowlist[i]);
    var na = normalizeDomainLabel(a);
    if (!na) continue;
    if (na === n) return allowlist[i];
    var maxL = Math.max(na.length, n.length);
    if (maxL >= 12) {
      var dist = levenshtein(n, na);
      if (dist <= 2 || 1 - dist / maxL >= 0.92) return allowlist[i];
    }
    if (na.length >= 14) {
      var subOk =
        n.indexOf(na) !== -1 ||
        (n.length >= 12 && na.indexOf(n) === 0);
      if (subOk && na.length > bestLen) {
        bestLen = na.length;
        best = allowlist[i];
      }
    }
  }
  return best;
}

function parseGroqJsonObject(raw) {
  var t = String(raw || '').trim();
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  var start = t.indexOf('{');
  var end = t.lastIndexOf('}');
  if (start !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/**
 * Full label set for Groq: always all DOMAINS, plus any custom lines from the user's allowlist
 * (so we can classify as e.g. Technology even when that checkbox is off).
 */
export function buildClassificationCatalog(allowlist) {
  var normSeen = Object.create(null);
  var catalog = [];
  var i;
  for (i = 0; i < DOMAINS.length; i++) {
    var d0 = DOMAINS[i];
    var n0 = normalizeDomainLabel(d0);
    if (n0 && !normSeen[n0]) {
      normSeen[n0] = true;
      catalog.push(d0);
    }
  }
  (allowlist || []).forEach(function (line) {
    var s = String(line || '').trim();
    if (!s) return;
    var n = normalizeDomainLabel(s);
    if (n && !normSeen[n]) {
      normSeen[n] = true;
      catalog.push(s);
    }
  });
  return catalog;
}

function formatExploredPages(session) {
  var pages = session.exploredPages;
  if (!Array.isArray(pages) || pages.length < 2) return '';
  var lines = pages.slice(0, 25).map(function(p, i) {
    var t = (p && p.title) ? String(p.title).slice(0, 120) : '';
    var u = (p && p.url) ? String(p.url).slice(0, 200) : '';
    return (i + 1) + '. ' + t + (u ? ' — ' + u : '');
  });
  return '\nSame-tab reading session — pages explored in order:\n' + lines.join('\n') + '\n';
}

function parseOptionalCatalogLine(raw, catalog) {
  if (raw == null || raw === '' || String(raw).toLowerCase() === 'null') return null;
  return resolveAllowlistDomain(String(raw).trim(), catalog);
}

/**
 * Classify video title into one catalog domain; recording is allowed only if that domain is in allowlist.
 * Groq returns JSON: { "domain": "<exact catalog line>" | null, "predicted_domain": "<exact line>" | null }.
 * predicted_domain = best topic fit when domain is null (borderline / not strict learning), for user override.
 */
export async function classifyTrackAllowlist(apiKey, title, url, model, allowlist) {
  if (!allowlist || !allowlist.length) {
    return {
      track: false,
      domain: null,
      classifiedDomain: null,
      blockedByAllowlist: false,
      notLearning: false,
      predictedDomain: null,
      predictedAlreadyAllowed: false
    };
  }
  var catalog = buildClassificationCatalog(allowlist);
  if (!catalog.length) {
    return {
      track: false,
      domain: null,
      classifiedDomain: null,
      blockedByAllowlist: false,
      notLearning: false,
      predictedDomain: null,
      predictedAlreadyAllowed: false
    };
  }

  var safeTitle = String(title || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 500);
  var lines = catalog.map(function (d, i) {
    return String(i + 1) + '. ' + String(d);
  }).join('\n');
  var allowedLines = allowlist
    .map(function (d) {
      return String(d).trim();
    })
    .filter(Boolean)
    .map(function (d) {
      return '- ' + d;
    })
    .join('\n');

  var prompt =
    'You decide if a video title is intentional professional/workplace learning and which single domain fits.\n\n' +
    'Video title: "' +
    safeTitle +
    '"\n\n' +
    'Learning domain labels (pick at most ONE line below by copying it exactly, or null if not learning):\n' +
    lines +
    '\n\nDomains currently allowed for recording in the user\'s settings:\n' +
    allowedLines +
    '\n\nReturn ONLY valid JSON, no other text:\n' +
    '{"domain": "<exact string from the numbered list above>" | null}\n\n' +
    'Rules:\n' +
    '- "domain" must be an exact copy of one numbered line, or null.\n' +
    '- Use null for news, entertainment, gaming, music, sports, gossip, or non-learning content.\n' +
    '- Tutorials, courses, tech talks, coding, AI/agents, APIs, DevOps, compliance, leadership, communication → pick the matching line.\n' +
    '- Ignore whether the domain is in the allowed list when choosing "domain"; the extension applies that separately.';

  try {
    var raw = await chat(apiKey, model, [{ role: 'user', content: prompt }], true);
    var parsed = parseGroqJsonObject(raw);
    var d = parsed.domain;
    if (d == null || d === '' || String(d).toLowerCase() === 'null') {
      return {
        track: false,
        domain: null,
        classifiedDomain: null,
        blockedByAllowlist: false,
        notLearning: true
      };
    }
    var resolved = resolveAllowlistDomain(String(d).trim(), catalog);
    if (!resolved) {
      return {
        track: false,
        domain: null,
        classifiedDomain: null,
        blockedByAllowlist: false,
        notLearning: true
      };
    }
    var allowedCanonical = resolveAllowlistDomain(resolved, allowlist);
    var track = !!allowedCanonical;
    return {
      track: track,
      domain: allowedCanonical || null,
      classifiedDomain: resolved,
      blockedByAllowlist: !!resolved && !track,
      notLearning: false
    };
  } catch (e) {
    console.error('[Groq] classifyTrackAllowlist failed:', e.message);
    return {
      track: true,
      domain: null,
      classifiedDomain: null,
      blockedByAllowlist: false,
      notLearning: false,
      classifyErrorFallback: true
    };
  }
}

export async function enrichSession(apiKey, session, model, allowedDomainsForEnrich) {
  var domainList =
    Array.isArray(allowedDomainsForEnrich) && allowedDomainsForEnrich.length
      ? allowedDomainsForEnrich
      : DOMAINS;
  var explored = formatExploredPages(session);
  var prompt = 'Extract learning metadata from this web session. Return ONLY valid JSON.\n\n' +
    'Title: "' + session.title + '"\n' +
    'URL: ' + session.url + '\n' +
    'Duration: ' + Math.round((session.durationMs || 0) / 60000) + ' minutes\n' +
    explored + '\n' +
    'Return JSON with exactly these keys:\n' +
    '{\n' +
    '  "concept": "specific topic (e.g. React Hooks, AWS S3, Agile Scrum)",\n' +
    '  "domain": "one of: ' + domainList.join(' | ') + '",\n' +
    '  "skillset": "2-4 word skill (e.g. Frontend Development, Cloud Architecture)",\n' +
    '  "hours": <decimal number>,\n' +
    '  "epicLink": "brief guess at related project/epic or empty string",\n' +
    '  "summary": "one sentence summary of what was learned"\n' +
    '}';

  try {
    var raw = await chat(apiKey, model, [{ role: 'user', content: prompt }], true);
    var parsed = parseGroqJsonObject(raw);

    // Validate domain against effective list
    if (!domainList.includes(parsed.domain)) {
      parsed.domain = inferDomain((session.title || '') + ' ' + (session.url || ''));
    }
    if (!domainList.includes(parsed.domain)) {
      parsed.domain = domainList[0];
    }
    // Ensure hours is a number
    if (!parsed.hours || isNaN(parsed.hours)) {
      parsed.hours = Math.round((session.durationMs || 0) / 36000) / 100;
    }

    return {
      concept: parsed.concept || session.title,
      domain: parsed.domain,
      skillset: parsed.skillset || '',
      hours: Math.round(parsed.hours * 100) / 100,
      epicLink: parsed.epicLink || '',
      summary: parsed.summary || ''
    };
  } catch(e) {
    console.error('[Groq] enrichSession failed:', e.message);
    return {
      concept: session.title,
      domain: inferDomain((session.title || '') + ' ' + (session.url || '')),
      skillset: '',
      hours: Math.round((session.durationMs || 0) / 36000) / 100,
      epicLink: '',
      summary: ''
    };
  }
}

/**
 * @param {object} [ctx] — targetHours, totalLearnedMs, domainSpreadText
 */
export async function generateInsights(apiKey, sessions, model, ctx) {
  ctx = ctx || {};
  var recent = sessions
    .filter(function(s) { return s.enriched; })
    .slice(-20)
    .map(function(s) {
      return '- ' + s.enriched.concept + ' (' + s.enriched.domain + ', ' +
             Math.round((s.durationMs || 0) / 60000) + 'min)';
    }).join('\n');

  if (!recent) return [];

  var targetH = ctx.targetHours != null ? Number(ctx.targetHours) : 40;
  if (isNaN(targetH) || targetH <= 0) targetH = 40;
  var totalH = (Number(ctx.totalLearnedMs) || 0) / 3600000;
  var spread = ctx.domainSpreadText || '(no domain split yet)';
  var yearProgress = ctx.yearProgressPct != null ? ctx.yearProgressPct : 0;

  var prompt = 'You are a personal learning coach. The learner has a TIME TARGET and TOTAL LEARNED (includes pre-extension baseline + all tracked sessions).\n\n' +
    'LEARNING TARGET: ' + targetH + ' hours (lifetime or annual goal — treat as primary goal).\n' +
    'TOTAL LEARNED SO FAR: ' + totalH.toFixed(2) + ' hours.\n' +
    'CALENDAR YEAR ELAPSED (approx): ' + yearProgress + '%.\n' +
    'DOMAIN TIME (last ~30 days, minutes per domain — use for balance advice):\n' + spread + '\n\n' +
    'Recent enriched sessions:\n' + recent + '\n\n' +
    'Return ONLY valid JSON with exactly 5 items in "insights". Each text max 14 words.\n' +
    'Include: (1) progress vs target, (2) domain spread / imbalance, (3) on-track vs pace needed, (4) one gap, (5) one actionable suggestion.\n' +
    'Types must be one of: progress, gap, suggestion, streak, domain, ontrack\n' +
    '{"insights":[' +
    '{"type":"progress","text":"..."},' +
    '{"type":"domain","text":"..."},' +
    '{"type":"ontrack","text":"..."},' +
    '{"type":"gap","text":"..."},' +
    '{"type":"suggestion","text":"..."}' +
    ']}';

  try {
    var raw = await chat(apiKey, model, [{ role: 'user', content: prompt }], true);
    return parseGroqJsonObject(raw).insights || [];
  } catch(e) {
    return [];
  }
}

export function inferDomain(text) {
  text = String(text || '').toLowerCase();
  if (
    /react|vue|angular|python|js|typescript|aws|docker|git|api|code|dev|cloud|sql|linux|agent|agents|llm|mcp|kubernetes|terraform|ci\/cd|\bai\b|machine learning|mlops/.test(
      text
    )
  )
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
