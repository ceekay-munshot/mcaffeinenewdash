// Firecrawl client — scrapes a marketplace page and returns structured product
// data via Firecrawl's built-in extraction (no separate LLM call needed for the
// structured fields). Key + base URL from env so no secret lands in code.
//   FIRECRAWL_API_KEY   (required for live calls)
//   FIRECRAWL_BASE_URL  (default https://api.firecrawl.dev)
//
// Every scrape spends Firecrawl credits, so callers gate this behind --live.

const BASE = process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev";

function authHeader() {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY not set — cannot make live Firecrawl calls.");
  return { Authorization: `Bearer ${k}`, "content-type": "application/json" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

// Scrape a URL and extract structured JSON matching `schema`.
// Uses the v1 /scrape endpoint with the json format. Retries transient failures
// (timeouts / rate limits / 5xx) with backoff so one slow page doesn't drop a brand.
export async function scrapeExtract(url, schema, prompt, { retries = 3 } = {}) {
  let last = { ok: false, status: 0, json: null, raw: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/scrape`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ url, onlyMainContent: true, formats: ["json"], jsonOptions: { schema, prompt }, waitFor: 2500 }),
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      const json = body?.data?.json ?? body?.data?.extract ?? body?.json ?? null;
      last = { ok: res.ok, status: res.status, json, raw: body };
      if (res.ok || !RETRYABLE.has(res.status)) return last;
    } catch (e) {
      last = { ok: false, status: 0, json: null, raw: String(e) };
    }
    if (attempt < retries) await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s
  }
  return last;
}

export const firecrawlBase = BASE;
