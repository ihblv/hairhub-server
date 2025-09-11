// server.mjs — Formula Guru 2 (final w/ Pravana Express Tones guard + 1N black fix)
// Category-aware (Permanent / Demi / Semi) with manufacturer mixing rules
// Enforces ratios + developer names, validates shade formats, && adds
// analysis-aware guard for Pravana ChromaSilk Express Tones suitability.
// Also normalizes level-1/2 black to 1N (not 1A) on supported DEMI lines.
// ------------------------------------------------------------------

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

// ----------------------------- Brand Catalogs ------------------------------
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

// ------------------------ Manufacturer Mixing Rules ------------------------
const BRAND_RULES = {
  // PERMANENT
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

  // DEMI (deposit-only)
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

// ------------------------------ Utilities ----------------------------------
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

  // fuzzy
  for (const [k, v] of pool.entries()) {
    const head = k.split(' ')[0];
    const tail = k.split(' ').slice(-1)[0];
    if (s.includes(head) && s.includes(tail)) return v;
    if (s.includes(head) || s.includes(tail)) return v;
  }
  // defaults
  if (category === 'permanent') return 'Redken Color Gels Lacquers';
  if (category === 'semi')      return 'Wella Color Fresh';
  return 'Redken Shades EQ';
}

// developer display name (short)
function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule || !rule.developer || rule.developer === 'None') return null;
  let first = rule.developer.split(/\s*\/\s*|\s+or\s+|\s+OR\s+/)[0];
  first = first.replace(/\d+%/g, '')
               .replace(/\b(10|20|30|40)\s*vol(ume)?\b/ig, '')
               .replace(/\([^)]*\)/g, '')
               .replace(/\s{2,}/g, ' ')
               .trim();
  return first || null;
}

// Insert ratio + developer where missing
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

// -------------------------- Shade Format Validators -------------------------
const BRAND_PATTERNS = {
  // DEMI
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  // Names only for Express Tones:
  'Pravana ChromaSilk Express Tones': [/^\s*(?:Platinum|Violet|Ash|Beige|Gold|Copper|Rose|Silver|Natural|Clear)\b/i],

  // SEMI
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

// -------------------- Analysis-aware guard (Pravana Express) ----------------
function expressTonesGuard(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios) || brand !== 'Pravana ChromaSilk Express Tones') return out;
  const a = (analysis || '').toLowerCase();

  const isJetBlack = /\b(level\s*1|level\s*2|jet\s*black|solid\s*black)\b/.test(a);
  const wantsVividRed = /\b(vivid|vibrant|rich)\s+red\b/.test(a) || /\b(cherry|ruby|crimson|scarlet)\b/.test(a);

  // Not suitable on level 1–2 black (don't suggest Clear)
  if (isJetBlack) {
    const ends = { formula: 'N/A — Express Tones require pre-lightened level 8–10; use PRAVANA VIVIDS || a permanent plan.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan',
      condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Not applicable for this photo with Express Tones.'],
      confidence: 0.85
    }];
    return out;
  }

  // For vivid/rich red inspo, Rose won’t create saturation: recommend Vivids first
  if (wantsVividRed) {
    const ends = { formula: 'N/A — Express Tones are toners. For saturated red, formulate with PRAVANA VIVIDS Red/Copper; optional quick 5-min Express Tones Rose overlay only on pre-lightened hair.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan',
      condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Use PRAVANA VIVIDS for saturation; gloss later if needed.'],
      confidence: 0.85
    }];
    return out;
  }

  // Warm blonde steer
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

// --------------------- Alternate/Primary validators (generic) ---------------
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

// Validate primary too (prevents cross-brand codes)
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

// -------------------- NEW: Normalize 1–2 black to 1N on supported lines -----
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

// ---------------------------- Prompt Builders ------------------------------
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
}
`.trim();

function brandRuleLine(brand) {
  const r = BRAND_RULES[brand];
  if (!r) return '';
  return `Official mixing rule for ${brand}: ratio ${r.ratio}; developer/activator: ${r.developer}. ${r.notes}`;
}

function buildSystemPrompt(category, brand) {
  const header = `You are Formula Guru, a master colorist. Use only: "${brand}". Output must be JSON-only && match the app schema.`;
  const brandRule = brandRuleLine(brand);
  const ratioGuard = `
