// server-6.mjs — Unified StylistSync assistant + Formula Guru
//
// This server merges the Formula Guru analysis endpoint (/analyze) with the
// StylistSync assistant (/assistant). It still exposes the brand catalogue
// (/brands) and a health check (/health). The assistant can perform local
// action extraction (create/delete client and appointment) and falls back to
// OpenAI for general Q&A. The analysis route accepts an inspiration photo
// and returns formulated scenarios using OpenAI's vision model.
//
// Dependencies: express, cors, multer, fs/promises, openai. Ensure your
// environment has these installed and set OPENAI_API_KEY (and optionally
// OPENAI_MODEL). To keep formulas safe, manufacturer mixing ratios and
// developer names are enforced after the AI response.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import { OpenAI } from 'openai';

// ---------------------------------------------------------------------------
// Express setup
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ dest: process.env.UPLOAD_DIR || 'tmp/' });

// OpenAI client
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ---------------------------------------------------------------------------
// Brand catalogues (categories) — matches the iOS app expectations
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

// ---------------------------------------------------------------------------
// Manufacturer mixing rules and notes. Each entry also tracks its category.
const BRAND_RULES = {
  // Permanent
  'Redken Color Gels Lacquers': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Redken Pro-oxide Cream Developer 10/20/30/40 vol',
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
  // Demi
  'Redken Shades EQ': {
    category: 'demi',
    ratio: '1:1',
    developer: 'Shades EQ Processing Solution',
    notes: 'Acidic gloss; up to ~20 minutes typical.'
  },
  'Wella Color Touch': {
    category: 'demi',
    ratio: '1:2',
    developer: 'Color Touch Emulsion 1.9% or 4%',
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
    notes: 'All shades 1:1; name Gel or Lotion.'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: '**5 minutes only; watch visually. Use shade names (Violet, Platinum, Ash, Beige, Gold, Copper, Rose, Silver, Natural, Clear). Do NOT use level codes.**'
  },
  // Semi
  'Wella Color Fresh': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Ready-to-use acidic semi.'
  },
  'Goldwell Elumen': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Use Elumen Prepare/Lock support; no developer.'
  },
  'Pravana ChromaSilk Vivids': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; dilute with Clear if needed.'
  },
  'Schwarzkopf Chroma ID': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; dilute with Clear Bonding Mask.'
  },
  'Matrix SoColor Cult': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye (no developer).'
  },
};

// ---------------------------------------------------------------------------
// Canonicalisation helpers for brand names
function canonList(arr) {
  const map = new Map();
  for (const label of arr) map.set(label.toLowerCase(), label);
  return map;
}
const DEMI_MAP = canonList(DEMI_BRANDS);
const PERM_MAP = canonList(PERMANENT_BRANDS);
const SEMI_MAP = canonList(SEMI_BRANDS);

function normalizeBrand(category, input) {
  const s = (input || '').trim().toLowerCase();
  const pool =
    category === 'permanent' ? PERM_MAP :
    category === 'semi'      ? SEMI_MAP  :
                               DEMI_MAP;
  if (pool.has(s)) return pool.get(s);
  return null;
}

// ---------------------------------------------------------------------------
// Enforce ratio/developer and formula consistency
function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule) return null;
  const dev = (rule.developer || '').split(/[,;|]/)[0];
  return dev.trim();
}

