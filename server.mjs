// server.mjs — StylistSync Assistant & Formula Guru API
// ------------------------------------------------------------------
// This server exposes a few endpoints to power the Hair Hub application.
//
//  - /health: basic health check
//  - /brands: exposes demi/permanent/semi brands used by Formula Guru
//  - /analyze: placeholder for the Formula Guru analysis endpoint (left intact)
//  - /assistant: lightweight natural‑language assistant for hair Q&A and
//    scheduling.  This endpoint parses user messages to answer hair and
//    cosmetology questions based on built‑in brand rules and synthesises
//    structured actions (createClient, createAppointment, deleteAppointment,
//    deleteClient) from natural language.  Returned actions are used by the
//    client app to display interactive chips.  Date/time phrases like
//    “next Friday 2pm” are resolved into ISO strings using the provided
//    timezone.

// Load environment variables from a .env file if present.  We wrap this
// require in a try/catch because the dotenv package may not be installed in
// all environments.  If it fails to load, we silently continue.
try {
  await import('dotenv/config');
} catch (_err) {
  // no‑op
}
import http from 'http';
import { URL } from 'url';

// A tiny routing layer that mimics a subset of the Express API.  It
// supports registering handlers for GET and POST requests and starting an
// HTTP server.  Each handler receives the raw Node.js req/res objects.
class MiniApp {
  constructor() {
    this.routes = [];
    this.server = null;
  }
  /**
   * Register a GET handler for a specific path.
   * @param {string} path
   * @param {(req: IncomingMessage, res: ServerResponse) => void} handler
   */
  get(path, handler) {
    this.routes.push({ method: 'GET', path, handler });
  }
  /**
   * Register a POST handler for a specific path.
   * @param {string} path
   * @param {(req: IncomingMessage, res: ServerResponse) => void} handler
   */
  post(path, handler) {
    this.routes.push({ method: 'POST', path, handler });
  }
  /**
   * Internal request dispatcher.  Matches routes by exact method and path.
   */
  async handle(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = parsed;
    for (const route of this.routes) {
      if (route.method === req.method && route.path === pathname) {
        return route.handler(req, res);
      }
    }
    // Default 404 response with CORS header
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({ error: 'not_found' }));
  }
  /**
   * Start the HTTP server.  Handles CORS preflight and dispatches
   * registered route handlers.
   */
  listen(port, callback) {
    this.server = http.createServer((req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }
      this.handle(req, res);
    });
    this.server.listen(port, callback);
  }
}

const app = new MiniApp();

// ----------------------------- Brand Catalogs ------------------------------
// These brand lists and rules are used by the Formula Guru tab as well as
// referenced by the assistant for Q&A.  Do not alter the contents of these
// arrays or objects; they reflect manufacturer mixing instructions and
// classification.

const DEMI_BRANDS = [
  'Redken Shades EQ',
  'Wella Color Touch',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
  'Schwarzkopf Igora Vibrance',
  'Pravana ChromaSilk Express Tones',
];

const PERMANENT_BRANDS = [
  'Redken Color Gels Lacquers',
  'Wella Koleston Perfect',
  'Wella Illumina Color',
  'L’Oréal Professionnel Majirel',
  'Matrix SoColor Permanent',
  'Goldwell Topchic',
  'Schwarzkopf Igora Royal',
  'Pravana ChromaSilk Permanent Crème Color',
];

const SEMI_BRANDS = [
  'Wella Color Fresh',
  'Goldwell Elumen',
  'Pravana ChromaSilk Vivids',
  'Schwarzkopf Chroma ID',
  'Matrix SoColor Cult',
];

