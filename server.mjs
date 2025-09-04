// server.mjs — Formula Guru 2 (refactored)
//
// This server provides color formulation assistance for hair colourists.
// It calls OpenAI’s GPT‑4o model with brand‑specific prompts, injects the
// appropriate mixing ratios and developer names, applies sanity checks
// around code format and mixing instructions, and returns a consistent
// JSON schema to the iOS client. Validation is pattern‑based, favouring
// correct formats over exhaustive shade lists so that legitimate but
// previously unseen codes can still pass when they match a brand’s
// numbering scheme.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import { OpenAI } from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ dest: process.env.UPLOAD_DIR || 'tmp/' });

// ---------------------------- OpenAI Setup ----------------------------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ------------------------- Brand Catalogs ------------------------------
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

// -------------------------- Manufacturer Rules -------------------------
// Each brand has a defined mixing ratio, developer and some notes. The
// ratio field may be "RTU" (ready‑to‑use) indicating no mixing needed.
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
    notes: 'Standard Majirel 1:1.5 (high lifts may be 1:2).'
  },
  'Matrix SoColor Permanent': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Matrix Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1. (Ultra.Blonde 1:2; HIB 1:1.5).'
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
    notes: 'ChromaSilk 1:1.5 (high lift 1:2).'
  },
  // DEMI (deposit only)
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
    notes: 'Core Colorance 2:1; Gloss Tones 1:1.'
  },
  'Schwarzkopf Igora Vibrance': {
    category: 'demi',
    ratio: '1:1',
    developer: 'IGORA VIBRANCE Activator Gel/Lotion 1.9%/4%',
    notes: 'All shades 1:1.'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: '5‑minute deposit only; shade names only (Platinum, Violet, Ash, Beige, Gold, Copper, Rose, Silver, Natural, Clear).'
  },
  // SEMI (direct or RTU)
  'Wella Color Fresh': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Ready‑to‑use acidic semi.'
  },
  'Goldwell Elumen': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; use Elumen Prepare/Lock; no developer.'
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
    notes: 'Bonding color mask; ready to use.'
  },
  'Matrix SoColor Cult': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; ready to use.'
  },
};

