// Serverless function that holds your Google Gemini API key privately.
// The browser never sees the key — it only calls this endpoint.
//
// Set GEMINI_API_KEY in your Vercel project's Environment Variables.
// Get a free key at https://aistudio.google.com/apikey

// Tried in order. If the first isn't available on your account/tier,
// the next is tried automatically.
const MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-lite-latest'
];

function buildPrompt(v) {
  const lines = [
    `Year: ${v.year}`,
    `Make: ${v.make}`,
    `Model: ${v.model}`
  ];
  if (v.trim) lines.push(`Trim: ${v.trim}`);
  if (v.mileage) lines.push(`Mileage: ${v.mileage}`);
  if (v.price) lines.push(`Asking price: $${v.price}`);
  if (v.condition) lines.push(`Condition and notes: ${v.condition}`);

  return `You are a car valuation assistant. Here is a vehicle someone is considering buying:

${lines.join('\n')}

Do the following:
1. Search the web for current market values for this specific vehicle at this mileage. Use sources like Kelley Blue Book, Edmunds, NADA/J.D. Power guides, and comparable recent listings or sale data.
2. Determine a realistic private-party value range (value_low to value_high) for this vehicle in this condition and mileage.
3. ${v.price
    ? 'Compare the asking price to that range. Give a one-line verdict plus a tier: "good" (at or below fair market value), "fair" (within normal market range), or "high" (notably above market).'
    : 'No asking price was given. Give a one-line verdict summarizing what this vehicle is worth, and set verdict_tier to "fair".'}
4. Write a short analysis (3-5 sentences, plain language, no markdown formatting) explaining the reasoning. Mention mileage impact, trim and condition factors, and how it compares to similar listings you found.

Respond with ONLY a raw JSON object. No markdown code fences. No text before or after it. Use exactly this shape:
{"value_low":8000,"value_high":11500,"verdict":"short one-line verdict","verdict_tier":"good","analysis":"short paragraph","sources_note":"short mention of what kind of sources were used"}

verdict_tier must be exactly one of: good, fair, high.
value_low and value_high must be plain numbers with no commas, dollar signs, or quotes.`;
}

async function callGemini(model, apiKey, prompt, useSearch) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    }
  );

  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

function parseGeminiText(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) return null;
  const parts = (candidate.content && candidate.content.parts) || [];
  const joined = parts.map(p => p.text || '').filter(Boolean).join('\n');
  return joined || null;
}

function extractJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function shortError(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.error && parsed.error.message) {
      return String(parsed.error.message).slice(0, 400);
    }
  } catch (e) { /* fall through */ }
  return String(rawText).slice(0, 400);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing its GEMINI_API_KEY environment variable. Add it in Vercel under Settings > Environment Variables, then redeploy.'
    });
  }

  const v = req.body || {};
  if (!v.year || !v.make || !v.model) {
    return res.status(400).json({ error: 'Year, make, and model are required.' });
  }

  const prompt = buildPrompt(v);
  let lastStatus = null;
  let lastDetail = null;

  for (const model of MODELS) {
    for (const useSearch of [true, false]) {
      let result;
      try {
        result = await callGemini(model, apiKey, prompt, useSearch);
      } catch (err) {
        lastStatus = 500;
        lastDetail = `Network error calling ${model}: ${err.message}`;
        continue;
      }

      if (result.ok) {
        const text = parseGeminiText(result.text);
        if (!text) {
          lastStatus = 502;
          lastDetail = `${model} returned no usable text.`;
          continue;
        }
        const parsed = extractJson(text);
        if (!parsed) {
          lastStatus = 502;
          lastDetail = `${model} response was not valid JSON: ${text.slice(0, 200)}`;
          continue;
        }

        ['value_low', 'value_high'].forEach(key => {
          if (typeof parsed[key] === 'string') {
            const n = parseInt(parsed[key].replace(/[^0-9]/g, ''), 10);
            parsed[key] = Number.isFinite(n) ? n : null;
          }
        });

        parsed.model_used = model;
        parsed.search_used = useSearch;
        if (!useSearch) {
          parsed.sources_note = (parsed.sources_note || '') +
            ' (Note: live web search was unavailable for this request, so this estimate comes from the model\'s general knowledge. Check the value links above to confirm.)';
        }

        return res.status(200).json(parsed);
      }

      lastStatus = result.status;
      lastDetail = `${model}${useSearch ? ' with search' : ' without search'}: ${shortError(result.text)}`;

      if (result.status === 401 || result.status === 403) {
        return res.status(502).json({
          error: 'Google rejected the API key. Check that GEMINI_API_KEY is correct in Vercel, and that the key has no IP or referrer restrictions.',
          detail: lastDetail
        });
      }
    }
  }

  let message;
  if (lastStatus === 429) {
    message = 'Google returned a quota error. This can mean the per-minute free tier limit, or that the daily free quota for this model is used up. Wait a minute and try again.';
  } else if (lastStatus === 404) {
    message = 'None of the model names worked — Google may have renamed them. Check ai.google.dev/gemini-api/docs/models and update the MODELS list in api/appraise.js.';
  } else if (lastStatus === 400) {
    message = 'Google rejected the request. The exact reason is below.';
  } else {
    message = 'The valuation service could not be reached. The exact error is below.';
  }

  return res.status(502).json({ error: message, detail: lastDetail });
}
