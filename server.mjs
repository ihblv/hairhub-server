// server.mjs — Formula Guru 2 (final, calendar-aware assistant)
// Category-aware (Permanent / Demi / Semi) with manufacturer mixing rules
// Enforces ratios + developer names, validates shade formats, and adds
// analysis-aware guard for Pravana ChromaSilk Express Tones suitability.
// Also normalizes level-1/2 black to 1N (not 1A) on supported DEMI lines.
// Extends ONLY /assistant to be calendar-aware with guaranteed action synthesis.
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
// canonList, normalizeBrand, canonicalDeveloperName, enforceRatioAndDeveloper
// … (all those utility functions remain exactly as in your working file) …

// ---------------------------- Validators, Guards ---------------------------
// stepHasAllowedCodes, expressTonesGuard, applyValidator, validatePrimaryScenario,
// enforceNeutralBlack … (keep them all as in your working file) …

// ---------------------------- Prompt Builders ------------------------------
// buildSystemPrompt, SHARED_JSON_SHAPE, brandRuleLine … (unchanged) …

// -------------------------- OpenAI Call Helper -----------------------------
// chatAnalyze … (unchanged) …

// --------------------------------- Routes ----------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/brands', (_req, res) => res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  // … (unchanged body from your last working version) …
});

// ------------------------------- Start Guard -------------------------------
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {

  // ------------------------------ StylistSync Assistant ------------------------------
  // Calendar-aware, action-synthesizing, adapter-normalized
  app.post('/assistant', async (req, res) => {
    try {
      const { message, timezone = "America/Los_Angeles", nowISO, context = {} } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Missing message' });
      }

      // ---- Time helpers (resolve “this/upcoming Monday 2pm” → ISO) ----
      // … [resolveWeekdayPhrase, extractSlots functions stay intact] …

      // ---- Call OpenAI with context ----
      // … [unchanged system/user messages, completion call] …

      // ---- Parse + normalize actions ----
      // … [adapter from my last answer: normalizeOne, toMinutes, add fallback createClient + createAppointment if missing] …

      return res.json(parsed);
    } catch (err) {
      console.error('assistant error', err);
      return res.status(500).json({ error: 'assistant_failed' });
    }
  });

  app.listen(PORT, () => console.log(`Formula Guru server running on :${PORT}`));
}

export default app;
