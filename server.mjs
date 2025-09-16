// server.mjs — Lightweight StylistSync assistant and brand catalogue
//
// This server provides a minimal set of endpoints for the Hair Hub app.  It
// exposes the brand catalogue (/brands) and a calendar‑aware assistant
// endpoint (/assistant) capable of answering basic hair formula questions and
// synthesising create/delete actions for clients and appointments.  The
// implementation avoids external dependencies such as Express so that it
// runs in environments where `npm install` is not available.  If you need
// advanced Formula Guru features or photo analysis, you can extend this
// module or run your own server with those capabilities.

import http from 'http';
import { URL } from 'url';

// -------------------------------------------------------------------------
// Data: Brand catalogues and mixing rules.  Each entry maps a brand name
// (case‑sensitive) to its mixing ratio, recommended developer and any notes.
// These values mirror those used by the Swift client for offline replies.
const BRAND_RULES = {
  // Permanent
  'Redken Color Gels Lacquers': { ratio: '1:1', developer: 'Redken Pro‑oxide Cream Developer 10/20/30/40 vol', notes: 'Standard 1:1; 20 vol typical for grey coverage.' },
  'Wella Koleston Perfect': { ratio: '1:1', developer: 'Welloxon Perfect 3%/6%/9%/12%', notes: 'Core shades 1:1.' },
  'Wella Illumina Color': { ratio: '1:1', developer: 'Welloxon Perfect 3%/6%/9%', notes: 'Reflective permanent; 1:1 mix.' },
  'L’Oréal Professionnel Majirel': { ratio: '1:1.5', developer: 'L’Oréal Oxydant Creme', notes: 'Standard Majirel 1:1.5 (High Lift lines may be 1:2).' },
  'Matrix SoColor Permanent': { ratio: '1:1', developer: 'Matrix Cream Developer 10/20/30/40 vol', notes: 'Standard 1:1 (Ultra.Blonde 1:2; HIB 1:1.5 exceptions).' },
  'Goldwell Topchic': { ratio: '1:1', developer: 'Goldwell Topchic Developer Lotion 6%/9%/12%', notes: 'Most shades 1:1.' },
  'Schwarzkopf Igora Royal': { ratio: '1:1', developer: 'IGORA Oil Developer 3%/6%/9%/12%', notes: 'Standard 1:1.' },
  'Pravana ChromaSilk Permanent Crème Color': { ratio: '1:1.5', developer: 'PRAVANA Crème Developer 10/20/30/40 vol', notes: 'ChromaSilk 1:1.5 (High Lifts 1:2).' },
  // Demi
  'Redken Shades EQ': { ratio: '1:1', developer: 'Shades EQ Processing Solution', notes: 'Acidic gloss; up to ~20 minutes typical.' },
  'Wella Color Touch': { ratio: '1:2', developer: 'Color Touch Emulsion 1.9% || 4%', notes: 'Standard 1:2.' },
  'Paul Mitchell The Demi': { ratio: '1:1', developer: 'The Demi Processing Liquid', notes: 'Mix 1:1.' },
  'Matrix SoColor Sync': { ratio: '1:1', developer: 'SoColor Sync Activator', notes: 'Mix 1:1.' },
  'Goldwell Colorance': { ratio: '2:1', developer: 'Colorance System Developer Lotion 2% (7 vol)', notes: 'Core Colorance 2:1 (lotion:color). **Gloss Tones = 1:1**.' },
  'Schwarzkopf Igora Vibrance': { ratio: '1:1', developer: 'IGORA VIBRANCE Activator Gel (1.9%/4%) OR Activator Lotion (1.9%/4%)', notes: 'All shades 1:1; name Gel || Lotion.' },
  'Pravana ChromaSilk Express Tones': { ratio: '1:1.5', developer: 'PRAVANA Zero Lift Creme Developer', notes: '5 minutes only; watch visually. Use shade names (Violet, Platinum, Ash, Beige, Gold, Copper, Rose, Silver, Natural, Clear). Do NOT use level codes.' },
  // Semi
  'Wella Color Fresh': { ratio: 'RTU', developer: 'None', notes: 'Ready‑to‑use acidic semi.' },
  'Goldwell Elumen': { ratio: 'RTU', developer: 'None', notes: 'Use Elumen Prepare/Lock support; no developer.' },
  'Pravana ChromaSilk Vivids': { ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear if needed.' },
  'Schwarzkopf Chroma ID': { ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear Bonding Mask.' },
  'Matrix SoColor Cult': { ratio: 'RTU', developer: 'None', notes: 'Direct dye (no developer).' }
};

// Categorised lists for the /brands endpoint
const DEMI_BRANDS = Object.keys(BRAND_RULES).filter(k => BRAND_RULES[k].ratio !== undefined && BRAND_RULES[k].ratio !== null && BRAND_RULES[k].ratio === '1:1' && BRAND_RULES[k].developer.includes('Processing'));
// For simplicity, we hard‑code the brand categories separately; you may adjust
// this if your catalogue grows.
const PERMANENT_BRANDS = [
  'Redken Color Gels Lacquers',
  'Wella Koleston Perfect',
  'Wella Illumina Color',
  'L’Oréal Professionnel Majirel',
  'Matrix SoColor Permanent',
  'Goldwell Topchic',
  'Schwarzkopf Igora Royal',
  'Pravana ChromaSilk Permanent Crème Color'
];
const SEMI_BRANDS = [
  'Wella Color Fresh',
  'Goldwell Elumen',
  'Pravana ChromaSilk Vivids',
  'Schwarzkopf Chroma ID',
  'Matrix SoColor Cult'
];
const DEMI_LIST = [
  'Redken Shades EQ',
  'Wella Color Touch',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
  'Schwarzkopf Igora Vibrance',
  'Pravana ChromaSilk Express Tones'
];

// Service keywords and verb phrases for simple intent detection
const SERVICE_KEYWORDS = [
  'balayage', 'haircut', 'hair cut', 'color', 'colour', 'highlights', 'highlight',
  'trim', 'blowout', 'blow‑dry', 'root touchup', 'root touch up', 'toner', 'extensions',
  'consultation', 'appointment', 'style', 'perm', 'updo'
];
const BOOKING_PHRASES = ['book', 'schedule', 'set up', 'set‑up', 'reserve', 'make', 'create appointment', 'add appointment', 'appointment'];
const CANCEL_PHRASES = ['cancel appointment', 'cancel', 'delete appointment', 'remove appointment', 'reschedule'];
const CREATE_CLIENT_PHRASES = ['new client', 'add client', 'add a client', 'add new client', 'create client', 'register client'];
const DELETE_CLIENT_PHRASES = ['delete client', 'remove client', 'cancel client'];

// Sets used to ignore certain tokens when extracting names
const GENERIC_WORDS = new Set(['i','me','you','we','us','they','them','he','she','it','my','our','your','their','clients','client','appointment','appointments','book','schedule','cancel','delete','add','new','remove','for','at','on','in','the','a','an']);
const DAYS_OF_WEEK = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const VERB_SET = new Set([
  ...BOOKING_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...CANCEL_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...CREATE_CLIENT_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...DELETE_CLIENT_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/))
]);
const SERVICE_SET = new Set(SERVICE_KEYWORDS.map(s => s.toLowerCase()));
const BRAND_WORDS_SET = (() => {
  const s = new Set();
  Object.keys(BRAND_RULES).forEach(brand => {
    brand.split(/\s+/).forEach(w => s.add(w.toLowerCase()));
  });
  return s;
})();