// -------------------------- Pattern Rules -----------------------------
// Regular expressions to validate shade codes for each brand. If a code
// matches its brand’s pattern it will be accepted. This allows new
// legitimate codes to pass without enumerating every shade in the
// manufacturer catalogue. Patterns are conservative enough to reject
// obviously wrong codes (e.g., cross‑brand formats).
const BRAND_PATTERNS = {
  // DEMI
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Pravana ChromaSilk Express Tones': [/^\s*(?:Platinum|Violet|Ash|Beige|Gold|Copper|Rose|Silver|Natural|Clear)\b/i],
  // PERMANENT
  'Redken Color Gels Lacquers': [/^\s*\d{1,2}[A-Z]{1,3}\b/],
  'Wella Koleston Perfect': [/^\s*\d{1,2}\/\d{1,2}\b/],
  'Wella Illumina Color': [/^\s*\d{1,2}\/\d{1,2}\b/],
  'L’Oréal Professionnel Majirel': [/^\s*\d+(?:\.\d+)+\b/],
  'Matrix SoColor Permanent': [/^\s*\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Topchic': [/^\s*\d{1,2}[A-Z]{1,3}\b/],
  'Schwarzkopf Igora Royal': [/^\s*\d{1,2}-\d{1,2}\b/],
  'Pravana ChromaSilk Permanent Crème Color': [/^\s*(?:\d{1,2}\.[\dA-Z]+|\d{1,2}[A-Z]{1,3})\b/],
  // SEMI
  'Wella Color Fresh': [/^\s*(?:\d{1,2}\/\d{1,2}|\d{1,2})\b/],
  'Goldwell Elumen': [/^\s*@?[A-Z]{1,2}[A-Z0-9]*\b/],
  'Pravana ChromaSilk Vivids': [/^\s*[A-Za-z][A-Za-z ]*\b/],
  'Schwarzkopf Chroma ID': [/^\s*(?:\d{1,2}-\d{1,2}|Clear|Bonding|Pastel)\b/i],
  'Matrix SoColor Cult': [/^\s*[A-Za-z][A-Za-z ]*\b/],
};

// Provide a few representative codes for each brand to guide the model. These
// samples are used in the system prompt to illustrate valid formats.
const BRAND_SAMPLES = {
  // DEMI
  'Redken Shades EQ': '07NB, 09V, 06T',
  'Wella Color Touch': '7/43, 8/0, 0/00',
  'Paul Mitchell The Demi': '6A, 8NB, 9GV',
  'Matrix SoColor Sync': '6P, 7RC, 10N',
  'Goldwell Colorance': '7GB, 9K, P03',
  'Schwarzkopf Igora Vibrance': '7-65, 8-0, 9-5',
  'Pravana ChromaSilk Express Tones': 'Rose, Beige, Silver',
  // PERMANENT
  'Redken Color Gels Lacquers': '6NW, 7AB, 9VRo',
  'Wella Koleston Perfect': '7/43, 9/96, 10/0',
  'Wella Illumina Color': '8/37, 9/59, 10/36',
  'L’Oréal Professionnel Majirel': '7.34, 8.13, 10.22',
  'Matrix SoColor Permanent': '7RC, 6AA, UL-A',
  'Goldwell Topchic': '7NA, 5RB, 9G',
  'Schwarzkopf Igora Royal': '7-46, 9-55, 10-0',
  'Pravana ChromaSilk Permanent Crème Color': '6.66, 8N, 10NB',
  // SEMI
  'Wella Color Fresh': '8/03, 10/81, 0/00',
  'Goldwell Elumen': '@RR, @TQ, @Clear',
  'Pravana ChromaSilk Vivids': 'Magenta, Blue, Neon Pink',
  'Schwarzkopf Chroma ID': '9-12, 5-2, Bonding',
  'Matrix SoColor Cult': 'True Blue, Pastel Pink, Neon Yellow',
};

// ------------------------- Brand Helpers ------------------------------
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
  const pool = category === 'permanent' ? PERM_MAP : category === 'semi' ? SEMI_MAP : DEMI_MAP;
  if (pool.has(s)) return pool.get(s);
  // fuzzy match by substring
  for (const [k, v] of pool.entries()) {
    const parts = k.split(' ');
    const head = parts[0];
    const tail = parts[parts.length - 1];
    if (s.includes(head) && s.includes(tail)) return v;
    if (s.includes(head) || s.includes(tail)) return v;
  }
  return category === 'permanent' ? 'Redken Color Gels Lacquers' : category === 'semi' ? 'Wella Color Fresh' : 'Redken Shades EQ';
}

function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule || !rule.developer || rule.developer === 'None') return null;
  let first = rule.developer.split(/\s*\/\s*|\s+or\s+|\s+OR\s+/)[0];
  first = first.replace(/\d+%/g, '')
               .replace(/\b(10|20|30|40)\s*vol(?:ume)?\b/ig, '')
               .replace(/\([^)]*\)/g, '')
               .replace(/\s{2,}/g, ' ')
               .trim();
  return first || null;
}

