// server.mjs — Formula Guru 2
// Category-aware (Permanent / Demi / Semi) with manufacturer mixing rules
// Adds post-processing to enforce missing ratios/dev names (e.g., Shades EQ 1:1)
// ------------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import { OpenAI } from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ dest: process.env.UPLOAD_DIR || "tmp/" });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = 'gpt-4o';

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
    developer: 'Redken Pro-oxide Cream Developer 10/20/30/40 vol (20 vol typical for grey coverage)',
    notes: 'Standard 1:1.'
  },
  'Wella Koleston Perfect': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9%/12% (6% typical for coverage)',
    notes: 'Core shades 1:1.'
  },
  'Wella Illumina Color': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9% (6% typical for coverage)',
    notes: 'Reflective permanent; 1:1 mix.'
  },
  'L’Oréal Professionnel Majirel': {
    category: 'permanent',
    ratio: '1:1.5',
    developer: 'L’Oréal Oxydant Creme (20 vol typical for coverage)',
    notes: 'Standard Majirel 1:1.5; High Lift lines differ.'
  },
  'Matrix SoColor Permanent': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Matrix Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1. (Line exceptions exist: Ultra.Blonde 1:2; High-Impact Brunettes 1:1.5)'
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
    notes: 'Core ChromaSilk 1:1.5. (High Lifts 1:2).'
  },

  // DEMI
  'Redken Shades EQ': {
    category: 'demi',
    ratio: '1:1',
    developer: 'Shades EQ Processing Solution / Shades EQ Processing Solution Bonder Inside',
    notes: 'Acidic demi; up to ~20 minutes typical.'
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
    notes: 'Mix 1:1 with The Demi Processing Liquid.'
  },
  'Matrix SoColor Sync': {
    category: 'demi',
    ratio: '1:1',
    developer: 'SoColor Sync Activator',
    notes: 'Mix 1:1 with SoColor Sync Activator.'
  },
  'Goldwell Colorance': {
    category: 'demi',
    ratio: '2:1',
    developer: 'Colorance System Developer Lotion 2% (7 vol)',
    notes: 'Core Colorance mixes 2:1 (lotion:color). Gloss Tones line is 1:1.'
  },
  'Schwarzkopf Igora Vibrance': {
    category: 'demi',
    ratio: '1:1',
    developer: 'IGORA VIBRANCE Activator Gel (1.9% or 4%) OR IGORA VIBRANCE Activator Lotion (1.9% or 4%)',
    notes: 'All shades mix 1:1; name the activator explicitly (Gel or Lotion).'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: 'Process up to ~20 minutes or until desired tone.'
  },

  // SEMI
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
    notes: 'Direct dye; dilute with Chroma ID Clear Bonding Mask.'
  },
  'Matrix SoColor Cult': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; default RTU.'
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

// Extract a short, printable developer/activator product name
function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule || !rule.developer || rule.developer === 'None') return null;
  // pick the first option before "/" or " or "
  let first = rule.developer.split(/\s*\/\s*|\s+or\s+|\s+OR\s+/)[0];
  // strip percentages, volumes, and parentheticals
  first = first.replace(/\d+%/g, '')
               .replace(/\b(10|20|30|40)\s*vol(ume)?\b/ig, '')
               .replace(/\([^)]*\)/g, '')
               .replace(/\s{2,}/g, ' ')
               .trim();
  return first || null;
}

