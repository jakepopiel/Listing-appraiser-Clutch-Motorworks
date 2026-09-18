// Serverless function that holds your Google Gemini API key privately and relays
// requests. The browser never sees the key — it only calls this endpoint.
//
// Set GEMINI_API_KEY in your Vercel project's Environment Variables.
// Get a free key at https://aistudio.google.com/apikey — no credit card required.

// Flash-class models are the ones available on Google's free tier.
// If this model name ever stops working, check https://ai.google.dev/gemini-api/docs/models
// for the current free-tier Flash model and change it here.
const MODEL = 'gemini-flash-latest';

const PROMPT_INSTRUCTIONS = `You are a car valuation assistant. Below is raw text from a marketplace listing (Facebook Marketplace, OfferUp, or Craigslist).

Do the following:
1. Extract: year, make, model, trim (if mentioned), mileage, asking price, and condition notes.
2. Search the web for current market values for this specific vehicle (year/make/model/trim at this mileage) — use sources like Kelley Blue Book, Edmunds, NADA/J.D. Power guides, or comparable recent listings and sale data.
3. Determine a realistic private-party value range (value_low to value_high) for a vehicle in that condition and mileage.
4. Compare the asking price to that range. Produce a one-line verdict plus a tier: "good" (priced at or below fair market value), "fair" (within normal market range), or "high" (priced notably above market).
5. Write a short analysis (3-5 sentences, plain language, no markdown formatting) explaining the reasoning — mention mileage impact, trim and condition factors, and how it compares to similar listings you found.

Respond with ONLY a raw JSON object. No markdown code fences. No text before or after it. Use exactly this shape:
{"year":"2016","make":"GMC","model":"Sierra 1500","trim":"SLE or null if unknown","mileage":194000,"asking_price":9500,"condition":"short condition summary or null","value_low":8000,"value_high":11500,"verdict":"short one-line verdict","verdict_tier":"good","analysis":"short paragraph","sources_note":"short mention of what kind of sources were used"}

verdict_tier must be exactly one of: good, fair, high.
All price and mileage values must be plain numbers with no commas, dollar signs, or quotes.

If the text is not a vehicle listing, or is missing year, make, and model entirely, respond with:
{"error":"explanation of what's missing"}

LISTING TEXT:
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing its GEMINI_API_KEY environment variable. Add it in your Vercel project settings and redeploy.'
    });
  }

  const listing = (req.body && req.body.listing ? String(req.body.listing) : '').trim();
  if (!listing) {
    return res.status(400).json({ error: 'No listing text was provided.' });
  }

  const trimmed = listing.slice(0, 6000);

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: PROMPT_INSTRUCTIONS + trimmed }]
            }
          ],
          // Google Search grounding — this is what lets it look up current values.
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048
          }
        })
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('Gemini API error:', upstream.status, detail);

      if (upstream.status === 429) {
        return res.status(429).json({
          error: 'Hit the free tier rate limit. Wait a minute and try again.'
        });
      }
      if (upstream.status === 400 && detail.includes('API_KEY')) {
        return res.status(502).json({
          error: 'The API key was rejected. Check that GEMINI_API_KEY is set correctly in Vercel.'
        });
      }
      if (upstream.status === 404) {
        return res.status(502).json({
          error: `The model "${MODEL}" was not found — Google may have renamed it. Check ai.google.dev/gemini-api/docs/models and update MODEL in api/appraise.js.`
        });
      }

      return res.status(502).json({
        error: `The valuation service returned an error (${upstream.status}).`
      });
    }

    const data = await upstream.json();

    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(502).json({ error: 'The valuation service returned an empty response. Try again.' });
    }

    const fullText = ((candidate.content && candidate.content.parts) || [])
      .map(part => part.text || '')
      .filter(Boolean)
      .join('\n');

    if (!fullText) {
      return res.status(502).json({ error: 'The valuation service returned no text. Try again.' });
    }

    const cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error('Unparseable response:', fullText.slice(0, 500));
      return res.status(502).json({ error: 'Could not read a valuation from the response. Try again.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      console.error('JSON parse failed:', cleaned.slice(0, 500));
      return res.status(502).json({ error: 'Could not parse the valuation response. Try again.' });
    }

    // Normalize number fields in case they come back as "$9,500" style strings
    ['mileage', 'asking_price', 'value_low', 'value_high'].forEach(key => {
      if (typeof parsed[key] === 'string') {
        const n = parseInt(parsed[key].replace(/[^0-9]/g, ''), 10);
        parsed[key] = Number.isFinite(n) ? n : null;
      }
    });

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong reaching the valuation service. Try again in a moment.' });
  }
}