// ----------------------------------------------------------------------------
// Helper: parse JSON body with size limit
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Extract potential names from a message.  Looks for capitalised words that
// aren’t verbs, days, services or generic tokens.  Brand words are also
// ignored so we don’t confuse product names for clients.
function findPotentialNames(text) {
  const names = [];
  const words = text.split(/\s+/);
  for (const token of words) {
    let word = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (!word) continue;
    const first = word[0];
    if (first !== first.toUpperCase()) continue;
    // Strip possessive endings
    if (word.endsWith("'s")) {
      word = word.slice(0, -2);
    }
    const cleaned = word.replace(/[^a-zA-Z]/g, '');
    const lower = cleaned.toLowerCase();
    if (!cleaned) continue;
    if (VERB_SET.has(lower) || DAYS_OF_WEEK.includes(lower) || SERVICE_SET.has(lower) || GENERIC_WORDS.has(lower) || BRAND_WORDS_SET.has(lower)) {
      continue;
    }
    if (!names.find(n => n.toLowerCase() === word.toLowerCase())) {
      names.push(word);
    }
  }
  return names;
}

// Extract service keyword from the message
function extractService(msg) {
  const lower = msg.toLowerCase();
  // sort by length descending to match phrases first
  const sorted = [...SERVICE_KEYWORDS].sort((a,b) => b.length - a.length);
  for (const s of sorted) {
    if (lower.includes(s.toLowerCase())) return s;
  }
  return null;
}