// Ensure ratio & developer name appear in a formula string when appropriate
function enforceRatioAndDeveloper(formula, brand) {
  const rule = BRAND_RULES[brand];
  if (!rule) return formula;

  let out = (formula || '').trim();

  // Developer name enforcement (for demi and permanent brands that use a developer)
  const devName = canonicalDeveloperName(brand);
  if (devName && !new RegExp(devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) {
    // if "with" already there but wrong product, still append our dev for clarity
    if (/ with /i.test(out)) {
      out = out.replace(/ with /i, ` with ${devName} `);
    } else {
      out = `${out} with ${devName}`;
    }
  }

  // Ratio enforcement — only for simple fixed ratios like "1:1", "1:1.5", "1:2"
  const r = (rule.ratio || '').trim();
  const isSimpleRatio = /^(\d+(\.\d+)?):(\d+(\.\d+)?)$/.test(r);
  if (isSimpleRatio) {
    const ratioRegex = /(\d+(\.\d+)?)\s*:\s*(\d+(\.\d+)?)/;
    if (!ratioRegex.test(out)) {
      // Insert ratio before "with ..." if possible, else append to end
      if (/ with /i.test(out)) {
        out = out.replace(/ with /i, ` (${r}) with `);
      } else {
        out = `${out} (${r})`;
      }
    }
  }
  return out.trim();
}

function fixStep(step, brand) {
  if (!step) return null;
  const patched = { ...step };
  if (patched.formula) {
    patched.formula = enforceRatioAndDeveloper(patched.formula, brand);
  }
  return patched;
}

function enforceBrandConsistency(out, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  const patched = { ...out, scenarios: out.scenarios.map(sc => {
    const s = { ...sc };
    s.roots = fixStep(s.roots, brand);
    s.melt  = fixStep(s.melt,  brand);
    s.ends  = fixStep(s.ends,  brand);
    return s;
  })};
  return patched;
}


// -------------------------- Lightweight Validator ---------------------------
const BRAND_PATTERNS = {
  // DEMI patterns (examples/families, not exhaustive)
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Pravana ChromaSilk Express Tones': [/^\s*(?:(?:Smokey|Ash|Beige|Gold|Copper|Violet|Rose|Natural|Silver))/i],

  // SEMI patterns
  'Wella Color Fresh': [/^\s*(?:\d{1,2}\.\d|\d{1,2})\b/],
  'Goldwell Elumen': [/^\s*(?:@[\w]+|\w+-\w+|\w{1,2}\d{1,2})\b/],
  'Pravana ChromaSilk Vivids': [/^\s*(?:VIVIDS|Silver|Clear|Magenta|Pink|Blue|Green|Yellow|Orange|Red|Purple)/i],
  'Schwarzkopf Chroma ID': [/^\s*(?:\d{1,2}-\d{1,2}|Clear|Bonding)/i],
  'Matrix SoColor Cult': [/^\s*(?:Clear|Neon|Pastel|Teal|Pink|Blue|Purple|Red)/i]
};

function stepHasAllowedCodes(step, brand) {
  if (!step || !step.formula) return true; // empty step is fine
  const txt = step.formula;
  const pats = BRAND_PATTERNS[brand] || [];
  if (pats.length === 0) return true; // nothing to validate against
  // Consider formula valid if at least one allowed pattern appears
  return pats.some(rx => rx.test(txt));
}

function isBlackOrSingleVivid(analysis, brand) {
  const a = (analysis || "").toLowerCase();
  const black = /\b(level\s*[12]\b|solid\s*black)\b/.test(a);
  const vividHint = /\b(single\s+vivid|vivid|fashion\s+shade|magenta|pink|blue|green|purple|teal)\b/.test(a);
  // In semi-direct lines, a single vivid often doesn't have cooler/warmer alternates
  return black || vividHint;
}

function extractNumericLevels(text) {
  // crude parse: capture 2-digit levels like 01-12 and single digits 1-12
  const levels = [];
  const rx = /\b0?([1-9]|1[0-2])\s*[A-Z@]?/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n)) levels.push(n);
  }
  return levels;
}

function altHasHighLevelToner(sc, brand) {
  const parts = [sc?.roots?.formula, sc?.melt?.formula, sc?.ends?.formula].filter(Boolean).join(" ");
  const lvls = extractNumericLevels(parts);
  // treat 7+ as "light levels" for demi toners; if analysis is black, these are unrealistic alternates
  return lvls.some(n => n >= 7);
}

function applyValidator(out, category, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (category === 'permanent') return out;

  const patched = { ...out };
  patched.scenarios = out.scenarios.map((sc) => {
    const s = { ...sc };
    const title = (s.title || '').toLowerCase();
    const isAlternate = title.includes('alternate');
    if (!isAlternate) return s; // primary untouched

    // If analysis indicates black/single vivid, mark N/A
    if (isBlackOrSingleVivid(out.analysis, brand) || altHasHighLevelToner(s, brand)) {
      s.na = true;
      s.note = "Not applicable for this photo/brand line.";
      return s;
    }

    // Validate shade code presence per brand pattern on any present step
    const rootsOK = stepHasAllowedCodes(s.roots, brand);
    const meltOK  = stepHasAllowedCodes(s.melt, brand);
    const endsOK  = stepHasAllowedCodes(s.ends, brand);
    const valid = rootsOK && meltOK && endsOK;

    if (!valid) {
      s.na = true;
      s.note = "Not applicable for this photo/brand line.";
    }
    return s;
  });
  return patched;
}


// ---------------------------- Prompt Builders ------------------------------
const SHARED_JSON_SHAPE_THREE = `
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

const SHARED_JSON_SHAPE_ONE = `
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
    }
  ]
}
`.trim();
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

CATEGORY = PERMANENT (root grey coverage)
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % (<25%, 25–50%, 50–75%, 75–100%) and provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Include **developer volume and the exact ratio** in the ROOTS formula (e.g., "6N + 6.3 (${BRAND_RULES[brand]?.ratio || '1:1'}) with 20 vol <developer name>").
- Provide a compatible mids/ends plan (refresh vs. band control).
- Processing must call out: sectioning, application order (roots → mids → ends), timing, and rinse/aftercare.
- Return exactly 3 scenarios: Primary, Alternate (cooler), Alternate (warmer).

${SHARED_JSON_SHAPE_THREE}
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
- ${header}

CATEGORY = SEMI-PERMANENT (direct/acidic deposit-only; ${brand})
${ratioGuard}

Rules:
- **No developer** in formulas (RTU where applicable). Use brand Clear/diluter for sheerness.
- Do not promise full grey coverage; you may blend/soften the appearance of grey.
- **Return only one scenario: Primary. Do not include cooler or warmer alternates.**
- Do not invent shade codes. Only use codes that exist for the selected brand line.

${SHARED_JSON_SHAPE_ONE}
`.trim();
  }

  // Demi
  return `
${header}

CATEGORY = DEMI (gloss/toner; brand-consistent behavior)
${ratioGuard}

Rules:
- Gloss/toner plans only from ${brand}. In **every formula**, include the ratio and the **developer/activator name** (e.g., "09V + 09T (1:1) with Shades EQ Processing Solution").
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return up to 3 scenarios:
- Primary (always required)
- Alternate (cooler) and/or Alternate (warmer) **only if realistic and available** for the selected brand line.
- **If the photo shows natural or dyed level 1–2 / jet black, do NOT provide cooler/warmer alternates — mark them as Not applicable.**
- If an alternate is not relevant (e.g., solid level 1–2 black; or the brand line doesn’t offer those tones for this look), return it as **Not applicable**.
- Do not invent shade codes. Only use codes that exist for the selected brand line.

${SHARED_JSON_SHAPE_THREE}
`.trim();
}

