// server.mjs — Formula Guru 2 (final, calendar-aware assistant, with ensureClientCreate)
// Category-aware (Permanent / Demi / Semi) with manufacturer mixing rules
// Enforces ratios + developer names, validates shade formats, and adds
// analysis-aware guard for Pravana ChromaSilk Express Tones suitability.
// Normalizes level-1/2 black to 1N on supported DEMI lines.
// Extends ONLY /assistant to be calendar-aware with guaranteed action synthesis
// and a local fallback when OpenAI is unavailable.
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
  'Wella Color Fresh': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Ready-to-use acidic semi.' },
  'Goldwell Elumen': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Use Elumen Prepare/Lock support; no developer.' },
  'Pravana ChromaSilk Vivids': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear if needed.' },
  'Schwarzkopf Chroma ID': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye; dilute with Clear Bonding Mask.' },
  'Matrix SoColor Cult': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye (no developer).' },
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
  for (const [k, v] of pool.entries()) {
    const head = k.split(' ')[0];
    const tail = k.split(' ').slice(-1)[0];
    if (s.includes(head) && s.includes(tail)) return v;
    if (s.includes(head) || s.includes(tail)) return v;
  }
  if (category === 'permanent') return 'Redken Color Gels Lacquers';
  if (category === 'semi')      return 'Wella Color Fresh';
  return 'Redken Shades EQ';
}

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
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Pravana ChromaSilk Express Tones': [/^\s*(?:Platinum|Violet|Ash|Beige|Gold|Copper|Rose|Silver|Natural|Clear)\b/i],
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

  if (isJetBlack) {
    const ends = { formula: 'N/A — Express Tones require pre-lightened level 8–10; use PRAVANA VIVIDS || a permanent plan.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan', condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Not applicable for this photo with Express Tones.'], confidence: 0.85
    }];
    return out;
  }
  if (wantsVividRed) {
    const ends = { formula: 'N/A — Express Tones are toners. For saturated red, formulate with PRAVANA VIVIDS Red/Copper; optional quick 5-min Express Tones Rose overlay only on pre-lightened hair.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan', condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Use PRAVANA VIVIDS for saturation; gloss later if needed.'], confidence: 0.85
    }];
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
function validatePrimaryScenario(out, brand) {
  if (!out || !Array.isArray(out.scenarios) || out.scenarios.length === 0) return out;
  const s = out.scenarios[0];
  const rootsOK = stepHasAllowedCodes(s.roots, brand);
  const meltOK  = stepHasAllowedCodes(s.melt,  brand);
  const endsOK  = stepHasAllowedCodes(s.ends,  brand);
  if (!(rootsOK && meltOK && endsOK)) {
    s.processing = s.processing || [];
    s.processing.unshift('Adjusted: removed non-brand shade codes.');
    const dropFirst = (st) => st && st.formula ? { ...st, formula: st.formula.replace(/^[^\s]+/, '').trim() } : st;
    s.roots = dropFirst(s.roots);
    s.melt  = dropFirst(s.melt);
    s.ends  = dropFirst(s.ends);
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
- Only use exception ratios (e.g., high-lift || pastel/gloss) if clearly relevant, and state the reason.
${brandRule}
`.trim();

  if (category === 'permanent') {
    return `
${header}

CATEGORY = PERMANENT (root gray coverage)
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % and provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Include developer volume and the ratio in the ROOTS formula.
- Provide a compatible mids/ends plan.
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
- No developer in formulas (RTU where applicable). Use brand Clear/diluter for sheerness.
- Do not promise full grey coverage.
- Return up to 3 scenarios: Primary (+ optional alternates if realistic).

${SHARED_JSON_SHAPE}
`.trim();
  }
  return `
${header}

CATEGORY = DEMI (gloss/toner; brand-consistent behavior)
${ratioGuard}

Rules:
- Gloss/toner plans only from ${brand}. In every formula, include the ratio and developer/activator name.
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return up to 3 scenarios: Primary (+ optional alternates if realistic).

${SHARED_JSON_SHAPE}
`.trim();
}

// -------------------------- OpenAI Call Helper -----------------------------
async function chatAnalyze({ category, brand, dataUrl }) {
  const system = buildSystemPrompt(category, brand);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: [
      { type: 'text', text: `Analyze the attached photo. Category: ${category}. Brand: ${brand}. Provide 3 scenarios following the JSON schema.` },
      { type: 'image_url', image_url: { url: dataUrl } }
    ] }
  ];
  const resp = await client.chat.completions.create({
    model: MODEL, messages, temperature: 0.25, response_format: { type: 'json_object' }
  });
  const text = resp.choices?.[0]?.message?.content?.trim() || '{}';
  try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}$/); return m ? JSON.parse(m[0]) : { analysis: 'Parse error', scenarios: [] }; }
}

// --------------------------------- Routes ----------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/brands', (_req, res) => res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS }));

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
    out = enforceBrandConsistency(out, brand);
    out = expressTonesGuard(out, out.analysis, brand);
    out = enforceNeutralBlack(out, out.analysis, brand);
    out = applyValidator(out, category, brand);
    out = validatePrimaryScenario(out, brand);

    if (category !== 'permanent' && Array.isArray(out.scenarios)) {
      const primary = out.scenarios.find(s => (s.title || '').toLowerCase().includes('primary')) || out.scenarios[0];
      out.scenarios = primary ? [primary] : [];
    }
    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Upstream error', detail: String(err?.message || err) });
  } finally {
    if (tmpPath) { try { await fs.unlink(tmpPath); } catch {} }
  }
});

// ------------------------------- Start Guard -------------------------------
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {

  // ------------------------------ StylistSync Assistant ------------------------------
  // Calendar-aware, date-locking, action-synthesizing, adapter-normalized
  app.post('/assistant', async (req, res) => {
    try {
      const { message, timezone = "America/Los_Angeles", nowISO, context = {} } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Missing message' });
      }

      // --- Time helpers (PT ISO with offset) ---
      const now = nowISO ? new Date(nowISO) : new Date();
      const offsetFromISO = (iso) => {
        const m = typeof iso === "string" ? iso.match(/([+-]\d{2}:\d{2})$/) : null;
        return m ? m[1] : "-07:00"; // fallback PDT
      };
      const ptOffset = offsetFromISO(nowISO || new Date().toISOString());
      const WeekIndex = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

      function resolveWeekdayPhrase(text) {
        const s = (text || "").toLowerCase();
        const wk = Object.keys(WeekIndex).find(d => s.includes(d));
        if (!wk) return null;
        let hh = 9, mm = 0;
        const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
        if (tm) {
          hh = parseInt(tm[1], 10);
          mm = tm[2] ? parseInt(tm[2], 10) : 0;
          const ap = tm[3];
          if (ap === 'pm' && hh < 12) hh += 12;
          if (ap === 'am' && hh === 12) hh = 0;
        }
        const tgt = WeekIndex[wk];
        const base = new Date(now);
        const dow = base.getUTCDay();
        let add = (tgt - dow + 7) % 7;
        const saysNextOrUpcoming = /(?:\bnext\b|\bupcoming\b)/.test(s);
        const saysThis = /\bthis\b/.test(s);
        if (add === 0 && (saysThis || saysNextOrUpcoming)) add = 7;
        if (add === 0) add = 7; // always future
        const future = new Date(base.getTime() + add * 24 * 3600 * 1000);
        const yyyy = future.getUTCFullYear();
        const mm2  = String(future.getUTCMonth() + 1).padStart(2, '0');
        const dd2  = String(future.getUTCDate()).padStart(2, '0');
        const HH   = String(hh).padStart(2, '0');
        const MM   = String(mm).padStart(2, '0');
        return `${yyyy}-${mm2}-${dd2}T${HH}:${MM}:00${ptOffset}`;
      }

      function extractSlots(text) {
        const slots = {};
        const lower = text.toLowerCase();
        if (/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.test(lower)) {
          const iso = resolveWeekdayPhrase(text);
          if (iso) slots.dateISO = iso;
        }
        const mPrice = text.match(/\$\s*(\d{2,4})(?:\.\d{2})?/);
        if (mPrice) slots.price = Number(mPrice[1]);
        const mDur = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)/i);
        if (mDur) {
          const n = parseFloat(mDur[1]);
          slots.durationMinutes = /min/i.test(mDur[2]) ? Math.round(n) : Math.round(n * 60);
        }
        const mClient = text.match(/\bnamed\s+([A-Za-z][\w'-]+)/i) || text.match(/\bfor\s+([A-Za-z][\w'-]+)\b/i);
        if (mClient) slots.clientName = mClient[1];
        const mSvc = text.match(/\bfor\s+(?:a\s+)?([A-Za-z ][A-Za-z ]*)/i);
        if (mSvc) {
          const raw = mSvc[1].trim();
          if (!/\b(appointment|client|named|this|next|upcoming|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw)) {
            const svc = raw.replace(/\s+/g, ' ').trim();
            slots.serviceType = svc.charAt(0).toUpperCase() + svc.slice(1);
            slots.title = slots.serviceType;
          }
        }
        return slots;
      }

      // ---------- Local synthesizer ----------
      function localSynthesize(message, context) {
        const slots = extractSlots(message);
        const warnings = [];
        const actions = [];

        if (slots.clientName) {
          const known = Array.isArray(context.clients)
            ? context.clients.some(n => (n || '').toLowerCase() === slots.clientName.toLowerCase())
            : false;
          if (!known) {
            actions.push({ type: 'createClient', payload: { name: slots.clientName, contact: null, notes: null } });
            warnings.push(`Client '${slots.clientName}' not found; will be created.`);
          }
        }
        if (slots.dateISO) {
          actions.push({
            type: 'createAppointment',
            payload: {
              title: slots.title || 'Appointment',
              dateISO: slots.dateISO,
              clientName: slots.clientName || null,
              notes: null,
              serviceType: slots.serviceType || null,
              durationMinutes: slots.durationMinutes || 60,
              price: slots.price || null
            }
          });
          const appts = Array.isArray(context.appointments) ? context.appointments : [];
          const conflict = appts.find(a => a?.dateISO === slots.dateISO);
          if (conflict) {
            warnings.push(`Time ${slots.dateISO} overlaps with '${conflict.title}' for ${conflict.clientName || "someone"}.`);
          }
        }

        const reply = actions.length
          ? `Booked ${slots.clientName ? `${slots.clientName} ` : ''}${slots.title || 'appointment'} for ${slots.dateISO?.replace('T', ' at ') || 'the requested time'}.`
          : 'I can help with that.';

        return { reply, actions, warnings };
      }

      // If no API key, immediately return local synthesized actions
      if (!process.env.OPENAI_API_KEY) {
        const fallback = localSynthesize(message, context);
        return res.json(fallback);
      }

      // ---------- System prompt ----------
      const sys = `You are StylistSync — an AI hairstylist assistant inside an iOS app.

Rules:
- Always return strict JSON with keys "reply" (string), "actions" (array), "warnings" (array).
- For requests to book/create/delete/adjust in-app, you MUST include structured actions.
- Timezone is ${timezone}. "now" is ${now.toISOString()}. If user says "this/upcoming/next Monday 2pm", resolve to the nearest FUTURE date in PT and return ISO with offset like 2025-09-15T14:00:00-07:00.
- Prefer clientName over IDs. If client not found in context, include a warning that it will be created.
- Do NOT mutate data; only propose actions.

Context (names only):
clients: ${(context.clients || []).slice(0, 50).join(", ")}
appt count: ${(context.appointments || []).length}`;

      const userMsg = String(message);

      // ---------- Call OpenAI with catch → local fallback ----------
      let raw = "";
      try {
        const resp = await client.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        });
        raw = resp.choices?.[0]?.message?.content?.trim() || "";
      } catch (apiErr) {
        console.error('OpenAI error:', apiErr?.message || apiErr);
        const fallback = localSynthesize(userMsg, context);
        return res.json(fallback);
      }

      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }

      // ---------- Adapter: normalize legacy/LLM shapes to the app contract ----------
      function toMinutes(x) {
        if (x == null) return null;
        const s = String(x).trim();
        const mHr = s.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)$/i);
        const mMin = s.match(/^(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)$/i);
        if (mHr) return Math.round(parseFloat(mHr[1]) * 60);
        if (mMin) return Math.round(parseFloat(mMin[1]));
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
      function normalizeOne(a) {
        if (a && a.type && a.payload) return a;
        if (a && (a.action === 'create_appointment' || a.type === 'create_appointment')) {
          const durationMinutes = a.durationMinutes ?? toMinutes(a.duration) ?? 60;
          const price = (typeof a.price === 'string' ? Number(a.price.replace(/^\$/, '')) : a.price) ?? null;
          const title = a.title || a.service || a.serviceType || 'Appointment';
          return {
            type: 'createAppointment',
            payload: {
              title,
              dateISO: a.dateISO || a.startTime || a.start || a.when || null,
              clientName: a.clientName || a.name || null,
              notes: a.notes ?? null,
              serviceType: a.serviceType || a.service || null,
              durationMinutes,
              price
            }
          };
        }
        if (a && (a.action === 'create_client' || a.type === 'create_client')) {
          return { type: 'createClient', payload: { name: a.name || a.clientName || '', contact: a.contact ?? null, notes: a.notes ?? null } };
        }
        if (a && (a.action === 'delete_appointment' || a.type === 'delete_appointment')) {
          return { type: 'deleteAppointment', payload: { dateISO: a.dateISO || a.startTime || a.when || null, title: a.title || a.service || 'Appointment', clientName: a.clientName || null } };
        }
        if (a && (a.action === 'adjust_inventory' || a.type === 'adjust_inventory')) {
          return { type: 'adjustInventory', payload: { productName: a.productName || a.item || '', delta: Number(a.delta ?? a.change ?? 0), note: a.note ?? null } };
        }
        if (a && (a.action === 'delete_client' || a.type === 'delete_client')) {
          return { type: 'deleteClient', payload: { name: a.name || a.clientName || '' } };
        }
        return null;
      }

      if (!parsed || typeof parsed !== 'object') parsed = { reply: 'OK', actions: [], warnings: [] };
      if (!Array.isArray(parsed.actions)) parsed.actions = [];
      parsed.actions = parsed.actions.map(normalizeOne).filter(Boolean);
      if (!Array.isArray(parsed.warnings)) parsed.warnings = [];

      // ---- Ensure createClient accompanies createAppointment when needed ----
      (function ensureClientCreate() {
        const appt = parsed.actions.find(a => a?.type === 'createAppointment' && a?.payload?.clientName);
        const alreadyHasCreateClient = parsed.actions.some(a => a?.type === 'createClient');
        if (!appt || alreadyHasCreateClient) return;
        const clientName = appt.payload.clientName?.trim();
        if (!clientName) return;

        const contextHasClient =
          Array.isArray(context.clients) &&
          context.clients.some(n => (n || '').toLowerCase() === clientName.toLowerCase());

        const warningHintsNew =
          (parsed.warnings || []).some(w => typeof w === 'string' && /client.+(not found|will be created)/i.test(w));

        if (!contextHasClient || warningHintsNew) {
          parsed.actions.unshift({
            type: 'createClient',
            payload: { name: clientName, contact: null, notes: null }
          });
          if (!warningHintsNew) {
            parsed.warnings.push(`Client '${clientName}' not found; will be created.`);
          }
        }
      })();

      // ---------- Guaranteed actions if the model forgot ----------
      const wantsAction =
        /(book|schedule|add|create|delete|cancel|adjust|reschedule)/i.test(userMsg) &&
        /(appointment|client|inventory|product|calendar)/i.test(userMsg);

      if (wantsAction && parsed.actions.length === 0) {
        const synth = localSynthesize(userMsg, context);
        parsed.actions = synth.actions;
        parsed.warnings.push(...(synth.warnings || []));
        if (!parsed.reply || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
          parsed.reply = synth.reply;
        }
      }

      if (typeof parsed.reply !== 'string') parsed.reply = String(parsed.reply ?? '');
      return res.json(parsed);
    } catch (err) {
      console.error('assistant error', err);
      return res.status(500).json({ error: 'assistant_failed' });
    }
  });

  app.listen(PORT, () => console.log(`Formula Guru server running on :${PORT}`));
}

export default app;