// Detailed mixing rules keyed by brand name.  Each entry has a category
// (permanent/demi/semi), a recommended ratio, an appropriate developer and
// additional notes.  These rules are surfaced to the assistant when
// answering questions about specific brands.
const BRAND_RULES = {
  // PERMANENT
  'Redken Color Gels Lacquers': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Redken Pro‑oxide Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1; 20 vol typical for grey coverage.'
  },
  'Wella Koleston Perfect': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9%/12%',
    notes: 'Core shades 1:1.'
  },
  'Wella Illumina Color': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9%',
    notes: 'Reflective permanent; 1:1 mix.'
  },
  'L’Oréal Professionnel Majirel': {
    category: 'permanent',
    ratio: '1:1.5',
    developer: 'L’Oréal Oxydant Creme',
    notes: 'Standard Majirel 1:1.5. (High Lift lines may be 1:2).'
  },
  'Matrix SoColor Permanent': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Matrix Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1. (Ultra.Blonde 1:2; HIB 1:1.5 exceptions).'
  },
  'Goldwell Topchic': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Goldwell Topchic Developer Lotion 6%/9%/12%',
    notes: 'Most shades 1:1.'
  },
  'Schwarzkopf Igora Royal': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'IGORA Oil Developer 3%/6%/9%/12%',
    notes: 'Standard 1:1.'
  },
  'Pravana ChromaSilk Permanent Crème Color': {
    category: 'permanent',
    ratio: '1:1.5',
    developer: 'PRAVANA Crème Developer 10/20/30/40 vol',
    notes: 'ChromaSilk 1:1.5 (High Lifts 1:2).'
  },

  // DEMI (deposit‑only)
  'Redken Shades EQ': {
    category: 'demi',
    ratio: '1:1',
    developer: 'Shades EQ Processing Solution',
    notes: 'Acidic gloss; up to ~20 minutes typical.'
  },
  'Wella Color Touch': {
    category: 'demi',
    ratio: '1:2',
    developer: 'Color Touch Emulsion 1.9% || 4%',
    notes: 'Standard 1:2.'
  },
  'Paul Mitchell The Demi': {
    category: 'demi',
    ratio: '1:1',
    developer: 'The Demi Processing Liquid',
    notes: 'Mix 1:1.'
  },
  'Matrix SoColor Sync': {
    category: 'demi',
    ratio: '1:1',
    developer: 'SoColor Sync Activator',
    notes: 'Mix 1:1.'
  },
  'Goldwell Colorance': {
    category: 'demi',
    ratio: '2:1',
    developer: 'Colorance System Developer Lotion 2% (7 vol)',
    notes: 'Core Colorance 2:1 (lotion:color). **Gloss Tones = 1:1**.'
  },
  'Schwarzkopf Igora Vibrance': {
    category: 'demi',
    ratio: '1:1',
    developer: 'IGORA VIBRANCE Activator Gel (1.9%/4%) OR Activator Lotion (1.9%/4%)',
    notes: 'All shades 1:1; name Gel || Lotion.'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: '**5 minutes only; watch visually. Use shade names (Violet, Platinum, Ash, Beige, Gold, Copper, Rose, Silver, Natural, Clear). Do NOT use level codes.**'
  },

  // SEMI (direct / RTU)
  'Wella Color Fresh': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Ready‑to‑use acidic semi.' },
  'Goldwell Elumen': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Use Elumen Prepare/Lock support; no developer.' },
  'Pravana ChromaSilk Vivids': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear if needed.' },
  'Schwarzkopf Chroma ID': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear Bonding Mask.' },
  'Matrix SoColor Cult': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye (no developer).' },
};

// ------------------------------ Hair Service Keywords ----------------------
// When constructing appointments from natural language, we scan for any of
// these substrings to infer the title/service type.  Ordering matters: longer
// phrases should appear before shorter ones to avoid premature matches.
const SERVICE_KEYWORDS = [
  'root touch up', 'root touch‑up', 'root touchup',
  'conditioning treatment', 'balayage', 'highlights', 'highlight', 'blowout',
  'extensions', 'treatment', 'consultation', 'retouch', 'colour', 'color',
  'toner', 'gloss', 'bleach', 'perm', 'relaxer', 'trim', 'cut', 'style',
  'ombré', 'ombre', 'bangs', 'foils'
];

// Helper to convert a keyword to Title Case.  For example "root touch up"
// becomes "Root Touch Up" for chip labels.
function titleCase(str) {
  return str
    .split(/\s+/)
    .map(w => w.length ? w.charAt(0).toUpperCase() + w.slice(1) : '')
    .join(' ');
}

