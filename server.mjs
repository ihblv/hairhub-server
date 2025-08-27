// server.mjs — Formula Guru 2 (with stricter real-shade validation + brand consistency)
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
    notes: 'Standard 1:1.'
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
    notes: 'Core ChromaSilk 1:1.5.'
  },

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
    notes: 'Core Colorance mixes 2:1.'
  },
  'Schwarzkopf Igora Vibrance': {
    category: 'demi',
    ratio: '1:1',
    developer: 'IGORA VIBRANCE Activator Gel/Lotion',
    notes: 'All shades mix 1:1.'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: 'Process ~20 minutes.'
  },

  'Wella Color Fresh': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Ready-to-use.' },
  'Goldwell Elumen': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'No developer.' },
  'Pravana ChromaSilk Vivids': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye.' },
  'Schwarzkopf Chroma ID': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye.' },
  'Matrix SoColor Cult': { category: 'semi', ratio: 'RTU', developer: 'None', notes: 'Direct dye.' },
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
  if (category === 'semi') return 'Wella Color Fresh';
  return 'Redken Shades EQ';
}

function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule || !rule.developer || rule.developer === 'None') return null;
  let first = rule.developer.split(/\s*\/\s*|\s+or\s+/)[0];
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
  if (devName && !new RegExp(devName, 'i').test(out)) {
    if (/ with /i.test(out)) {
      out = out.replace(/ with /i, ` with ${devName} `);
    } else {
      out = `${out} with ${devName}`;
    }
  }
  const r = (rule.ratio || '').trim();
  const isSimpleRatio = /^(\d+(\.\d+)?):(\d+(\.\d+)?)$/.test(r);
  if (isSimpleRatio) {
    const ratioRegex = /(\d+(\.\d+)?)\s*:\s*(\d+(\.\d+)?)/;
    if (!ratioRegex.test(out)) {
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
  return {
    ...out,
    scenarios: out.scenarios.map(sc => ({
      ...sc,
      roots: fixStep(sc.roots, brand),
      melt: fixStep(sc.melt, brand),
      ends: fixStep(sc.ends, brand),
    })),
  };
}

// ---------------------------- Prompt Builders ------------------------------
const SHARED_JSON_SHAPE = `...`; // (unchanged JSON schema block)

function brandRuleLine(brand) {
  const r = BRAND_RULES[brand];
  if (!r) return '';
  return `Official mixing rule for ${brand}: ratio ${r.ratio}; developer/activator: ${r.developer}. ${r.notes}`;
}

function buildSystemPrompt(category, brand) {
  const header = `You are Formula Guru, a master colorist. Use only: "${brand}". Output must be JSON-only.`;
  const brandRule = brandRuleLine(brand);
  const shadeGuard = `
IMPORTANT — SHADE VALIDITY
- Only use real, official shades that exist in the ${brand} ${category} catalog.
- Never invent shades/codes.
- Cross-check every shade internally before answering.
- If you cannot find a valid alternate, reuse a close valid shade instead of inventing.
  `.trim();
  const ratioGuard = `
IMPORTANT — MIXING RULES
- Use official mixing ratio for ${brand}.
- Include developer/activator product name exactly.
${brandRule}
  `.trim();

  if (category === 'permanent') {
    return `${header}

CATEGORY = PERMANENT
${shadeGuard}
${ratioGuard}

Rules:
- Respect natural depth.
- No more than ±2 levels away.
- Alternates must differ mainly by tone.
${SHARED_JSON_SHAPE}`;
  }

  if (category === 'semi') {
    return `${header}

CATEGORY = SEMI-PERMANENT
${shadeGuard}
${ratioGuard}

Rules:
- No developer (RTU).
- Keep within ±2 levels.
${SHARED_JSON_SHAPE}`;
  }

  return `${header}

CATEGORY = DEMI
${shadeGuard}
${ratioGuard}

Rules:
- Match actual depth observed.
- No more than ±2 levels away unless corrective.
- Alternates are tone shifts at same depth.
${SHARED_JSON_SHAPE}`;
}

// -------------------------- OpenAI Call Helper -----------------------------
async function chatAnalyze({ category, brand, dataUrl }) {
  const system = buildSystemPrompt(category, brand);
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Analyze the photo. Category: ${category}. Brand: ${brand}. Provide 3 scenarios JSON.` },
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
  try { return JSON.parse(text); }
  catch { return { analysis: "Parse error", scenarios: [] }; }
}

// --------------------------------- Routes ----------------------------------
app.get('/brands', (req, res) => {
  res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS });
});
app.get("/health", (req, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded." });
    const categoryRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent', 'semi', 'demi'].includes(categoryRaw) ? categoryRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand);
    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;
    let out = await chatAnalyze({ category, brand, dataUrl });
    out = enforceBrandConsistency(out, brand);
    if (!out || typeof out !== 'object') return res.status(502).json({ error: 'Invalid model output' });
    if (!Array.isArray(out.scenarios)) out.scenarios = [];
    if (typeof out.analysis !== 'string') out.analysis = '';
    return res.json(out);
  } catch (err) {
    return res.status(err?.status || 500).json({ error: 'Upstream error', detail: err?.message || String(err) });
  } finally {
    try { if (tmpPath) await fs.unlink(tmpPath); } catch {}
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Formula Guru running on port ${PORT} (${MODEL})`);
  if (!process.env.OPENAI_API_KEY) console.error('⚠️ No OPENAI_API_KEY set');
  else console.log('🔑 API key loaded.');
});