IMPORTANT — MIXING RULES
- Use the **official mixing ratio shown below** for ${brand} in ALL formula strings.
- Include the **developer/activator product name** exactly as provided below when applicable.
- Only use exception ratios (e.g., high-lift || pastel/gloss) if clearly relevant, && state the reason.
${brandRule}
`.trim();

  if (category === 'permanent') {
    return `
${header}

CATEGORY = PERMANENT (root gray coverage)
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % (<25%, 25–50%, 50–75%, 75–100%) && provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Include **developer volume && the exact ratio** in the ROOTS formula (e.g., "6N + 6.3 (${BRAND_RULES[brand]?.ratio || '1:1'}) with 20 vol <developer>").
- Provide a compatible mids/ends plan (refresh vs. band control).
- Processing must call out: sectioning, application order (roots → mids → ends), timing, && rinse/aftercare.
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
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic && available**.
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
- Gloss/toner plans only from ${brand}. In **every formula**, include the ratio && the **developer/activator name**.
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return up to 3 scenarios:
  - Primary (always required)
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic && available**.
- If level 1–2 black || single-vivid context, mark alternates **Not applicable**.
- Do not invent shade codes. Only use codes that exist for ${brand}.

${SHARED_JSON_SHAPE}
`.trim();
}

// -------------------------- OpenAI Call Helper -----------------------------
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

// --------------------------------- Routes ----------------------------------
app.get('/brands', (req, res) => {
  res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded (field 'photo')." });

    const categoryRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent', 'semi', 'demi'].includes(categoryRaw) ? categoryRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand);

    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;

    let out = await chatAnalyze({ category, brand, dataUrl });

    // 1) Enforce brand ratio/dev + timing overrides
    out = enforceBrandConsistency(out, brand);

    // 2) Suitability guard for Pravana Express Tones
    out = expressTonesGuard(out, out.analysis, brand);

    // 3) Normalize 1–2 black to 1N on supported lines
    out = enforceNeutralBlack(out, out.analysis, brand);

    // 4) Validate alternates (Demi/Semi)
    out = applyValidator(out, category, brand);

    // 5) Validate Primary scenario as well
    out = validatePrimaryScenario(out, brand);

    // 6) Collapse to a single scenario for Demi/Semi
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

// ------------------------------- Start Server -------------------------------
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  

// ------------------------------ StylistSync Assistant ------------------------------

app.post('/assistant', async (req, res) => {
  try {
    const { message, timezone = "America/Los_Angeles", nowISO, context = {} } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Missing message' });
    }
    const now = nowISO ? new Date(nowISO) : new Date();

    // Helper: get offset like "-07:00" from an ISO string (fallback -07:00)
    const offsetFromISO = (iso) => {
      const m = typeof iso === "string" ? iso.match(/([+-]\d{2}:\d{2})$/) : null;
      return m ? m[1] : "-07:00";
    };
    const ptOffset = offsetFromISO(nowISO || new Date().toISOString());

    // Parse simple phrases like "this Monday 2pm", "upcoming Monday at 2:30 pm"
    const weekdayIndex = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
    function resolveWeekday(phrase) {
      const s = phrase.toLowerCase();
      const wk = Object.keys(weekdayIndex).find(d => s.includes(d));
      if (!wk) return null;
      let hh = 9, mm = 0;
      let timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      if (timeMatch) {
        hh = parseInt(timeMatch[1],10);
        mm = timeMatch[2] ? parseInt(timeMatch[2],10) : 0;
        const ampm = timeMatch[3];
        if (ampm === 'pm' && hh < 12) hh += 12;
        if (ampm === 'am' && hh === 12) hh = 0;
      }
      const tgtDow = weekdayIndex[wk];
      const nowPT = new Date(now);
      const dow = nowPT.getUTCDay();
      let add = (tgtDow - dow + 7) % 7;
      const isNext = /next|upcoming/.test(s) || (/this/.test(s) && add===0);
      if (add === 0 || isNext) add += 7;
      const target = new Date(nowPT.getTime() + add*24*3600*1000);
      const yyyy = target.getUTCFullYear();
      const mm2 = String(target.getUTCMonth()+1).padStart(2,'0');
      const dd2 = String(target.getUTCDate()).padStart(2,'0');
      const HH = String(hh).padStart(2,'0');
      const MM = String(mm).padStart(2,'0');
      const iso = `${yyyy}-${mm2}-${dd2}T${HH}:${MM}:00${ptOffset}`;
      return iso;
    }

    function extractSlots(text) {
      const slots = {};
      const mWeekday = text.toLowerCase().match(/\b(this|upcoming|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (mWeekday) {
        const iso = resolveWeekday(text);
        if (iso) slots.dateISO = iso;
      }
      const mTime = text.toLowerCase().match(/at\s+(\d{1,2}(:\d{2})?\s*(am|pm)?)/);
      if (mTime && !slots.dateISO) {
        const timeStr = mTime[1];
        const iso = resolveWeekday(`next monday ${timeStr}`); // fallback to next Monday if only time provided
        if (iso) slots.dateISO = iso;
      }
      const mClientNamed = text.match(/named\s+([A-Za-z][\w'-]+)/i) || text.match(/\bfor\s+([A-Za-z][\w'-]+)\b/i);
      if (mClientNamed) slots.clientName = mClientNamed[1];
      const mService = text.match(/\bfor\s+(a\s+)?([A-Za-z ]+?)(?:\s+for|\s+at|\s+\$|\s+\d|\s*$)/i);
      if (mService) {
        const svc = mService[2].trim();
        if (!/appointment|client|me|named|this|next|upcoming|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(svc)) {
          slots.serviceType = svc[0].toUpperCase() + svc.slice(1);
          slots.title = slots.serviceType;
        }
      }
      const mPrice = text.match(/\$?\s*(\d{2,4})(?:\.\d{2})?\b/);
      if (mPrice) slots.price = Number(mPrice[1]);
      const mDur = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|min|minutes)/i);
      if (mDur) {
        const n = parseFloat(mDur[1]);
        let mins = 0;
        if (/min/.test(mDur[2])) mins = Math.round(n);
        else mins = Math.round(n*60);
        slots.durationMinutes = mins;
      }
      return slots;
    }

    const sys = `You are StylistSync — an AI hairstylist assistant inside an iOS app.