// Returns a human‑readable description of mixing instructions for any brands
// mentioned in the message.  If multiple brands are referenced, the
// descriptions are concatenated.  If no known brands are found, an empty
// string is returned.  Matching is case‑insensitive.
function detectBrandInfo(message) {
  const lower = message.toLowerCase();
  const descriptions = [];
  for (const brand of Object.keys(BRAND_RULES)) {
    if (lower.includes(brand.toLowerCase())) {
      const rule = BRAND_RULES[brand];
      descriptions.push(
        `For ${brand} (${rule.category}): mix ratio ${rule.ratio}, developer ${rule.developer}. ${rule.notes}`
      );
    }
  }
  return descriptions.join(' ');
}

// Extract potential names from a message by looking for capitalised words.
// Returns an array of one‑ or two‑word names found in order of appearance.
// Each candidate is trimmed and preserves the original casing.  This helper
// ignores punctuation between words.  Later filters should remove
// candidates that correspond to days of the week or service names.
function findPotentialNames(message) {
  const results = [];
  if (!message || typeof message !== 'string') return results;
  // Split the message on whitespace to inspect individual tokens.  Stripping
  // punctuation helps avoid trailing commas or periods in names.
  const tokens = message.split(/\s+/).filter(t => t.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/[.,!?]/g, '');
    if (/^[A-Z]/.test(token)) {
      let candidate = token;
      // Look ahead to see if the next token also starts with a capital letter
      const next = tokens[i + 1] ? tokens[i + 1].replace(/[.,!?]/g, '') : null;
      if (next && /^[A-Z]/.test(next)) {
        candidate = `${candidate} ${next}`;
      }
      results.push(candidate.trim());
    }
  }
  return results;
}

// Extracts a service keyword from a message.  The search is case‑insensitive
// and stops at the first match.  The returned value is title‑cased.
function extractService(messageLower) {
  for (const svc of SERVICE_KEYWORDS) {
    if (messageLower.includes(svc.toLowerCase())) {
      return titleCase(svc);
    }
  }
  return null;
}

// Converts a Date object representing a local date/time to an ISO string
// representing the same moment in UTC, adjusting for the difference between
// the specified timezone and the server's current timezone.  This helper
// leverages Intl to compute the timezone offset at the moment in question.
function toISOForTimeZone(date, tz) {
  try {
    // Represent the given date as it would appear in the target timezone
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    // The difference between tzDate and date (in ms) is the offset from
    // server local time to the target timezone at this moment
    const offsetMs = tzDate.getTime() - date.getTime();
    // Shift date back by that offset so that when converted to ISO it
    // represents the intended local time in the target timezone
    return new Date(date.getTime() - offsetMs).toISOString();
  } catch (_err) {
    // Fallback: if Intl APIs fail or the timezone is invalid, treat the
    // provided date as local and zero‑offset.  This still returns a valid
    // ISO string but ignores the timezone argument.
    const off = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - off).toISOString();
  }
}

