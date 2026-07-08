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

// Scrape a URL and extract structured JSON matching `schema`.
// Uses the v1 /scrape endpoint with the json format. Shapes vary slightly by
// Firecrawl version, so the request is kept minimal and easy to adjust.
export async function scrapeExtract(url, schema, prompt) {
  const res = await fetch(`${BASE}/v1/scrape`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      url,
      onlyMainContent: true,
      formats: ["json"],
      jsonOptions: { schema, prompt },
      waitFor: 2500,
    }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  // v1 returns { success, data: { json: {...} } }
  const json = body?.data?.json ?? body?.data?.extract ?? body?.json ?? null;
  return { ok: res.ok, status: res.status, json, raw: body };
}

export const firecrawlBase = BASE;