// Insert ratio and developer into a formula string. If a ratio is defined
// and not already present, it is added in parentheses. The developer
// product name is appended with "with" if missing. RTU brands do not
// receive any ratio or developer additions.
function enforceRatioAndDeveloper(formula, brand) {
  if (!formula) return formula;
  const rule = BRAND_RULES[brand];
  if (!rule) return formula;
  let out = formula.trim();
  // Skip RTU
  if (/RTU/i.test(rule.ratio)) return out;
  // Developer injection
  const devName = canonicalDeveloperName(brand);
  if (devName) {
    const devRx = new RegExp(devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (!devRx.test(out)) {
      if (/\bwith\b/i.test(out)) {
        out = out.replace(/\bwith\b/i, `with ${devName}`);
      } else {
        out = `${out} with ${devName}`;
      }
    }
  }
  // Ratio injection
  const r = (rule.ratio || '').trim();
  const simple = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.test(r);
  if (simple) {
    const ratioRx = /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/;
    if (!ratioRx.test(out)) {
      if (/\bwith\b/i.test(out)) {
        out = out.replace(/\bwith\b/i, `(${r}) with`);
      } else {
        out = `${out} (${r})`;
      }
    }
  }
  return out.trim();
}

// Extract candidate shade codes from a formula string. Codes are assumed
// to precede whitespace or a '+' delimiter and may be separated by plus
// signs. Ratio and developer segments are removed beforehand.
function extractCodes(formula) {
  if (!formula) return [];
  let cleaned = formula.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.split(/\bwith\b/i)[0];
  const parts = cleaned.split('+');
  const codes = [];
  for (const part of parts) {
    const token = part.trim().split(/\s+/)[0];
    if (token) codes.push(token);
  }
  return codes;
}

// Determine whether a shade code conforms to the brand’s regex patterns.
function matchesPattern(code, brand) {
  const pats = BRAND_PATTERNS[brand] || [];
  for (const rx of pats) {
    if (rx.test(code)) return true;
  }
  return false;
}

// Check that a step includes the required ratio and developer for non‑RTU
// brands. For RTU lines, ensure that neither ratio nor developer is
// present. Codes starting with 1A on certain brands will be normalized
// later by a separate function.
function stepHasRatioAndDeveloper(step, brand) {
  if (!step || !step.formula) return true;
  const formula = step.formula;
  // Skip N/A entries
  if (/^\s*n\/a/i.test(formula)) return true;
  const rule = BRAND_RULES[brand];
  if (!rule) return true;
  // RTU: no ratio, no developer
  if (/RTU/i.test(rule.ratio)) {
    if (/\d\s*:\s*\d/.test(formula)) return false;
    if (/\bwith\b/i.test(formula)) return false;
    return true;
  }
  // Must include ratio
  const ratioExpected = rule.ratio.trim();
  const ratioList = [];
  if (brand === 'Goldwell Colorance') {
    // Accept 2:1 or 1:1 for Colorance (core vs gloss tones)
    ratioList.push('2:1', '1:1');
  } else {
    ratioList.push(ratioExpected);
  }
  const ratioPresent = ratioList.some(r => {
    const pattern = new RegExp(r.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s*/g, '\\s*'), 'i');
    return pattern.test(formula);
  });
  if (!ratioPresent) return false;
  // Must include developer
  const devName = canonicalDeveloperName(brand);
  if (devName) {
    const devRx = new RegExp(devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (!devRx.test(formula)) return false;
  }
  return true;
}

// Validate the full response object. All shade codes must match the
// brand’s pattern, and ratio/developer rules must hold. Returns
// { valid: boolean, reason: string }.
function validateOut(out, brand) {
  if (!out || !Array.isArray(out.scenarios)) return { valid: true };
  for (const sc of out.scenarios) {
    for (const key of ['roots','melt','ends']) {
      const step = sc[key];
      if (!step || !step.formula) continue;
      const formula = step.formula;
      if (/^\s*n\/a/i.test(formula)) continue;
      // Codes pattern check
      const codes = extractCodes(formula);
      for (const code of codes) {
        if (!matchesPattern(code, brand)) {
          // Generic fallback: allow alphanumeric codes without slash or hyphen
          const trimmed = code.trim();
          const genericOK = /^[A-Za-z0-9.]+$/.test(trimmed) && !/[\/\-]/.test(trimmed);
          if (!genericOK) {
            return { valid: false, reason: `Unrecognized shade format for ${brand}` };
          }
        }
      }
      // Ratio/developer check
      if (!stepHasRatioAndDeveloper(step, brand)) {
        return { valid: false, reason: `Missing or incorrect ratio/developer for ${brand}` };
      }
    }
  }
  return { valid: true };
}

// ------------------ Express Tones and Neutral Black Guards -------------
// For Pravana Express Tones, we enforce a 5‑minute processing and block
// usage on level 1–2 jet black hair or when a vivid red is desired. For
// certain demi brands we normalise 1A → 1N when analysing level 1–2
// black scenarios.
const N_SERIES_BLACK_BRANDS = new Set([
  'Redken Shades EQ',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
]);

function isLevel12Black(analysis) {
  const a = (analysis || '').toLowerCase();
  return /\b(level\s*1(\s*[-–]\s*2)?|level\s*2|jet\s*black|solid\s*black)\b/.test(a);
}

function replace1Awith1N(step) {
  if (!step || !step.formula) return step;
  return { ...step, formula: step.formula.replace(/\b1A\b/g, '1N') };
}

function enforceNeutralBlack(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (!N_SERIES_BLACK_BRANDS.has(brand)) return out;
  if (!isLevel12Black(analysis)) return out;
  return {
    ...out,
    scenarios: out.scenarios.map(sc => {
      const s = { ...sc };
      s.roots = replace1Awith1N(s.roots);
      s.melt = replace1Awith1N(s.melt);
      s.ends = replace1Awith1N(s.ends);
      return s;
    }),
  };
}

function expressTonesGuard(out, analysis, brand) {
  if (brand !== 'Pravana ChromaSilk Express Tones' || !out || !Array.isArray(out.scenarios)) return out;
  const a = (analysis || '').toLowerCase();
  const isJetBlack = /\b(level\s*1|level\s*2|jet\s*black|solid\s*black)\b/.test(a);
  const wantsVividRed = /\b(vivid|vibrant|rich)\s+red\b/.test(a) || /\b(cherry|ruby|crimson|scarlet)\b/.test(a);
  if (isJetBlack) {
    return {
      analysis: 'Express Tones not suitable for level 1–2 black hair.',
      scenarios: [
        {
          title: 'Primary plan',
          condition: null,
          target_level: null,
          roots: null,
          melt: null,
          ends: { formula: 'N/A — Express Tones require pre‑lightened level 8–10; consider PRAVANA VIVIDS or permanent colour.', timing: '', note: null },
          processing: ['Not applicable for this photo.'],
          confidence: 0.8,
        },
      ],
    };
  }
  if (wantsVividRed) {
    return {
      analysis: 'Express Tones are toners and do not provide vivid saturation.',
      scenarios: [
        {
          title: 'Primary plan',
          condition: null,
          target_level: null,
          roots: null,
          melt: null,
          ends: { formula: 'N/A — For saturated red, use PRAVANA VIVIDS Red/Copper; a 5‑min Rose toner may gloss pre‑lightened hair.', timing: '', note: null },
          processing: ['Use a direct dye for vivid red; optional toner gloss afterwards.'],
          confidence: 0.8,
        },
      ],
    };
  }
  // Always force timing to 5 minutes
  return {
    ...out,
    scenarios: out.scenarios.map(sc => {
      const s = { ...sc };
      const ends = s.ends ? { ...s.ends, timing: 'Process 5 minutes only; watch visually.' } : null;
      return { ...s, ends };
    }),
  };
}

// ---------------------------- Prompt Builder ---------------------------
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
      "processing": ["Step 1...", "Step 2...", "Rinse/condition..."],
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
  const header = `You are Formula Guru, a master colourist. Use only: "${brand}". Output must be JSON‑only and match the app schema.`;
  const ruleLine = brandRuleLine(brand);
  const examples = BRAND_SAMPLES[brand] ? `For example, valid shade codes for this brand include: ${BRAND_SAMPLES[brand]}.` : '';
  const ratioGuard = `\nIMPORTANT — MIXING RULES\n- Use the official mixing ratio shown below for ${brand} in ALL formula strings.\n- Include the developer/activator product name exactly as provided when applicable.\n${ruleLine}\n${examples}`;
  if (category === 'permanent') {
    return `\n${header}\n\nCATEGORY = PERMANENT (root grey coverage)\n${ratioGuard}\n\nRules:\n- Root coverage formulas must include a natural/neutral series shade plus tone to match mids/ends.\n- Always include developer volume and ratio in the roots formula.\n- Provide compatible mids/ends plan (refresh vs band control).\n- Processing must describe sectioning, application order (roots→mids→ends), timing and aftercare.\n- Return exactly 3 scenarios: Primary, Alternate (cooler), Alternate (warmer).\n\n${SHARED_JSON_SHAPE}`;
  }
  if (category === 'semi') {
    return `\n${header}\n\nCATEGORY = SEMI‑PERMANENT (direct/acidic deposit‑only)\n${ratioGuard}\n\nRules:\n- No developer in formulas (RTU where applicable).\n- Use Clear/diluter for sheerness when available.\n- Do not promise full grey coverage; blend the appearance of grey only.\n- Return up to 3 scenarios: Primary, Alternate (cooler) and/or Alternate (warmer) only if realistic.\n- If the photo shows level 1–2 black, mark alternates Not applicable.\n- Do not invent shade codes.\n\n${SHARED_JSON_SHAPE}`;
  }
  // Demi
  return `\n${header}\n\nCATEGORY = DEMI (gloss/toner)\n${ratioGuard}\n\nRules:\n- Include ratio and developer/activator name in every formula.\n- Processing up to ~20 minutes unless brand guidance differs.\n- No lift promises; no grey‑coverage claims.\n- Return up to 3 scenarios: Primary, Alternate (cooler) and/or Alternate (warmer) if realistic.\n- If level 1–2 black or single vivid context, mark alternates Not applicable.\n- Do not invent shade codes.\n\n${SHARED_JSON_SHAPE}`;
}