// Parses natural language date/time expressions into an ISO string.  This
// function supports common phrases such as "tomorrow", "today", "tonight",
// weekday names (with or without "next"), and explicit times like "2pm" or
// "14:30".  When no time is specified, a default of 10:00 AM is used.  The
// timezone argument allows the returned ISO to reflect a specific zone.
function parseDateTime(message, timezone = 'America/Los_Angeles', nowISO) {
  const lower = message.toLowerCase();
  // Determine the current moment based on nowISO (if provided) or the
  // server's current time.  nowISO is expected to be an ISO string.
  let now;
  if (nowISO && typeof nowISO === 'string') {
    const parsedNow = new Date(nowISO);
    if (!isNaN(parsedNow.valueOf())) {
      now = parsedNow;
    } else {
      now = new Date();
    }
  } else {
    now = new Date();
  }
  // Start with today's date (year, month, day) in the server's local
  // timezone.  We set the time to 00:00 to avoid carrying over time.
  const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let targetDate = new Date(baseDate);
  // Determine the day offset
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let targetDayIndex = null;
  let nextFlag = false;
  // Check for "next <weekday>"
  for (const day of days) {
    const reNext = new RegExp(`\\bnext\\s+${day}\\b`, 'i');
    if (reNext.test(message)) {
      targetDayIndex = days.indexOf(day);
      nextFlag = true;
      break;
    }
  }
  // If no explicit "next", check for any weekday mention
  if (targetDayIndex === null) {
    for (const day of days) {
      const re = new RegExp(`\\b${day}\\b`, 'i');
      if (re.test(message)) {
        targetDayIndex = days.indexOf(day);
        break;
      }
    }
  }
  // Apply relative day phrases
  if (/\\btomorrow\\b/.test(lower)) {
    targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + 1);
  } else if (/\\btoday\\b/.test(lower)) {
    targetDate = new Date(baseDate);
  } else if (/\\btonight\\b/.test(lower)) {
    targetDate = new Date(baseDate);
  } else if (targetDayIndex !== null) {
    const currentDay = now.getDay();
    let daysUntil = (targetDayIndex - currentDay + 7) % 7;
    if (nextFlag || daysUntil === 0) {
      daysUntil = daysUntil === 0 ? 7 : daysUntil;
    }
    targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + daysUntil);
  } else {
    // No day specified: default to today
    targetDate = new Date(baseDate);
  }
  // Default time values
  let hour = 10;
  let minute = 0;
  // Relative part‑of‑day hints override defaults
  if (/\\bnoon\\b/.test(lower)) {
    hour = 12;
    minute = 0;
  }
  if (/\\bmidnight\\b/.test(lower)) {
    hour = 0;
    minute = 0;
  }
  if (/\\bmorning\\b/.test(lower)) {
    hour = 9;
  }
  if (/\\bafternoon\\b/.test(lower)) {
    hour = 14;
  }
  if (/\\bevening\\b/.test(lower)) {
    hour = 17;
  }
  // Parse explicit times such as 2pm, 14:30, 2:15 pm, etc.
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const timeMatch = message.match(timeRegex);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
    if (meridiem) {
      if (meridiem === 'pm' && hour < 12) {
        hour += 12;
      }
      if (meridiem === 'am' && hour === 12) {
        hour = 0;
      }
    } else {
      // If no am/pm, treat early hours (1–7) as afternoon for typical salon hours
      if (hour < 8) {
        hour += 12;
      }
    }
  }
  // Compose a Date using local timezone values
  const candidate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), hour, minute, 0);
  return toISOForTimeZone(candidate, timezone);
}

