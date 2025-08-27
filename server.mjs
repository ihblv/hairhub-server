// server.mjs — Formula Guru 2 (with stricter real-shade validation)
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
  // (same as before, omitted here for brevity — no changes)
  // ...
  'Redken Shades EQ': {
    category: 'demi',
    ratio: '1:1',
    developer: 'Shades EQ Processing Solution / Shades EQ Processing Solution Bonder Inside',
    notes: 'Acidic demi; up to ~20 minutes typical.'
  },
  // etc for all brands…
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

// (enforceRatioAndDeveloper, fixStep, enforceBrandConsistency stay the same)

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
  const header = `You are Formula Guru, a master colorist. Use only: "${brand}". Output must be JSON-only and match the app schema.`;
  const brandRule = brandRuleLine(brand);
  const shadeGuard = `
IMPORTANT — SHADE VALIDITY
- Only use **real, official shades** that exist in the ${brand} ${category} catalog.
- **Never invent shades or codes.** Do not output colors that are not part of the catalog (e.g. “1V” is invalid in Shades EQ).
- Cross-check every shade internally against the brand’s official catalog before including it.
- If you cannot find a valid cooler/warmer alternate that exists, reuse a close valid shade instead — but never invent.
`.trim();

  const ratioGuard = `
IMPORTANT — MIXING RULES
- Use the official mixing ratio shown below for ${brand} in ALL formula strings.
- Include the developer/activator product name exactly as provided below when applicable.
- Only use exception ratios if clearly relevant, and state the reason.
${brandRule}
`.trim();

  if (category === 'permanent') {
    return `
${header}

CATEGORY = PERMANENT (root grey coverage)
${shadeGuard}
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % and provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Respect the observed natural depth/level in the photo.
- Do NOT suggest formulas more than two levels lighter or darker than that observed depth.
- Alternates (cooler/warmer) must remain within ±2 levels of the detected level and differ mainly by tone, not by large level jumps.
- Include developer volume and the exact ratio in the ROOTS formula.
- Processing must call out: sectioning, application order, timing, and rinse/aftercare.
- Return exactly 3 scenarios: Primary, Alternate (cooler), Alternate (warmer).

${SHARED_JSON_SHAPE}
`.trim();
  }

  if (category === 'semi') {
    return `
${header}

CATEGORY = SEMI-PERMANENT (direct/acidic deposit-only; ${brand})
${shadeGuard}
${ratioGuard}

Rules:
- No developer in formulas (RTU where applicable). Use brand Clear/diluter for sheerness.
- Do not promise full grey coverage.
- Keep formulas within ±2 levels of the natural depth shown in the photo. No extreme jumps.
- Alternates must be realistic tone variations at that depth.
- Return 3 scenarios (Primary / Alternate cooler / Alternate warmer).

${SHARED_JSON_SHAPE}
`.trim();
  }

  // Demi
  return `
${header}

CATEGORY = DEMI (gloss/toner; brand-consistent behavior)
${shadeGuard}
${ratioGuard}

Rules:
- Gloss/toner plans only from ${brand}. In every formula, include the ratio and the developer/activator name.
- Match the actual depth/level observed in the photo. Do not suggest tones more than ±2 levels away unless banding correction is explicitly needed (then explain).
- Alternates (cooler/warmer) should be realistic tone shifts at the same depth, not extreme jumps.
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return exactly 3 scenarios (Primary / Alternate cooler / Alternate warmer).

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

    // Enforce ratio/dev name consistency
    out = enforceBrandConsistency(out, brand);

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