// Parse relative dates like "tomorrow", "next Monday" and times like "2pm"
function parseDateTime(msg, timezone, nowIso) {
  const lower = msg.toLowerCase();
  const now = nowIso ? new Date(nowIso) : new Date();
  // Determine day offset
  let offset = null;
  let matchedWeekday = null;
  if (lower.includes('tomorrow')) offset = 1;
  else if (lower.includes('today')) offset = 0;
  // next <day>
  for (let i = 0; i < DAYS_OF_WEEK.length; i++) {
    const day = DAYS_OF_WEEK[i];
    if (lower.includes('next ' + day)) {
      matchedWeekday = i; // 0 = Sunday
      const current = now.getDay();
      let ahead = (matchedWeekday - current + 7) % 7;
      if (ahead === 0) ahead = 7;
      offset = ahead;
      break;
    }
  }
  // plain <day>
  if (offset === null) {
    for (let i = 0; i < DAYS_OF_WEEK.length; i++) {
      const day = DAYS_OF_WEEK[i];
      if (lower.includes(day)) {
        matchedWeekday = i;
        const current = now.getDay();
        let ahead = (matchedWeekday - current + 7) % 7;
        offset = ahead;
        break;
      }
    }
  }
  if (offset === null) return null;
  const date = new Date(now);
  date.setDate(now.getDate() + offset);
  // parse time (default to noon)
  let hour = 12, minute = 0;
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const match = lower.match(timeRegex);
  if (match) {
    hour = parseInt(match[1], 10);
    if (match[2]) minute = parseInt(match[2], 10);
    const ampm = match[3];
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
    }
  }
  date.setHours(hour, minute, 0, 0);
  // Convert to ISO string in the target timezone.  We use Intl.DateTimeFormat
  // to compute the local timestamp, then rebuild an ISO string without a
  // timezone suffix.  The app interprets this as a local appointment.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

// Detect if the message is asking about a known hair colour brand.  Returns
// an array of information strings or an empty array if none are found.
function detectBrandInfo(msg) {
  const lower = msg.toLowerCase();
  const info = [];
  for (const brand of Object.keys(BRAND_RULES)) {
    if (lower.includes(brand.toLowerCase())) {
      const rule = BRAND_RULES[brand];
      info.push(`${brand}: mix ${rule.ratio} with ${rule.developer}. ${rule.notes}`);
    }
  }
  return info;
}

