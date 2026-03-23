// utils/groq.js — Groq API (OpenAI-compatible)

const BASE = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const DOMAINS = [
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

export async function enrichSession(apiKey, session, model) {
  var prompt = 'Extract learning metadata from this web session. Return ONLY valid JSON.\n\n' +
    'Title: "' + session.title + '"\n' +
    'URL: ' + session.url + '\n' +
    'Duration: ' + Math.round((session.durationMs || 0) / 60000) + ' minutes\n\n' +
    'Return JSON with exactly these keys:\n' +
    '{\n' +
    '  "concept": "specific topic (e.g. React Hooks, AWS S3, Agile Scrum)",\n' +
    '  "domain": "one of: ' + DOMAINS.join(' | ') + '",\n' +
    '  "skillset": "2-4 word skill (e.g. Frontend Development, Cloud Architecture)",\n' +
    '  "hours": <decimal number>,\n' +
    '  "epicLink": "brief guess at related project/epic or empty string",\n' +
    '  "summary": "one sentence summary of what was learned"\n' +
    '}';

  try {
    var raw = await chat(apiKey, model, [{ role: 'user', content: prompt }], true);
    var parsed = JSON.parse(raw);

    // Validate domain
    if (!DOMAINS.includes(parsed.domain)) {
      parsed.domain = inferDomain(session.title + ' ' + session.url);
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
      domain: inferDomain(session.title + ' ' + session.url),
      skillset: '',
      hours: Math.round((session.durationMs || 0) / 36000) / 100,
      epicLink: '',
      summary: ''
    };
  }
}

export async function generateInsights(apiKey, sessions, model) {
  var recent = sessions
    .filter(function(s) { return s.enriched; })
    .slice(-20)
    .map(function(s) {
      return '- ' + s.enriched.concept + ' (' + s.enriched.domain + ', ' +
             Math.round((s.durationMs || 0) / 60000) + 'min)';
    }).join('\n');

  if (!recent) return [];

  var prompt = 'You are a personal learning coach. Give 3 sharp, specific insights.\n\n' +
    'Recent sessions:\n' + recent + '\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"insights":[' +
    '{"type":"progress|gap|suggestion|streak","text":"max 12 words"},' +
    '{"type":"progress|gap|suggestion|streak","text":"max 12 words"},' +
    '{"type":"progress|gap|suggestion|streak","text":"max 12 words"}' +
    ']}';

  try {
    var raw = await chat(apiKey, model, [{ role: 'user', content: prompt }], true);
    return JSON.parse(raw).insights || [];
  } catch(e) {
    return [];
  }
}

function inferDomain(text) {
  text = text.toLowerCase();
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
