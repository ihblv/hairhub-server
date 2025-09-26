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
const BOOKING_PHRASES = ['book', 'schedule', 'set up', 'set‑up', 'reserve', 'make', 'create appointment', 'add appointment', 'appointment', 'add '];
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

// ---------------------------------------------------------------------------
// Utilities for friendly summaries and simple analytics
//
// These helpers support proper‑casing strings, formatting dates/times for
// human‑readable summaries and building concise action responses.  They also
// handle count, listing and aggregate queries before invoking the LLM.  See
// assistantResponse() for integration.

/**
 * Proper‑case a phrase by capitalising the first letter of each word and
 * lower‑casing the rest.  Hyphenated and multi‑word phrases are treated as
 * separate words.  Example: "brazilian blowout" → "Brazilian Blowout".
 * @param {string} str
 * @returns {string}
 */
function properCase(str) {
  if (!str) return str;
  return String(str).split(/\s+/).map(w => {
    if (!w) return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

/**
 * Format an ISO date string into a concise human‑friendly string in the given
 * timezone.  The output uses the pattern "Mon, Sep 30 • 2:00 PM".  If the
 * date cannot be parsed, returns null.
 * @param {string} iso
 * @param {string} timezone
 * @returns {string|null}
 */
function formatDateForSummary(iso, timezone) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
  const parts = fmt.formatToParts(d);
  const get = (type) => {
    const p = parts.find(pr => pr.type === type);
    return p && p.value;
  };
  const weekday = get('weekday');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const dayPeriod = get('dayPeriod');
  if (!weekday || !month || !day || !hour || !minute) return null;
  // Ensure minute is two digits
  const minStr = minute.toString().padStart(2, '0');
  const time = `${hour}:${minStr} ${dayPeriod}`;
  return `${weekday}, ${month} ${day} • ${time}`;
}

/**
 * Build a friendly summary of proposed actions.  When multiple actions
 * appear, returns one line per action separated by newlines.  Titles are
 * proper‑cased and dates are formatted in the stylist's timezone.
 * @param {Array<{type:string,payload:Object}>} actions
 * @param {string} timezone
 * @returns {string}
 */
function summarizeActions(actions, timezone) {
  const lines = [];
  for (const act of actions) {
    const payload = act.payload || {};
    switch (act.type) {
      case 'createClient': {
        const name = payload.name;
        if (name) {
          lines.push(`✅ Added client ${name}.`);
        }
        break;
      }
      case 'deleteClient': {
        const name = payload.name;
        if (name) {
          lines.push(`🗑️ Removed client ${name}.`);
        }
        break;
      }
      case 'createAppointment': {
        let title = null;
        if (payload.serviceType) {
          title = properCase(payload.serviceType);
        } else if (payload.title) {
          title = properCase(payload.title);
        } else {
          title = 'Appointment';
        }
        const when = payload.dateISO ? formatDateForSummary(payload.dateISO, timezone) : null;
        const client = payload.clientName;
        let line = `✅ Booked ${title}`;
        if (client) line += ` for ${client}`;
        if (when) line += ` on ${when}`;
        line += '.';
        lines.push(line);
        break;
      }
      case 'deleteAppointment': {
        let title = null;
        if (payload.serviceType) {
          title = properCase(payload.serviceType);
        } else if (payload.title) {
          title = properCase(payload.title);
        } else {
          title = 'Appointment';
        }
        const when = payload.dateISO ? formatDateForSummary(payload.dateISO, timezone) : null;
        const client = payload.clientName;
        let line = `🗑️ Canceled ${title}`;
        if (client) line += ` for ${client}`;
        if (when) line += ` on ${when}`;
        line += '.';
        lines.push(line);
        break;
      }
      default:
        break;
    }
  }
  return lines.join('\n');
}

/**
 * Handle count queries (how many clients or appointments).  Returns a reply
 * string if the message matches a count intent; otherwise returns null.
 * Appointments can be filtered by today, tomorrow, this week or this month.
 * @param {string} lower
 * @param {Object} context
 * @param {string} timezone
 * @returns {string|null}
 */
function handleCounts(lower, context, timezone) {
  const clients = Array.isArray(context.clients) ? context.clients : [];
  const appts = Array.isArray(context.appointments) ? context.appointments : [];
  // Client count
  if (/\b(how many|number of)\s+clients\b/.test(lower) || /\bclient count\b/.test(lower)) {
    return `You have ${clients.length} client${clients.length === 1 ? '' : 's'}.`;
  }
  // Appointment count
  if (/\b(how many|number of)\s+appointments\b/.test(lower) || /\bappointment count\b/.test(lower)) {
    // Determine timeframe
    const now = new Date();
    const list = appts.map(a => {
      const iso = a.dateISO || (typeof a.dateISO === 'string' ? a.dateISO : (a.dateISO ? a.dateISO : null));
      return { date: iso ? new Date(iso) : null };
    });
    const lc = lower;
    const startOfDay = (d) => {
      const t = new Date(d);
      t.setHours(0, 0, 0, 0);
      return t;
    };
    const addDays = (d, n) => {
      const t = new Date(d);
      t.setDate(t.getDate() + n);
      return t;
    };
    const startOfWeek = (d) => {
      const t = new Date(d);
      const day = t.getDay();
      t.setDate(t.getDate() - day);
      t.setHours(0, 0, 0, 0);
      return t;
    };
    const startOfMonth = (d) => {
      return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    };
    let start = null;
    let end = null;
    if (lc.includes('today')) {
      start = startOfDay(now);
      end = addDays(start, 1);
    } else if (lc.includes('tomorrow')) {
      start = startOfDay(addDays(now, 1));
      end = addDays(start, 1);
    } else if (lc.includes('this week')) {
      start = startOfWeek(now);
      end = addDays(start, 7);
    } else if (lc.includes('this month')) {
      start = startOfMonth(now);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    }
    let count = 0;
    if (start && end) {
      for (const item of list) {
        if (item.date && item.date >= start && item.date < end) {
          count++;
        }
      }
      const frame = lc.includes('today') ? 'today' : lc.includes('tomorrow') ? 'tomorrow' : lc.includes('this week') ? 'this week' : 'this month';
      return `You have ${count} appointment${count === 1 ? '' : 's'} ${frame}.`;
    } else {
      // Total appointments
      return `You have ${appts.length} appointment${appts.length === 1 ? '' : 's'}.`;
    }
  }
  return null;
}

/**
 * Handle listing queries such as "upcoming appointments", "what’s next",
 * "next 5 appointments" or "appointments on Monday/September 30".  Returns a
 * reply string or null.  The appointments are sorted ascending and formatted
 * using the same summary rules.
 * @param {string} lower
 * @param {Object} context
 * @param {string} timezone
 * @param {string} nowIso
 * @returns {string|null}
 */
function handleListings(lower, context, timezone, nowIso) {
  const appts = Array.isArray(context.appointments) ? context.appointments : [];
  const list = appts.map(a => {
    const iso = a.dateISO || (typeof a.dateISO === 'string' ? a.dateISO : (a.dateISO ? a.dateISO : null));
    return {
      date: iso ? new Date(iso) : null,
      title: a.title,
      clientName: a.clientName
    };
  }).filter(it => it.date);
  list.sort((a, b) => a.date - b.date);
  const now = nowIso ? new Date(nowIso) : new Date();
  if (/\b(what\'?s next|whats next|upcoming appointments)\b/.test(lower) || (/\bnext\b/.test(lower) && /\bappointments\b/.test(lower))) {
    let num = 5;
    const nextMatch = lower.match(/next\s+(\d+)/);
    if (nextMatch && nextMatch[1]) {
      const n = parseInt(nextMatch[1], 10);
      if (!isNaN(n) && n > 0) {
        num = n;
      }
    }
    const upcoming = list.filter(item => item.date >= now).slice(0, num);
    if (upcoming.length === 0) {
      return `You have no upcoming appointments.`;
    }
    const lines = upcoming.map(item => {
      const when = formatDateForSummary(item.date.toISOString(), timezone);
      const t = properCase(item.title || 'Appointment');
      if (item.clientName) {
        return `${t} for ${item.clientName} on ${when}`;
      } else {
        return `${t} on ${when}`;
      }
    });
    return `Your next ${upcoming.length} appointment${upcoming.length === 1 ? '' : 's'}:\n` + lines.join('\n');
  }
  const onMatch = lower.match(/appointments on ([^\?\.\!]+)/);
  if (onMatch && onMatch[1]) {
    const datePhrase = onMatch[1].trim();
    const iso = parseDateTime(datePhrase, timezone, nowIso);
    if (iso) {
      const target = new Date(iso);
      const start = new Date(target);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const matches = list.filter(item => item.date >= start && item.date < end);
      const heading = formatDateForSummary(start.toISOString(), timezone);
      if (matches.length === 0) {
        return `No appointments on ${heading ? heading.split(' •')[0] : datePhrase}.`;
      }
      const lines = matches.map(item => {
        const when = formatDateForSummary(item.date.toISOString(), timezone);
        const t = properCase(item.title || 'Appointment');
        if (item.clientName) {
          return `${t} for ${item.clientName} on ${when}`;
        } else {
          return `${t} on ${when}`;
        }
      });
      return `Appointments on ${heading ? heading.split(' •')[0] : datePhrase}:\n` + lines.join('\n');
    }
  }
  return null;
}

/**
 * Handle aggregate queries such as "most booked client this month/week".
 * Returns a reply string or null.  If multiple clients tie, lists them.
 * @param {string} lower
 * @param {Object} context
 * @returns {string|null}
 */
function handleAggregates(lower, context) {
  if (!/\bmost booked client\b/.test(lower)) {
    return null;
  }
  const appts = Array.isArray(context.appointments) ? context.appointments : [];
  let range = null; // 'week' or 'month'
  if (lower.includes('this week')) range = 'week';
  else if (lower.includes('this month')) range = 'month';
  const now = new Date();
  let start = null;
  if (range === 'week') {
    const t = new Date(now);
    const day = t.getDay();
    t.setDate(t.getDate() - day);
    t.setHours(0, 0, 0, 0);
    start = t;
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  const counts = {};
  for (const a of appts) {
    const name = a.clientName;
    const iso = a.dateISO || a.date;
    if (!name) continue;
    let include = true;
    if (start && iso) {
      const d = new Date(iso);
      if (range === 'week') {
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        include = d >= start && d < end;
      } else if (range === 'month') {
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
        include = d >= start && d < end;
      }
    }
    if (!include) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return range ? `No appointments ${range === 'week' ? 'this week' : 'this month'}.` : `No appointments.`;
  }
  let max = 0;
  for (const [, count] of entries) {
    if (count > max) max = count;
  }
  const top = entries.filter(([name, count]) => count === max).map(([name]) => name);
  const rangeLabel = range === 'week' ? 'This week' : range === 'month' ? 'This month' : '';
  if (top.length === 1) {
    return `${rangeLabel ? rangeLabel + ': ' : ''}${top[0]} (${max}).`;
  } else {
    return `${rangeLabel ? rangeLabel + ': ' : ''}${top.join(', ')} (${max}).`;
  }
}

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
  // Sort by length descending to match multi‑word phrases first.
  const sorted = [...SERVICE_KEYWORDS].sort((a, b) => b.length - a.length);
  let found = null;
  for (const s of sorted) {
    if (lower.includes(s.toLowerCase())) {
      found = s;
      break;
    }
  }
  if (!found) return null;
  // If the matched term is a generic "appointment" but another specific service
  // appears in the message, prefer the more specific one.  We re‑scan the
  // sorted list (excluding "appointment") for any other hits and return the
  // longest such term.  This prevents naming every booking as "Appointment".
  if (found.toLowerCase() === 'appointment') {
    for (const s of sorted) {
      if (s.toLowerCase() === 'appointment') continue;
      if (lower.includes(s.toLowerCase())) {
        found = s;
        break;
      }
    }
  }
  return found;
}

// Parse relative dates like "tomorrow", "next Monday" and times like "2pm"
function parseDateTime(msg, timezone, nowIso) {
  // Normalise message for easier matching but keep original for case‑sensitive extraction
  let lower = msg.toLowerCase();
  const now = nowIso ? new Date(nowIso) : new Date();

  // Helper to convert a calendar date/time expressed in the target timezone
  // into a UTC ISO string (with Z).  This avoids ambiguous interpretation
  // when parsing the ISO string later.  It works by starting with the
  // supplied local time as UTC, then computing how far off that guess is
  // in the desired timezone and adjusting accordingly.  See
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
  // for Intl usage.  The result has no milliseconds and ends with 'Z'.
  function convertLocalTimeToUTCISO(year, month, day, hour, minute, second = 0) {
    // Start with a guess: treat the local time as if it were UTC
    let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    // Format that guess in the target timezone to see what time it appears as
    const dt = new Date(utcMs);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const formatted = fmt.format(dt).split(':');
    const tzHour = parseInt(formatted[0], 10);
    const tzMinute = parseInt(formatted[1], 10);
    const tzSecond = parseInt(formatted[2], 10);
    // Determine the difference between the desired local time and the
    // timezone-rendered time in minutes.  Positive diff means our guess is
    // ahead and needs to be moved backwards.
    const desiredMinutes = hour * 60 + minute;
    const tzMinutes = tzHour * 60 + tzMinute;
    const diffMinutes = tzMinutes - desiredMinutes;
    const diffMs = diffMinutes * 60 * 1000;
    // Adjust the UTC milliseconds by the difference to align the rendered
    // timezone time with the desired local time.  Second-level accuracy is
    // maintained from the original second parameter.
    utcMs = utcMs - diffMs;
    const finalDate = new Date(utcMs);
    // Return an ISO string without milliseconds and with 'Z'.
    return finalDate.toISOString().slice(0, 19) + 'Z';
  }

  // Remove ordinal suffixes from date numbers (e.g. "30th" -> "30").
  lower = lower.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1');

  // Attempt to parse absolute date expressions first.  Support month names,
  // abbreviations and numeric formats (mm/dd[/yyyy]).
  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, octo: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };
  // Match month name followed by day and optional year
  let absDate = null;
  let providedYear = false;
  const monthNameRegex = new RegExp('\\b(' + Object.keys(monthMap).join('|') + ')[\\s\\.]*([0-9]{1,2})(?:\\s*,?\\s*([0-9]{2,4}))?', 'i');
  const mName = lower.match(monthNameRegex);
  if (mName) {
    const monStr = mName[1].toLowerCase().replace(/\./g, '');
    const month = monthMap[monStr];
    let day = parseInt(mName[2], 10);
    let year = mName[3] ? parseInt(mName[3], 10) : now.getFullYear();
    if (year && year < 100) year += 2000;
    absDate = new Date(year, month - 1, day);
    providedYear = !!mName[3];
  } else {
    // Match numeric mm/dd or mm/dd/yyyy
    const mdRegex = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;
    const mMd = lower.match(mdRegex);
    if (mMd) {
      let month = parseInt(mMd[1], 10);
      let day = parseInt(mMd[2], 10);
      let year = mMd[3] ? parseInt(mMd[3], 10) : now.getFullYear();
      if (year && year < 100) year += 2000;
      absDate = new Date(year, month - 1, day);
      providedYear = !!mMd[3];
    }
  }
  // Default time is noon when none is provided explicitly.  Times are
  // detected in the original (case‑sensitive) message string to avoid
  // confusing date numbers (e.g. "30th") with hours.  Preference is
  // given to matches that include an AM/PM meridiem.  If no meridiem is
  // found, a 24‑hour time with a colon is accepted.  Otherwise the
  // default 12:00 is used.
  let hour = 12;
  let minute = 0;
  {
    // Match "2pm" or "2:00 pm" (case‑insensitive) using word boundaries
    const amPmRegex = /\b(\d{1,2})(?:\:(\d{2}))?\s*(am|pm)\b/i;
    // Match 24‑hour format like "14:00"
    const m24Regex = /\b(\d{1,2})\:(\d{2})\b/;
    const ampmMatch = msg.match(amPmRegex);
    if (ampmMatch) {
      hour = parseInt(ampmMatch[1], 10);
      minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
      const ampm = ampmMatch[3];
      if (/pm/i.test(ampm) && hour < 12) hour += 12;
      if (/am/i.test(ampm) && hour === 12) hour = 0;
    } else {
      const m24 = msg.match(m24Regex);
      if (m24) {
        hour = parseInt(m24[1], 10);
        minute = parseInt(m24[2], 10);
      }
    }
  }
  if (absDate) {
    // Use absolute date; if missing time default to noon or parsed time
    const d = new Date(absDate.getFullYear(), absDate.getMonth(), absDate.getDate(), hour, minute, 0, 0);
    // If no year was provided and date has already passed this year, roll to next year
    // Note: the previous check against mdRegex was removed; we no longer need
    // to perform additional checks here.
    // If only month/day provided and year omitted: ensure future date if past
    if (!providedYear) {
      const nowY = now.getFullYear();
      const candidate = new Date(absDate.getFullYear(), absDate.getMonth(), absDate.getDate());
      const nowDateOnly = new Date(nowY, now.getMonth(), now.getDate());
      if (candidate < nowDateOnly) {
        d.setFullYear(d.getFullYear() + 1);
      }
    }
    // Convert the calendar date/time in the target timezone to a UTC ISO
    // string.  Use the month/day/year and the parsed hour/minute.  This
    // ensures that later parsing and formatting in different runtimes will
    // preserve the intended local time.
    return convertLocalTimeToUTCISO(
      d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, minute, 0
    );
  }
  // No absolute date matched.  Use relative parsing for today/tomorrow/weekday semantics.
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
  // The month/day/year values must be drawn from the adjusted date.  Use
  // convertLocalTimeToUTCISO to ensure the ISO reflects the correct local
  // time regardless of the server’s own timezone.
  return convertLocalTimeToUTCISO(
    date.getFullYear(), date.getMonth() + 1, date.getDate(), hour, minute, 0
  );
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
    // Choose the last candidate name that is not a month name.  This avoids
    // picking "September" from phrases like "on September 30".
    let clientName = null;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december','jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec'];
    for (let i = names.length - 1; i >= 0; i--) {
      const nm = names[i];
      if (!nm) continue;
      const lowerNm = nm.toLowerCase();
      if (!monthNames.includes(lowerNm)) {
        clientName = nm;
        break;
      }
    }
    if (!clientName && names.length > 0) {
      clientName = names[names.length - 1];
    }
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
    let clientName = null;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december','jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec'];
    for (let i = names.length - 1; i >= 0; i--) {
      const nm = names[i];
      if (!nm) continue;
      const lowerNm = nm.toLowerCase();
      if (!monthNames.includes(lowerNm)) {
        clientName = nm;
        break;
      }
    }
    if (!clientName && names.length > 0) {
      clientName = names[names.length - 1];
    }
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
  // Abilities question
  let lower = message.toLowerCase();
  // Normalise curly apostrophes to straight quotes for consistent intent matching.
  lower = lower.replace(/[’‘]/g, "'");
  if (lower.includes('abilities') || lower.includes('what can you do')) {
    const reply = 'I can answer questions about hair colour brands and formulas. I can also help you add, remove or view clients, and schedule, modify or cancel appointments. Just ask me what you need.';
    return { reply, actions: [], warnings: [] };
  }

  // -----------------------------------------------------------------------
  // Pre‑LLM lightweight intent detection
  // Before extracting actions or invoking the language model, we handle
  // simple analytical queries directly.  These cover counts (how many
  // clients/appointments), listings (upcoming or next appointments and
  // appointments on specific dates) and aggregates (most booked client this
  // month/week).  If any of these helpers return a reply, we return it
  // immediately without actions.
  {
    // Use the existing lowercase message for matching.  When context is
    // missing, fall back to empty arrays.
    const countsReply = handleCounts(lower, context, timezone);
    if (countsReply) {
      return { reply: countsReply, actions: [], warnings: [] };
    }
    const listingsReply = handleListings(lower, context, timezone, nowISO);
    if (listingsReply) {
      return { reply: listingsReply, actions: [], warnings: [] };
    }
    const aggregatesReply = handleAggregates(lower, context);
    if (aggregatesReply) {
      return { reply: aggregatesReply, actions: [], warnings: [] };
    }
  }
  // Synthesize actions
  const actions = extractActions(message, context, timezone, nowISO);
  if (actions.length === 0) {
    return { reply: "Hmm, I didn’t catch that. Try asking me about formulas, clients, or appointments.", actions: [], warnings: [] };
  }
  // Build a friendly summary of the actions instead of a generic heading
  const summary = summarizeActions(actions, timezone);
  return { reply: summary, actions, warnings: [] };
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
    // Proxy Formula Guru photo analysis to external service.  When a POST
    // request is made to /analyze, forward the multipart body and headers
    // to the configured upstream ANALYZE_URL (default: hairhub-server.onrender.com/analyze).
    if (req.method === 'POST' && path === '/analyze') {
      // Read the entire request body into a Buffer.  This is safe for the small images
      // used by the app but may need streaming for very large payloads.
      const chunks = [];
      try {
        for await (const chunk of req) {
          chunks.push(chunk);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy_error', detail: 'Failed to read request body' }));
        return;
      }
      const bodyBuffer = Buffer.concat(chunks);
      const upstream = process.env.ANALYZE_URL || 'https://hairhub-server.onrender.com/analyze';
      // Use fetch to proxy the request to the upstream analysis service.  Preserve
      // the original Content-Type so that multipart boundaries are forwarded
      // correctly.
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const upstreamRes = await fetch(upstream, {
          method: 'POST',
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/octet-stream'
          },
          body: bodyBuffer,
          signal: controller.signal
        });
        clearTimeout(timeout);
        const respBuffer = Buffer.from(await upstreamRes.arrayBuffer());
        // Mirror the upstream status and content-type
        res.writeHead(upstreamRes.status, {
          'Content-Type': upstreamRes.headers.get('content-type') || 'application/json'
        });
        res.end(respBuffer);
      } catch (err) {
        const status = err.name === 'AbortError' ? 504 : 502;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'analyze_proxy_failed', detail: String(err.message || err) }));
      }
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
      // Compute the local response synchronously
      const local = assistantResponse(body);
      // If there are actions or a meaningful local reply, return immediately.
      // Use the same fallback message as assistantResponse.
      const fallback = "Hmm, I didn’t catch that. Try asking me about formulas, clients, or appointments.";
      if (local.actions && local.actions.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(local));
        return;
      }
      if (local.reply && local.reply.trim() && local.reply !== fallback) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(local));
        return;
      }
      // No actions and fallback reply → call OpenAI for a richer answer.
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ reply: "I couldn’t find an answer. Try rephrasing or ask a specific brand question.", actions: [], warnings: [] }));
        return;
      }
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const systemPrompt = `You are StylistSync, an expert salon assistant. Give brand-accurate, manufacturer-safe guidance. When asked for formulas, include brand-correct mixing ratios and developers; include timing ranges, strand tests, and caveats. For pricing questions: outline factors and a reasonable range; do not guarantee outcomes. Never invent developer ratios against manufacturer rules. Add a brief disclaimer for chemical services. If asked non-cosmetology trivia like 'who is Paul Mitchell', just answer normally.`;
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(body.message || '') }
      ];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!gptRes.ok) {
          throw new Error(`OpenAI HTTP ${gptRes.status}`);
        }
        const gptData = await gptRes.json();
        const reply = gptData.choices?.[0]?.message?.content?.trim() || "I couldn’t find an answer. Try rephrasing or ask a specific brand question.";
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ reply, actions: [], warnings: [] }));
      } catch (err) {
        const status = err.name === 'AbortError' ? 504 : 502;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: "I couldn’t find an answer. Try rephrasing or ask a specific brand question.", actions: [], warnings: [] }));
      }
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