// Synthesize actions based on the message and context (clients + appointments)
function extractActions(msg, context, timezone, nowIso) {
  const actions = [];
  const lower = msg.toLowerCase();
  // Determine intent flags
  const isBooking = BOOKING_PHRASES.some(ph => lower.includes(ph));
  const isCancelAppt = CANCEL_PHRASES.some(ph => lower.includes(ph));
  const isCreateClient = CREATE_CLIENT_PHRASES.some(ph => lower.includes(ph));
  const isDeleteClient = DELETE_CLIENT_PHRASES.some(ph => lower.includes(ph));
  const names = findPotentialNames(msg);
  const service = extractService(msg);
  const dateISO = parseDateTime(msg, timezone, nowIso);
  // Booking logic
  if (isBooking) {
    const clientName = names.length > 0 ? names[0] : null;
    // Create client if unknown
    if (clientName && !context.clients.some(n => n.toLowerCase() === clientName.toLowerCase())) {
      actions.push({ type: 'createClient', payload: { name: clientName } });
    }
    const payload = { title: service ? service.charAt(0).toUpperCase() + service.slice(1) : 'Appointment' };
    if (dateISO) payload.dateISO = dateISO;
    if (clientName) payload.clientName = clientName;
    if (service) payload.serviceType = service;
    actions.push({ type: 'createAppointment', payload });
  }
  // Cancel appointment
  if (isCancelAppt) {
    const clientName = names.length > 0 ? names[0] : null;
    const payload = { title: service ? service.charAt(0).toUpperCase() + service.slice(1) : 'Appointment' };
    if (dateISO) payload.dateISO = dateISO;
    if (clientName) payload.clientName = clientName;
    actions.push({ type: 'deleteAppointment', payload });
  }
  // Create client (standalone)
  if (isCreateClient && !isBooking) {
    names.forEach(nm => {
      if (!context.clients.some(c => c.toLowerCase() === nm.toLowerCase())) {
        actions.push({ type: 'createClient', payload: { name: nm } });
      }
    });
  }
  // Delete client
  if (isDeleteClient) {
    names.forEach(nm => {
      if (context.clients.some(c => c.toLowerCase() === nm.toLowerCase())) {
        actions.push({ type: 'deleteClient', payload: { name: nm } });
      }
    });
  }
  return actions;
}

// Compose a reply and actions for /assistant requests
function assistantResponse(body) {
  const message = (body.message || '').trim();
  const timezone = body.timezone || 'America/Los_Angeles';
  const nowISO = body.nowISO || new Date().toISOString();
  const context = body.context || {};
  context.clients = context.clients || [];
  context.appointments = context.appointments || [];
  if (!message) {
    return { reply: 'Missing message', actions: [], warnings: [] };
  }
  // Hair formula Q&A
  const info = detectBrandInfo(message);
  if (info.length > 0) {
    return { reply: info.join('\n'), actions: [], warnings: [] };
  }
  // General knowledge base for common hair questions.  Without access to
  // external APIs, we answer a few well‑known queries locally.
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('who is paul mitchell') || lowerMsg.includes('who is paul mitchel')) {
    const reply = 'Paul Mitchell was a Scottish–American hairstylist and entrepreneur best known as the co‑founder of the professional hair care company John Paul Mitchell Systems.';
    return { reply, actions: [], warnings: [] };
  }
  if (lowerMsg.includes('ash blonde') || lowerMsg.includes('ashy blonde')) {
    const reply = 'An ash blonde look usually starts with a light blonde base (level 8–9) and an ash toner to neutralise warm undertones. A common approach is to use a level 9 neutral/ash shade with a 10‑volume developer on pre‑lightened hair. Always adjust the developer strength and processing time based on the hair’s condition.';
    return { reply, actions: [], warnings: [] };
  }
  if (lowerMsg.includes('formula') && info.length === 0) {
    const reply = 'Hair colour formulas vary depending on the desired level, tone and brand. Try asking about a specific product, brand or shade so I can give you more accurate guidance.';
    return { reply, actions: [], warnings: [] };
  }
  // Abilities question
  const lower = message.toLowerCase();
  if (lower.includes('abilities') || lower.includes('what can you do')) {
    const reply = 'I can answer questions about hair colour brands and formulas. I can also help you add, remove or view clients, and schedule, modify or cancel appointments. Just ask me what you need.';
    return { reply, actions: [], warnings: [] };
  }
  // Synthesize actions
  const actions = extractActions(message, context, timezone, nowISO);
  if (actions.length === 0) {
    return { reply: "I couldn't find an answer. Ask me about hair formulas or tell me to add, remove or book appointments.", actions: [], warnings: [] };
  }
  return { reply: 'Here are the proposed actions.', actions, warnings: [] };
}

// HTTP server
const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const path = urlObj.pathname;
    // Set CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && path === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'GET' && path === '/brands') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ demi: DEMI_LIST, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS }));
      return;
    }
    if (req.method === 'POST' && path === '/assistant') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }
      const response = assistantResponse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
      return;
    }
    // Unknown endpoint
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'server_error' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`StylistSync assistant server listening on port ${PORT}`);
});