// -------------------------- OpenAI Call -----------------------------
async function callOpenAI(category, brand, dataUrl, extraSystem = '') {
  const systemPrompt = buildSystemPrompt(category, brand) + (extraSystem ? `\n\n${extraSystem}` : '');
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Analyze the attached photo. Category: ${category}. Brand: ${brand}. Provide up to 3 scenarios following the JSON schema.` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
  const resp = await client.chat.completions.create({ model: MODEL, messages, temperature: 0.25, response_format: { type: 'json_object' } });
  const text = resp.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : { analysis: 'Parse error', scenarios: [] };
  }
}

// --------------------------- Analysis Flow -------------------------
async function generatePlan({ category, brand, dataUrl }) {
  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const extraSystem = attempt === 1 ? 'Use only real codes or names from the selected brand. Include the official ratio and the exact developer name in every formula. Do not invent shade codes.' : '';
    let out = await callOpenAI(category, brand, dataUrl, extraSystem);
    // Normalize formulas: inject ratio/developer
    if (out && Array.isArray(out.scenarios)) {
      out.scenarios = out.scenarios.map(sc => {
        const s = { ...sc };
        const patchStep = st => {
          if (!st || !st.formula) return st;
          return { ...st, formula: enforceRatioAndDeveloper(st.formula, brand) };
        };
        s.roots = patchStep(s.roots);
        s.melt = patchStep(s.melt);
        s.ends = patchStep(s.ends);
        return s;
      });
    }
    // Apply neutral black guard
    out = enforceNeutralBlack(out, out.analysis, brand);
    // Apply Express Tones guard
    out = expressTonesGuard(out, out.analysis, brand);
    // Validate
    const validation = validateOut(out, brand);
    if (validation.valid) {
      // Collapse scenarios for semi/demi categories: use only primary when alternate not realistic
      if (category !== 'permanent' && Array.isArray(out.scenarios)) {
        const primary = out.scenarios.find(s => (s.title || '').toLowerCase().includes('primary')) || out.scenarios[0];
        out.scenarios = primary ? [primary] : [];
      }
      return out;
    }
    lastReason = validation.reason;
  }
  // Safe fallback
  const message = lastReason || `Unrecognized shade(s) for ${brand}`;
  return {
    analysis: message,
    scenarios: [
      {
        title: 'Primary plan',
        condition: null,
        target_level: null,
        roots: null,
        melt: null,
        ends: { formula: `N/A — ${message}.`, timing: '', note: null },
        processing: [message],
        confidence: 0.0,
      },
    ],
  };
}

// ------------------------------- Routes -------------------------------
app.get('/brands', (_req, res) => {
  res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded (field 'photo')." });
    const catRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent','semi','demi'].includes(catRaw) ? catRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand);
    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;
    const out = await generatePlan({ category, brand, dataUrl });
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

// ----------------------------- Self‑test ------------------------------
app.get('/selftest', (_req, res) => {
  const tests = [];
  function addTest(name, fn) {
    try {
      const result = fn();
      tests.push({ name, pass: !!result });
    } catch {
      tests.push({ name, pass: false });
    }
  }
  function buildOut(formula, analysis = '') {
    return {
      analysis,
      scenarios: [
        {
          title: 'Primary plan',
          condition: null,
          target_level: null,
          roots: null,
          melt: null,
          ends: formula ? { formula, timing: '', note: null } : null,
          processing: [],
          confidence: 0.5,
        },
      ],
    };
  }
  // Test pattern acceptance and ratio/developer enforcement across brands
  addTest('Redken Shades EQ valid format', () => {
    const brand = 'Redken Shades EQ';
    const out = buildOut('07NB (1:1) with Shades EQ Processing Solution');
    return validateOut(out, brand).valid;
  });
  addTest('Redken Shades EQ missing developer fails', () => {
    const brand = 'Redken Shades EQ';
    const out = buildOut('07NB (1:1)');
    return !validateOut(out, brand).valid;
  });
  addTest('Wella Koleston Perfect valid', () => {
    const brand = 'Wella Koleston Perfect';
    const out = buildOut('7/43 (1:1) with Welloxon Perfect 6%');
    return validateOut(out, brand).valid;
  });
  addTest('Wella Koleston Perfect invalid pattern', () => {
    const brand = 'Wella Koleston Perfect';
    const out = buildOut('07NB (1:1) with Welloxon Perfect 6%');
    return !validateOut(out, brand).valid;
  });
  addTest('Pravana Express Tones valid name', () => {
    const brand = 'Pravana ChromaSilk Express Tones';
    const out = buildOut('Rose (1:1.5) with PRAVANA Zero Lift Creme Developer');
    return validateOut(out, brand).valid;
  });
  addTest('Pravana Express Tones numeric code fails', () => {
    const brand = 'Pravana ChromaSilk Express Tones';
    const out = buildOut('09NB (1:1.5) with PRAVANA Zero Lift Creme Developer');
    return !validateOut(out, brand).valid;
  });
  addTest('Wella Color Fresh RTU no developer', () => {
    const brand = 'Wella Color Fresh';
    const out = buildOut('8/03');
    return validateOut(out, brand).valid;
  });
  addTest('Wella Color Fresh with ratio fails', () => {
    const brand = 'Wella Color Fresh';
    const out = buildOut('8/03 (1:1) with Developer');
    return !validateOut(out, brand).valid;
  });
  const allPass = tests.every(t => t.pass);
  res.json({ allPass, tests });
});

// ----------------------------- Launch -----------------------------
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Formula Guru server running on :${PORT}`));
}

export default app;