// Insert ratio and developer into a formula string if missing
function enforceRatioAndDeveloper(formula, brand) {
  const rule = BRAND_RULES[brand];
  if (!rule) return formula;
  let out = (formula || '').trim();
  const devName = canonicalDeveloperName(brand);
  if (devName && !new RegExp(devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) {
    if (/ with /i.test(out)) out = out.replace(/ with /i, ` with ${devName} `);
    else out = `${out} with ${devName}`;
  }
  const r = (rule.ratio || '').trim();
  const isSimpleRatio = /^(\d+(\.\d+)?):(\d+(\.\d+)?)$/.test(r);
  if (isSimpleRatio) {
    const ratioRegex = /(\d+(\.\d+)?)[ ]*:[ ]*(\d+(\.\d+)?)/;
    if (!ratioRegex.test(out)) {
      if (/ with /i.test(out)) out = out.replace(/ with /i, ` (${r}) with `);
      else out = `${out} (${r})`;
    }
  }
  return out.trim();
}

function fixStep(step, brand) {
  if (!step) return null;
  const patched = { ...step };
  if (patched.formula) patched.formula = enforceRatioAndDeveloper(patched.formula, brand);
  return patched;
}

// brand timing overrides
function timingOverride(step, brand) {
  if (!step) return step;
  const s = { ...step };
  if (brand === 'Pravana ChromaSilk Express Tones') {
    s.timing = 'Process 5 minutes only; watch visually.';
  }
  return s;
}

function enforceBrandConsistency(out, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  const patched = { ...out, scenarios: out.scenarios.map(sc => {
    const s = { ...sc };
    s.roots = timingOverride(fixStep(s.roots, brand), brand);
    s.melt  = timingOverride(fixStep(s.melt,  brand), brand);
    s.ends  = timingOverride(fixStep(s.ends,  brand), brand);
    return s;
  })};
  return patched;
}

// Shade format validators
const BRAND_PATTERNS = {
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Pravana ChromaSilk Express Tones': [/^\s*(?:Platinum|Violet|Ash|Beige|Gold|Copper|Rose|Silver|Natural|Clear)\b/i],
  // Semi
  'Wella Color Fresh': [/^\s*(?:\d{1,2}\.\d|\d{1,2})\b/],
  'Goldwell Elumen': [/^\s*(?:@[\w]+|\w+-\w+|\w{1,2}\d{1,2})\b/],
  'Pravana ChromaSilk Vivids': [/^\s*(?:VIVIDS|Silver|Clear|Magenta|Pink|Blue|Green|Yellow|Orange|Red|Purple)\b/i],
  'Schwarzkopf Chroma ID': [/^\s*(?:\d{1,2}-\d{1,2}|Clear|Bonding)\b/i],
  'Matrix SoColor Cult': [/^\s*(?:Clear|Neon|Pastel|Teal|Pink|Blue|Purple|Red)\b/i],
};

function stepHasAllowedCodes(step, brand) {
  if (!step || !step.formula) return true;
  const pats = BRAND_PATTERNS[brand] || [];
  if (pats.length === 0) return true;
  return pats.some(rx => rx.test(step.formula));
}

// Express tones guard
function expressTonesGuard(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios) || brand !== 'Pravana ChromaSilk Express Tones') return out;
  const a = (analysis || '').toLowerCase();
  const isJetBlack = /\b(level\s*1|level\s*2|jet\s*black|solid\s*black)\b/.test(a);
  const wantsVividRed = /\b(vivid|vibrant|rich)\s+red\b/.test(a) || /\b(cherry|ruby|crimson|scarlet)\b/.test(a);
  if (isJetBlack) {
    const ends = { formula: 'N/A — Express Tones require pre-lightened level 8–10; use PRAVANA VIVIDS or a permanent plan.', timing: '', note: null };
    out.scenarios = [{ title: 'Primary plan', condition: null, target_level: null, roots: null, melt: null, ends, processing: ['Not applicable for this photo with Express Tones.'], confidence: 0.85 }];
    return out;
  }
  if (wantsVividRed) {
    const ends = { formula: 'N/A — Express Tones are toners. For saturated red, formulate with PRAVANA VIVIDS Red/Copper; optional quick 5-min Express Tones Rose overlay only on pre-lightened hair.', timing: '', note: null };
    out.scenarios = [{ title: 'Primary plan', condition: null, target_level: null, roots: null, melt: null, ends, processing: ['Use PRAVANA VIVIDS for saturation; gloss later if needed.'], confidence: 0.85 }];
    return out;
  }
  const wantsWarmBlonde = /\b(warm|golden|honey|caramel)\b.*\bblonde\b/.test(a) || /\bwarm blonde\b/.test(a);
  if (wantsWarmBlonde && out.scenarios[0]) {
    const s = out.scenarios[0];
    const ends = s.ends || { formula: '', timing: '', note: null };
    ends.formula = 'Beige + Gold (1:1.5) with PRAVANA Zero Lift Creme Developer';
    ends.timing = 'Process 5 minutes only; watch visually.';
    out.scenarios[0] = { ...s, ends };
  }
  return out;
}

