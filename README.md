# Listing Appraiser — free setup guide

Paste a car listing from Facebook Marketplace, OfferUp, or Craigslist. Get value
lookup links plus an AI assessment of whether the asking price is fair.

**Total cost: $0.** Vercel's free tier hosts it; Google's free Gemini tier powers
the AI summary. No credit card needed for either.

---

## What's in here

```
appraiser-gemini/
├── api/
│   └── appraise.js      ← serverless function; holds your key, calls Gemini
├── public/
│   └── index.html       ← the page itself
├── package.json
├── vercel.json
└── README.md
```

---

## Step 1 — Get a free Gemini API key

1. Go to **aistudio.google.com/apikey**
2. Sign in with a Google account.
3. Click **Create API key**. Pick a project or let it make one.
4. Copy the key somewhere safe.

No credit card, no billing setup. You land on the free tier automatically.

**Two things to know about the free tier:**
- **Rate limits.** Fine for personal use — you'd only hit them running many
  lookups per minute. If you do, you'll see a "rate limit" message; wait a minute.
- **Google may use free-tier prompts to improve their products.** Not a concern
  for public car listings, but worth knowing. Paid tier removes this.

> Treat the key like a password. Never paste it into the HTML file or commit it
> to a public repo — it belongs only in Vercel's environment variables.

---

## Step 2 — Put this project on GitHub

If you already use git, push this folder to a new repo.

If not:

1. Go to **github.com** → **New repository** → name it `listing-appraiser` → Create.
2. On the new repo page, click **uploading an existing file**.
3. Drag in the `api` folder, the `public` folder, `package.json`, and `vercel.json`.
4. Click **Commit changes**.

---

## Step 3 — Deploy to Vercel

1. Go to **vercel.com** and sign in with GitHub.
2. Click **Add New** → **Project**.
3. Find `listing-appraiser` and click **Import**.
4. **Before clicking Deploy**, expand **Environment Variables** and add:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your key from Step 1
5. Click **Deploy**.

About a minute later you get a URL like
`https://listing-appraiser-yourname.vercel.app`.

---

## Step 4 — Use it

Open the URL on any device. Paste a listing, click **Get value links** for the
lookup links, then **Get AI summary** for the price assessment.

On your phone: **Share → Add to Home Screen** and it behaves like an app.

---

## If something doesn't work

**"Server is missing its GEMINI_API_KEY"**
The variable wasn't saved. In Vercel: **Settings → Environment Variables**, add
it, then **Deployments → ⋯ → Redeploy**.

**"The API key was rejected"**
Wrong key, or it has restrictions. If you set referrer/IP restrictions in Google
Cloud Console, remove them — Vercel's servers won't match.

**"Hit the free tier rate limit"**
Exactly what it says. Wait a minute.

**"The model was not found — Google may have renamed it"**
Google changes model names periodically. Check
**ai.google.dev/gemini-api/docs/models**, find the current free-tier Flash model,
and change the `MODEL` line near the top of `api/appraise.js`.

**AI summary times out**
Search grounding can be slow. `vercel.json` sets a 60-second limit. Try again.

**Value links go to a 404**
Direct KBB/Edmunds URLs are built from the parsed model name, which isn't perfect
on unusual listings. The Google-scoped search links below them always work.

---

## Editing later

Change files on GitHub; Vercel redeploys automatically within a minute. The
valuation instructions live in `PROMPT_INSTRUCTIONS` at the top of
`api/appraise.js` — edit that to change what the AI focuses on.

## Want to switch to Claude later?

Swap `api/appraise.js` for the version in the paid Anthropic bundle and change
the environment variable to `ANTHROPIC_API_KEY`. Nothing else changes — the page
just calls `/api/appraise` either way.
