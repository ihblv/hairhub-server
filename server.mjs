// server.mjs — Hair Hub / Formula Guru vision endpoint
// - Accepts: brand, category, optional hint & history, up to 3 photos with roles
// - Photos (multipart field names):
//     photo_current (required to generate), photo_inspo (optional), photo_lift (optional)
// - Backward compatible: if only "photo" is provided, treat as current hair
// - JSON response shape unchanged: { analysis: string, scenarios: [ ... ] }
// - Demi/Semi: return Primary only; Permanent: may return multiple scenarios

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Build category- and brand-aware system prompt
function systemPrompt({ category, brand }) {
  const base = `You are Formula Guru, an expert professional hair color formulator.
You analyze hairstylist photos and return brand-accurate formulas ONLY in strict JSON (no markdown).

GENERAL RULES
- Always output a JSON object with keys: analysis (string) and scenarios (array).
- Each scenario must include: title (string), condition (string or null), target_level (int or null),
  roots (object or null), melt (object or null), ends (object with formula/timing/note), processing (array of steps or null), confidence (0..1 or null).
- All mixing ratios, developers, and processing times must follow official manufacturer guidance for the chosen brand.
- Keep wording concise and professional.

CATEGORY RULES
- Demi and Semi: Return only one scenario titled "Primary". Do NOT include cooler or warmer alternates.
- Permanent (gray coverage): You may return multiple scenarios if helpful (e.g., resistant vs normal).

BRAND CONTEXT
- Selected brand: ${brand}. Tailor shade codes and developer strengths to this brand.`;
  return base;
}

// Build the user prompt dynamically from fields and photo roles
function buildUserText({ category, brand, hint, history, hasCurrent, hasInspo, hasLift }) {
  const lines = [];
  lines.push(`Category: ${category}`);
  lines.push(`Brand: ${brand}`);
  if (hint && hint.trim()) lines.push(`Hint/description: ${hint.trim()}`);
  if (history && history.trim()) lines.push(`Hair history: ${history.trim()}`);

  const roles = [];
  if (hasCurrent) roles.push('First photo is the client\'s current hair.');
  if (hasInspo)   roles.push('Second photo is the target inspiration.');
  if (hasLift)    roles.push('Third photo shows raw lift after lightening; base formulas on this as the starting point.');
  if (roles.length) {
    lines.push(roles.join(' '));
  }

  // Output contract
  lines.push(`Return STRICT JSON only with: { "analysis": string, "scenarios": [ ... ] }`);
  lines.push(`No code fences, no extra commentary.`);

  return lines.join('\n');
}

// Helper to convert a Buffer to a data URL for chat.completions image input
function toDataURL(buf, mime='image/jpeg') {
  const b64 = buf.toString('base64');
  return `data:${mime};base64,${b64}`;
}

app.post('/analyze', upload.fields([
  { name: 'photo', maxCount: 1 },           // backward-compat
  { name: 'photo_current', maxCount: 1 },
  { name: 'photo_inspo', maxCount: 1 },
  { name: 'photo_lift', maxCount: 1 },
]), async (req, res) => {
  try {
    const { brand, category, hint, history } = req.body;

    // Validate minimal fields
    const current = (req.files['photo_current']?.[0]) || (req.files['photo']?.[0]) || null;
    const inspo   = (req.files['photo_inspo']?.[0]) || null;
    const lift    = (req.files['photo_lift']?.[0]) || null;

    if (!brand || !category) {
      return res.status(400).json({ error: 'Missing brand or category.' });
    }
    if (!current) {
      // Allow old clients to still send "photo" (handled above)
      if (!req.files['photo']) {
        return res.status(400).json({ error: 'Missing current hair photo (photo_current).' });
      }
    }

    const sys = systemPrompt({ category, brand });
    const userText = buildUserText({
      category, brand, hint, history,
      hasCurrent: !!current, hasInspo: !!inspo, hasLift: !!lift
    });

    const content = [{ type: 'text', text: userText }];

    // Append images in order: current, inspo, lift
    if (current) {
      content.push({ type: 'image_url', image_url: { url: toDataURL(current.buffer, current.mimetype || 'image/jpeg') } });
    }
    if (inspo) {
      content.push({ type: 'image_url', image_url: { url: toDataURL(inspo.buffer, inspo.mimetype || 'image/jpeg') } });
    }
    if (lift) {
      content.push({ type: 'image_url', image_url: { url: toDataURL(lift.buffer, lift.mimetype || 'image/jpeg') } });
    }

    // Use Chat Completions with JSON response_format for robustness
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    let text = completion.choices?.[0]?.message?.content || '{}';
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      // Best-effort recovery: strip code fences if present and try again
      text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '');
      obj = JSON.parse(text);
    }

    // Minimal shape guard
    if (typeof obj !== 'object' || obj === null || !('analysis' in obj) || !('scenarios' in obj)) {
      return res.status(502).json({ error: 'Upstream returned unexpected format.', raw: obj });
    }

    // Enforce Demi/Semi primary-only on server side as an extra guard
    const cat = String(category || '').toLowerCase();
    if (cat === 'demi' || cat === 'semi') {
      if (Array.isArray(obj.scenarios)) {
        const primary = obj.scenarios.find(s => (s.title || '').toLowerCase().includes('primary'));
        obj.scenarios = primary ? [primary] : (obj.scenarios.length ? [obj.scenarios[0]] : []);
      }
    }

    res.json(obj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: String(err?.message || err) });
  }
});

app.get('/', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Hair Hub server listening on :${port}`);
});