// Alternate/primary validators
function isBlackOrSingleVivid(analysis) {
  const a = (analysis || '').toLowerCase();
  const black = /\b(level\s*[12]\b|solid\s*black)\b/.test(a);
  const vividHint = /\b(single\s+vivid|vivid|fashion\s+shade|magenta|pink|blue|green|purple|teal|neon)\b/.test(a);
  return black || vividHint;
}

function extractNumericLevels(text) {
  const levels = [];
  const rx = /\b0?([1-9]|1[0-2])\s*[A-Z@]?/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n)) levels.push(n);
  }
  return levels;
}

function altHasHighLevelToner(sc) {
  const parts = [sc?.roots?.formula, sc?.melt?.formula, sc?.ends?.formula].filter(Boolean).join(' ');
  const lvls = extractNumericLevels(parts);
  return lvls.some(n => n >= 7);
}

function applyValidator(out, category, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (category === 'permanent') return out;
  const patched = { ...out };
  patched.scenarios = out.scenarios.map(sc => {
    const s = { ...sc };
    const title = (s.title || '').toLowerCase();
    const isAlternate = title.includes('alternate');
    if (!isAlternate) return s;
    if (isBlackOrSingleVivid(out.analysis) || altHasHighLevelToner(s)) {
      s.na = true;
      s.note = 'Not applicable for this photo/brand line.';
      return s;
    }
    const rootsOK = stepHasAllowedCodes(s.roots, brand);
    const meltOK  = stepHasAllowedCodes(s.melt,  brand);
    const endsOK  = stepHasAllowedCodes(s.ends,  brand);
    if (!(rootsOK && meltOK && endsOK)) {
      s.na = true;
      s.note = 'Not applicable for this photo/brand line.';
    }
    return s;
  });
  return patched;
}

function validatePrimaryScenario(out, brand) {
  if (!out || !Array.isArray(out.scenarios) || out.scenarios.length === 0) return out;
  const s = out.scenarios[0];
  const rootsOK = stepHasAllowedCodes(s.roots, brand);
  const meltOK  = stepHasAllowedCodes(s.melt,  brand);
  const endsOK  = stepHasAllowedCodes(s.ends,  brand);
  if (!(rootsOK && meltOK && endsOK)) {
    s.processing = s.processing || [];
    s.processing.unshift('Adjusted: removed non-brand shade codes.');
    if (s.roots && !rootsOK && s.roots.formula) s.roots.formula = s.roots.formula.replace(/^[^\s]+/, '').trim();
    if (s.melt  && !meltOK  && s.melt.formula)  s.melt.formula  = s.melt.formula.replace(/^[^\s]+/, '').trim();
    if (s.ends  && !endsOK  && s.ends.formula)  s.ends.formula  = s.ends.formula.replace(/^[^\s]+/, '').trim();
  }
  return out;
}

// Neutral black enforcement
const N_SERIES_BLACK_BRANDS = new Set([
  'Redken Shades EQ',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
]);

function isLevel12Black(analysis) {
  const a = (analysis || '').toLowerCase();
  return /\b(level\s*1(\s*[-–]\s*2)?|level\s*2|deep\s+black|jet\s+black|solid\s+black)\b/.test(a);
}

function replace1Awith1N(step) {
  if (!step || !step.formula) return step;
  return { ...step, formula: step.formula.replace(/\b1A\b/g, '1N') };
}

function enforceNeutralBlack(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (!N_SERIES_BLACK_BRANDS.has(brand)) return out;
  if (!isLevel12Black(analysis)) return out;
  const scenarios = out.scenarios.map(sc => {
    const s = { ...sc };
    s.roots = replace1Awith1N(s.roots);
    s.melt  = replace1Awith1N(s.melt);
    s.ends  = replace1Awith1N(s.ends);
    return s;
  });
  return { ...out, scenarios };
}