// -------------------------- OpenAI Call Helper -----------------------------
async function chatAnalyze({ category, brand, dataUrl }) {
  const system = buildSystemPrompt(category, brand);

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [{ type: 'text', text: `Analyze the attached photo. Category: ${category}. Brand: ${brand}. Provide ${category === 'permanent' ? '3' : '1'} scenario(s) following the JSON schema.` },
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
    return m ? JSON.parse(m[0]) : { analysis: "Parse error", scenarios: [] };
  }
}

// --------------------------------- Routes ----------------------------------
app.get('/brands', (req, res) => {
  res.json({
    demi: DEMI_BRANDS,
    permanent: PERMANENT_BRANDS,
    semi: SEMI_BRANDS,
  });
});

// Health check (for cloud hosting)
app.get("/health", (req, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No photo uploaded (field 'photo')." });
    }

    const categoryRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent', 'semi', 'demi'].includes(categoryRaw) ? categoryRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand);

    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;

    let out = await chatAnalyze({ category, brand, dataUrl });

    // Enforce missing ratio/dev name (e.g., Shades EQ 1:1) before returning
    out = enforceBrandConsistency(out, brand);

    // Lightweight post-validation for Demi/Semi alternates
    out = applyValidator(out, category, brand);

    if (!out || typeof out !== 'object') {
      return res.status(502).json({ error: 'Invalid model output' });
    }
    if (!Array.isArray(out.scenarios)) out.scenarios = [];
    if (typeof out.analysis !== 'string') out.analysis = '';

    return res.json(out);
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      error: 'Upstream error',
      detail: err?.message || String(err),
    });
  } finally {
    try { if (tmpPath) await fs.unlink(tmpPath); } catch {}
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Formula Guru running on port ${PORT} (${MODEL})`);
  if (!process.env.OPENAI_API_KEY) {
    console.error('⚠️ No OPENAI_API_KEY found in env!');
  } else {
    console.log('🔑 API key loaded.');
  }
});



// -------------------- Client-AI Namespace --------------------

// POST /client-ai/compose-message
app.post('/client-ai/compose-message', async (req, res) => {
  try {
    const { type, tone, client, stylist, notes } = req.body;
    const prompt = {
      role: "system",
      content: "You are a salon assistant AI. Generate a concise, salon-appropriate message strictly in JSON."
    };
    const userPrompt = {
      role: "user",
      content: JSON.stringify({
        task: "compose-message",
        type, tone, client, stylist, notes
      })
    };
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [prompt, userPrompt]
    });
    const text = response.choices[0].message.content;
    res.json(JSON.parse(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "compose-message failed" });
  }
});

// POST /client-ai/summarize-consultation
app.post('/client-ai/summarize-consultation', async (req, res) => {
  try {
    const { history, tags } = req.body;
    const prompt = {
      role: "system",
      content: "You are a salon AI. Summarize consultations concisely and return JSON with summary and extracted_tags."
    };
    const userPrompt = {
      role: "user",
      content: JSON.stringify({ task: "summarize-consultation", history, tags })
    };
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [prompt, userPrompt]
    });
    const text = response.choices[0].message.content;
    res.json(JSON.parse(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "summarize-consultation failed" });
  }
});

// POST /client-ai/retail-suggest
app.post('/client-ai/retail-suggest', async (req, res) => {
  try {
    const { serviceType, maintenanceGoal, budgetTier } = req.body;
    const prompt = {
      role: "system",
      content: "You are a salon AI. Suggest retail products concisely. Respond strictly in JSON with an array of suggestions."
    };
    const userPrompt = {
      role: "user",
      content: JSON.stringify({ task: "retail-suggest", serviceType, maintenanceGoal, budgetTier })
    };
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [prompt, userPrompt]
    });
    const text = response.choices[0].message.content;
    res.json(JSON.parse(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "retail-suggest failed" });
  }
});

// --------------------------------------------------------------