// Extracts structured actions from a user message.  Context provides lists
// of existing clients and appointments to help disambiguate names.  Each
// returned action has a type and a payload dictionary with only primitive
// values.  The supported types are createClient, createAppointment,
// deleteAppointment and deleteClient.
function extractActions(message, timezone, nowISO, context) {
  const actions = [];
  const lower = message.toLowerCase();
  const clients = Array.isArray(context && context.clients) ? context.clients : [];
  // -----------------------------------------------------------------------
  // Create Client detection
  // Look for phrases like "add client Sarah", "create client John Doe", or
  // "new client Eve".  We also support synonyms like "register client"
  // or "sign up client".  Multiple clients can be captured.
  const clientCreateRegex = /(add|create|new|register|signup|sign\s*up)\s+client\s+([A-Z][\w'\- ]*(?:\s+[A-Z][\w'\- ]*)?)/gi;
  let match;
  while ((match = clientCreateRegex.exec(message)) !== null) {
    const name = match[2].trim();
    if (name) {
      actions.push({ type: 'createClient', payload: { name } });
    }
  }
  // -----------------------------------------------------------------------
  // Delete Client detection
  // We check for explicit "delete client" phrases and remove any clients
  // whose names are mentioned in the message.  If no explicit name is
  // captured we also scan the known client list.
  if (/(delete|remove)\s+client/i.test(lower)) {
    const deleteClientRegex = /(delete|remove)\s+client\s+([A-Z][\w'\- ]*(?:\s+[A-Z][\w'\- ]*)?)/gi;
    let delMatch;
    let foundName = false;
    while ((delMatch = deleteClientRegex.exec(message)) !== null) {
      const nm = delMatch[2].trim();
      if (nm) {
        actions.push({ type: 'deleteClient', payload: { name: nm } });
        foundName = true;
      }
    }
    if (!foundName) {
      clients.forEach(nm => {
        if (lower.includes(nm.toLowerCase())) {
          actions.push({ type: 'deleteClient', payload: { name: nm } });
        }
      });
    }
  }
  // Additional Delete Client detection
  // If the message says "delete <Name>" or "remove <Name>" without the
  // word "appointment" nearby, and the name matches a known client,
  // interpret this as a request to delete the client.  This helps with
  // natural phrasing like "remove Kiara".
  {
    const simpleDeleteRegex = /(delete|remove)\s+([A-Z][\w'\- ]*(?:\s+[A-Z][\w'\- ]*)?)/gi;
    let m;
    while ((m = simpleDeleteRegex.exec(message)) !== null) {
      const verb = m[1].toLowerCase();
      const target = m[2].trim();
      // Ignore if the word 'appointment' or 'appt' appears within 5 words
      const surrounding = message
        .slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
        .toLowerCase();
      if (/\bappointment\b|\bappt\b/.test(surrounding)) continue;
      // Only trigger if the target matches a known client
      const matched = clients.find(c => c.toLowerCase() === target.toLowerCase());
      if (matched) {
        actions.push({ type: 'deleteClient', payload: { name: matched } });
      }
    }
  }
  // -----------------------------------------------------------------------
  // Delete Appointment detection
  // Handles "delete appointment", "remove appointment", or "cancel
  // appointment" with optional client name and date/time.  We attempt to
  // identify the client from the message or from context.  The title is
  // derived from any service keyword mentioned; otherwise "Appointment".
  if (/(delete|remove|cancel).*\b(appointment|appt)\b/i.test(lower)) {
    const dateISO = parseDateTime(message, timezone, nowISO);
    // Determine client name: prefer explicit mention of a known client
    let targetName = null;
    for (const nm of clients) {
      if (lower.includes(nm.toLowerCase())) {
        targetName = nm;
        break;
      }
    }
    const service = extractService(lower) || 'Appointment';
    actions.push({
      type: 'deleteAppointment',
      payload: { clientName: targetName, dateISO, title: service }
    });
  }
  // -----------------------------------------------------------------------
  // Create Appointment detection
  // Ignore if the message is clearly a deletion request.  Otherwise
  // recognise words like "book", "schedule", "set up", "add", or
  // "create" in combination with typical appointment/service terms.  We
  // extract the date/time, service, price, duration and client name.  If
  // the client is not in the provided context we also propose creating the
  // client first.  Only one appointment per message is generated.
  if (!/(delete|remove|cancel).*\b(appointment|appt)\b/i.test(lower)) {
    const createAppPattern = /(book|schedule|set\s*up|setup|add|create|reserve|arrange|make|fix|set)/i;
    const appointmentHint = /(appointment|appt|hair|color|colour|cut|trim|balayage|highlights|highlight|root|toner|gloss|style|bleach|perm|relaxer)/i;
    if (createAppPattern.test(lower) && appointmentHint.test(lower)) {
      const dateISO = parseDateTime(message, timezone, nowISO);
      // Determine client name: search known clients first
      let name = null;
      for (const nm of clients) {
        if (lower.includes(nm.toLowerCase())) {
          name = nm;
          break;
        }
      }
      // If no known client found, look for capitalised names in the message.
      if (!name) {
        const candidates = findPotentialNames(message);
        for (const cand of candidates) {
          const candLower = cand.toLowerCase();
          // Skip weekday names and relative phrases
          const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday','today','tomorrow','tonight'];
          if (days.includes(candLower)) continue;
          // Skip known service keywords
          if (SERVICE_KEYWORDS.some(s => s.toLowerCase() === candLower)) continue;
          // Skip generic words
          const generic = ['appointment','hair','client'];
          if (generic.includes(candLower)) continue;
          // Skip candidates whose first word is a known verb (e.g. Book Sarah)
          const firstWord = cand.split(/\s+/)[0].toLowerCase();
          const verbs = ['book','schedule','set','setup','add','create'];
          if (verbs.includes(firstWord)) continue;
          name = cand;
          break;
        }
      }
      // Identify the service title
      const service = extractService(lower) || 'Appointment';
      // Parse price (e.g. $275 or 275 dollars)
      let price;
      const priceMatch = message.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1]);
      }
      // Parse duration (e.g. 2.5 hours, 90 minutes)
      let durationMinutes;
      const hrMatch = lower.match(/([0-9]*\.?[0-9]+)\s*(hours|hrs|hr|h)\b/);
      if (hrMatch) {
        durationMinutes = parseFloat(hrMatch[1]) * 60;
      } else {
        const minMatch = lower.match(/([0-9]+)\s*(minutes|min|mins)\b/);
        if (minMatch) {
          durationMinutes = parseFloat(minMatch[1]);
        }
      }
      // Build appointment payload
      const payload = { title: service, dateISO, clientName: name };
      if (typeof price !== 'undefined') payload.price = price;
      if (typeof durationMinutes !== 'undefined') payload.durationMinutes = durationMinutes;
      actions.push({ type: 'createAppointment', payload });
      // If the client is specified but not in context, propose creating it
      if (name && !clients.some(c => c.toLowerCase() === name.toLowerCase())) {
        // Prepend so that the client is created before the appointment
        actions.unshift({ type: 'createClient', payload: { name } });
      }
    }
  }
  return actions;
}