// Prompt builders
const SHARED_JSON_SHAPE = `
Return JSON only, no markdown. Use exactly this shape:

{
  "analysis": "<1 short sentence>",
  "scenarios": [
    {
      "title": "Primary plan",
      "condition": null,
      "target_level": null,
      "roots": null | { "formula": "...", "timing": "...", "note": null },
      "melt":  null | { "formula": "...", "timing": "...", "note": null },
      "ends":  { "formula": "...", "timing": "...", "note": null },
      "processing": ["Step 1...", "Step 2...", "Rinse/condition..."],
      "confidence": 0.0
    },
    { "title": "Alternate (cooler)", "condition": null, "target_level": null, "roots": null|{...}, "melt": null|{...}, "ends": {...}, "processing": ["..."], "confidence": 0.0 },
    { "title": "Alternate (warmer)", "condition": null, "target_level": null, "roots": null|{...}, "melt": null|{...}, "ends": {...}, "processing": ["..."], "confidence": 0.0 }
  ]
}`.trim();

function brandRuleLine(brand) {
  const r = BRAND_RULES[brand];
  if (!r) return '';
  return `Official mixing rule for ${brand}: ratio ${r.ratio}; developer/activator: ${r.developer}. ${r.notes}`;
}

function buildSystemPrompt(category, brand) {
  const header = `You are Formula Guru, a master colorist. Use only: "${brand}". Output must be JSON-only and match the app schema.`;
  const brandRule = brandRuleLine(brand);
  const ratioGuard = `
IMPORTANT — MIXING RULES
- Use the **official mixing ratio shown below** for ${brand} in ALL formula strings.
- Include the **developer/activator product name** exactly as provided below when applicable.
- Only use exception ratios (e.g., high-lift or pastel/gloss) if clearly relevant, and state the reason.
${brandRule}
`.trim();
  if (category === 'permanent') {
    return `
${header}

CATEGORY = PERMANENT (root gray coverage)
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % (<25%, 25–50%, 50–75%, 75–100%) and provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Include **developer volume and the exact ratio** in the ROOTS formula (e.g., "6N + 6.3 (${BRAND_RULES[brand]?.ratio || '1:1'}) with 20 vol <developer>").
- Provide a compatible mids/ends plan (refresh vs. band control).
- Processing must call out: sectioning, application order (roots → mids → ends), timing, and rinse/aftercare.
- Return exactly 3 scenarios: Primary, Alternate (cooler), Alternate (warmer).

${SHARED_JSON_SHAPE}
`.trim();
  }
  if (category === 'semi') {
    return `
${header}

CATEGORY = SEMI-PERMANENT (direct/acidic deposit-only; ${brand})
${ratioGuard}

Rules:
- **No developer** in formulas (RTU where applicable). Use brand Clear/diluter for sheerness.
- Do not promise full grey coverage; you may blend/soften the appearance of grey.
- Return up to 3 scenarios:
  - Primary (always required)
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic and available**.
- If the photo shows level 1–2 / jet black, mark alternates **Not applicable**.
- Do not invent shade codes. Only use codes that exist for ${brand}.

${SHARED_JSON_SHAPE}
`.trim();
  }
  // Demi
  return `
${header}

CATEGORY = DEMI (gloss/toner; brand-consistent behavior)
${ratioGuard}

Rules:
- Gloss/toner plans only from ${brand}. In **every formula**, include the ratio and the **developer/activator name**.
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return up to 3 scenarios:
  - Primary (always required)
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic and available**.
- If level 1–2 black or single-vivid context, mark alternates **Not applicable**.
- Do not invent shade codes. Only use codes that exist for ${brand}.

${SHARED_JSON_SHAPE}
`.trim();
}