Rules:
- Always return strict JSON with keys "reply" (string), "actions" (array), "warnings" (array).
- For requests to book/create/delete/adjust in-app, you MUST include structured actions.
- Timezone is ${timezone}. "now" is ${now.toISOString()}. If user says "this/upcoming/next Monday 2pm", resolve to the nearest FUTURE date in PT && return ISO with offset like 2025-09-15T14:00:00-07:00.
- Prefer clientName over IDs. If client not found in context, include a warning that it will be created.
- Do NOT mutate data; only propose actions.

Context (names only):
clients: ${(context.clients||[]).slice(0,50).join(", ")}
appt count: ${(context.appointments||[]).length}`;

    const userMsg = String(message);

    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || "";
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    const wantsAction = /(book|schedule|add|create|delete|cancel|adjust|reschedule)/i.test(userMsg) && /(appointment|client|inventory|product)/i.test(userMsg);
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings : [];

    if (wantsAction && actions.length === 0) {
      const slots = extractSlots(userMsg);
      const synthesized = [];

      if (slots.clientName && !(context.clients||[]).some(n => (n||"").toLowerCase() === slots.clientName.toLowerCase())) {
        synthesized.push({ type: "createClient", payload: { name: slots.clientName, contact: null, notes: null } });
        warnings.push(`Client '${slots.clientName}' not found; will be created.`);
      }

      if (slots.dateISO) {
        synthesized.push({
          type: "createAppointment",
          payload: {
            title: slots.title || "Appointment",
            dateISO: slots.dateISO,
            clientName: slots.clientName || null,
            notes: null,
            serviceType: slots.serviceType || null,
            durationMinutes: slots.durationMinutes || 60,
            price: slots.price || null
          }
        });

        const appts = Array.isArray(context.appointments) ? context.appointments : [];
        const conflict = appts.find(a => a.dateISO && a.dateISO === slots.dateISO);
        if (conflict) warnings.push(`Time ${slots.dateISO} overlaps with '${conflict.title}' for ${conflict.clientName || "someone"}.`);
      }

      parsed = {
        reply: parsed?.reply || "Here’s what I can do:",
        actions: synthesized,
        warnings
      };
    }

    if (!parsed) parsed = { reply: raw || "I’m here to help.", actions: [], warnings: [] };
    if (typeof parsed.reply !== 'string') parsed.reply = String(parsed.reply ?? '');
    if (!Array.isArray(parsed.actions)) parsed.actions = [];
    if (!Array.isArray(parsed.warnings)) parsed.warnings = [];

    res.json(parsed);
  } catch (err) {
    console.error('assistant error', err);
    res.status(500).json({ error: 'assistant_failed' });
  }
}););
app.listen(PORT, () => console.log(`Formula Guru server running on :${PORT}`));
}

export default app;