// --------------------------------- Routes ----------------------------------
// Basic health and brand endpoints remain unchanged.  They are used by
// various parts of the Hair Hub app.
app.get('/health', (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ ok: true }));
});
app.get('/brands', (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS }));
});

// ----------------------- Helpers for body parsing --------------------------
// Reads and parses JSON from an incoming request.  Rejects if the body is
// malformed or exceeds 10MB.  Returns an empty object for empty bodies.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const limit = 10 * 1024 * 1024; // 10MB
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(body);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', err => {
      reject(err);
    });
  });
}

// Placeholder for the Formula Guru analysis endpoint.  In this simplified
// implementation we deliberately avoid calling external services (e.g. OpenAI)
// to comply with the assignment guidelines.  A real implementation would
// validate formulas, enforce mixing rules, generate developer instructions and
// respond with analysis results.  Here we simply return an error to indicate
// that the endpoint is unavailable.
app.post('/analyze', async (req, res) => {
  // Set headers for CORS and JSON
  res.statusCode = 501;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ error: 'analyze_not_implemented' }));
});

// ------------------------------ StylistSync Assistant ----------------------
// Calendar‑aware, action‑synthesising assistant.  This endpoint takes a
// natural language message along with optional timezone, nowISO and
// context (clients and appointments) and returns a reply string, an array
// of structured actions and an array of warnings (empty in this
// implementation).  The reply may include informational content based on
// the question (e.g. mixing ratios) and will mention when actions are
// proposed.  The client app is responsible for rendering chips and
// confirming the actions.
app.post('/assistant', async (req, res) => {
  // Always set CORS and content type headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Parse the request body as JSON.  If parsing fails, return 400.
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_json' }));
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const timezone = typeof body.timezone === 'string' && body.timezone ? body.timezone : 'America/Los_Angeles';
    const nowISO = body.nowISO;
    const context = body.context || {};
    if (!message) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing message' }));
    }
    // Hair/cosmetology Q&A: assemble reply from brand rules if applicable
    const info = detectBrandInfo(message);
    // Synthesize actions from the message
    const actions = extractActions(message, timezone, nowISO, context);
    // Build reply.  If info was found, include it; if actions were
    // synthesized, append a note indicating actions have been proposed.  If
    // neither information nor actions are found, provide a generic help
    // message.
    let reply = '';
    if (info) {
      reply += info.trim();
    }
    if (actions && actions.length > 0) {
      if (reply) reply += ' ';
      reply += 'Here are the proposed actions.';
    }
    if (!reply) {
      reply = 'I couldn\'t find an answer. Ask me about hair formulas or tell me to add, remove or book appointments.';
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({ reply, actions, warnings: [] }));
  } catch (err) {
    console.error('assistant error', err);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'assistant_failed' }));
  }
});

// Start the server unless we are in a test environment.  Express will
// automatically choose an available port if none is specified.
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Hair Hub server running on port ${PORT}`);
  });
}

export default app;