// Call OpenAI vision for analysis
async function chatAnalyze({ category, brand, dataUrl }) {
  const system = buildSystemPrompt(category, brand);
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Analyze the attached photo. Category: ${category}. Brand: ${brand}. Provide 3 scenarios following the JSON schema.` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ],
    },
  ];
  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.25,
    response_format: { type: 'json_object' },
  });
  const text = resp.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : { analysis: 'Parse error', scenarios: [] };
  }
}

// ---------------------------------------------------------------------------
// Local assistant logic for action extraction and brand Q&A

// Service keywords and phrases for intent detection
const SERVICE_KEYWORDS = [
  'balayage', 'haircut', 'hair cut', 'color', 'colour', 'highlights', 'highlight',
  'trim', 'blowout', 'blow‑dry', 'root touchup', 'root touch up', 'toner', 'extensions',
  'consultation', 'appointment', 'style', 'perm', 'updo'
];
const BOOKING_PHRASES = ['book', 'schedule', 'set up', 'set‑up', 'reserve', 'make', 'create appointment', 'add appointment', 'appointment'];
const CANCEL_PHRASES = ['cancel appointment', 'cancel', 'delete appointment', 'remove appointment', 'reschedule'];
const CREATE_CLIENT_PHRASES = ['new client', 'add client', 'add a client', 'add new client', 'create client', 'register client'];
const DELETE_CLIENT_PHRASES = ['delete client', 'remove client', 'cancel client'];
const GENERIC_WORDS = new Set(['i','me','you','we','us','they','them','he','she','it','my','our','your','their','clients','client','appointment','appointments','book','schedule','cancel','delete','add','new','remove','for','at','on','in','the','a','an']);
const DAYS_OF_WEEK = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const VERB_SET = new Set([
  ...BOOKING_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...CANCEL_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...CREATE_CLIENT_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
  ...DELETE_CLIENT_PHRASES.flatMap(p => p.toLowerCase().split(/\s+/)),
]);
const SERVICE_SET = new Set(SERVICE_KEYWORDS.map(s => s.toLowerCase()));
const BRAND_WORDS_SET = (() => {
  const s = new Set();
  Object.keys(BRAND_RULES).forEach(brand => {
    brand.split(/\s+/).forEach(w => s.add(w.toLowerCase()));
  });
  return s;
})();

// Extract potential client names from a message
function findPotentialNames(text) {
  const names = [];
  const words = text.split(/\s+/);
  for (let token of words) {
    let word = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (!word) continue;
    const first = word[0];
    if (first !== first.toUpperCase()) continue;
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
  const sorted = [...SERVICE_KEYWORDS].sort((a,b) => b.length - a.length);
  for (const s of sorted) {
    if (lower.includes(s.toLowerCase())) return s;
  }
  return null;
}

// Parse relative date/time phrases into ISO strings
function parseDateTime(msg, timezone, nowIso) {
  const lower = msg.toLowerCase();
  const now = nowIso ? new Date(nowIso) : new Date();
  let offset = null;
  let matchedWeekday = null;
  if (lower.includes('tomorrow')) offset = 1;
  else if (lower.includes('today')) offset = 0;
  // next <day>
  for (let i = 0; i < DAYS_OF_WEEK.length; i++) {
    const day = DAYS_OF_WEEK[i];
    if (lower.includes('next ' + day)) {
      matchedWeekday = i;
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
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

// Detect if message contains known brand queries and return mixing info lines
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

// Synthesize actions (create/delete client/appointment) based on message and context
function extractActions(msg, context, timezone, nowIso) {
  const actions = [];
  const lower = msg.toLowerCase();
  const isBooking = BOOKING_PHRASES.some(ph => lower.includes(ph));
  const isCancelAppt = CANCEL_PHRASES.some(ph => lower.includes(ph));
  const isCreateClient = CREATE_CLIENT_PHRASES.some(ph => lower.includes(ph));
  const isDeleteClient = DELETE_CLIENT_PHRASES.some(ph => lower.includes(ph));
  const names = findPotentialNames(msg);
  const service = extractService(msg);
  const dateISO = parseDateTime(msg, timezone, nowIso);
  if (isBooking) {
    const clientName = names.length > 0 ? names[0] : null;
    if (clientName && !context.clients.some(n => n.toLowerCase() === clientName.toLowerCase())) {
      actions.push({ type: 'createClient', payload: { name: clientName } });
    }
    const payload = { title: service ? service.charAt(0).toUpperCase() + service.slice(1) : 'Appointment' };
    if (dateISO) payload.dateISO = dateISO;
    if (clientName) payload.clientName = clientName;
    if (service) payload.serviceType = service;
    actions.push({ type: 'createAppointment', payload });
  }
  if (isCancelAppt) {
    const clientName = names.length > 0 ? names[0] : null;
    const payload = { title: service ? service.charAt(0).toUpperCase() + service.slice(1) : 'Appointment' };
    if (dateISO) payload.dateISO = dateISO;
    if (clientName) payload.clientName = clientName;
    actions.push({ type: 'deleteAppointment', payload });
  }
  if (isCreateClient && !isBooking) {
    names.forEach(nm => {
      if (!context.clients.some(c => c.toLowerCase() === nm.toLowerCase())) {
        actions.push({ type: 'createClient', payload: { name: nm } });
      }
    });
  }
  if (isDeleteClient) {
    names.forEach(nm => {
      if (context.clients.some(c => c.toLowerCase() === nm.toLowerCase())) {
        actions.push({ type: 'deleteClient', payload: { name: nm } });
      }
    });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Routes

// Brands endpoint (categories)
app.get('/brands', (_req, res) => {
  res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS });
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Photo analysis endpoint
app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded (field 'photo')." });
    const categoryRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent','semi','demi'].includes(categoryRaw) ? categoryRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand) || (category === 'permanent' ? PERMANENT_BRANDS[0] : category === 'semi' ? SEMI_BRANDS[0] : DEMI_BRANDS[0]);
    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;
    let out = await chatAnalyze({ category, brand, dataUrl });
    // Enforce manufacturer rules and apply guards
    out = enforceBrandConsistency(out, brand);
    out = expressTonesGuard(out, out.analysis, brand);
    out = enforceNeutralBlack(out, out.analysis, brand);
    out = applyValidator(out, category, brand);
    out = validatePrimaryScenario(out, brand);
    // Collapse to a single scenario for demi/semi
    if (category !== 'permanent' && Array.isArray(out.scenarios)) {
      const primary = out.scenarios.find(s => (s.title || '').toLowerCase().includes('primary')) || out.scenarios[0];
      out.scenarios = primary ? [primary] : [];
    }
    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Upstream error', detail: String(err?.message || err) });
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch {}
    }
  }
});

// Assistant endpoint: local parsing with fallback to OpenAI Q&A
app.post('/assistant', async (req, res) => {
  try {
    const body = req.body || {};
    const message = (body.message || '').trim();
    const timezone = body.timezone || 'America/Los_Angeles';
    const nowISO = body.nowISO || new Date().toISOString();
    const context = body.context || {};
    context.clients = Array.isArray(context.clients) ? context.clients : [];
    context.appointments = Array.isArray(context.appointments) ? context.appointments : [];
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }
    // Brand Q&A (mixing rules)
    const info = detectBrandInfo(message);
    if (info.length > 0) {
      return res.json({ reply: info.join('\n'), actions: [], warnings: [] });
    }
    // Abilities
    const lower = message.toLowerCase();
    if (lower.includes('abilities') || lower.includes('what can you do')) {
      const reply = 'I can answer questions about hair colour brands and formulas. I can also help you add, remove or view clients, and schedule, modify or cancel appointments. Just ask me what you need.';
      return res.json({ reply, actions: [], warnings: [] });
    }
    const actions = extractActions(message, context, timezone, nowISO);
    if (actions.length > 0) {
      return res.json({ reply: 'Here are the proposed actions.', actions, warnings: [] });
    }
    // Fallback to OpenAI for general Q&A
    if (!process.env.OPENAI_API_KEY) {
      return res.json({ reply: "I couldn’t find an answer. Try rephrasing or ask a specific brand question.", actions: [] });
    }
    const systemPrompt = `You are StylistSync, an expert salon assistant. Give brand-accurate, manufacturer-safe guidance. When asked for formulas, include brand-correct mixing ratios and developers; include timing ranges, strand tests, and caveats. For pricing questions: outline factors and a reasonable range; do not guarantee outcomes.`;
    const gptResp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.4,
    });
    const reply = gptResp.choices?.[0]?.message?.content?.trim() || "I couldn’t find an answer. Try rephrasing or ask a specific brand question.";
    return res.json({ reply, actions: [] });
  } catch (err) {
    console.error('assistant error', err);
    return res.status(500).json({ error: 'assistant_failed' });
  }
});

// ---------------------------------------------------------------------------
// Start server
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Unified StylistSync server running on :${PORT}`);
  });
}

export default app;
