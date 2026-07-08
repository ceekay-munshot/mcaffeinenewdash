// P2b — live "digital shelf" for competitors: scrape marketplace pages for each
// competitor brand and attach price / rating / review / discount signals.
//
// Cache-first; paid Firecrawl calls gated behind --live.
//   node scripts/firecrawl/shelf.mjs                     # cache-only (free)
//   node scripts/firecrawl/shelf.mjs --live --limit 2    # scrape 2 brands
//   node scripts/firecrawl/shelf.mjs --live --only Plum --channel nykaa
//
// Snapshots cached under data/shelf-cache/{channel}/{brand}.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scrapeExtract, firecrawlBase } from "./client.mjs";
import { summarizeShelf } from "./summarize.mjs";

const ENTITIES = "data/clean/entities.json";
const CACHE_DIR = "data/shelf-cache";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const LIVE = has("--live");
const REFRESH = has("--refresh");
const LIMIT = val("--limit") ? Number(val("--limit")) : Infinity;
const ONLY = val("--only");
const CHANNELS = (val("--channel") ? [val("--channel")] : ["nykaa"]); // nykaa = biggest BPC platform

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// marketplace search URLs (brand-level; category refinement comes later)
const CHANNEL_URL = {
  nykaa: (brand) => `https://www.nykaa.com/search/result/?q=${encodeURIComponent(brand)}`,
  amazon: (brand) => `https://www.amazon.in/s?k=${encodeURIComponent(brand + " skincare")}`,
};

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          priceINR: { type: "number" },
          mrpINR: { type: "number" },
          rating: { type: "number" },
          reviewCount: { type: "number" },
          url: { type: "string" },
        },
      },
    },
  },
};
const PROMPT =
  "Extract every product listed on this page. For each product return: " +
  "name; priceINR = current selling price in INR (integer); mrpINR = original/struck-through MRP in INR; " +
  "rating = the STAR rating, a decimal from 0 to 5 (e.g. 4.3) — NEVER the number of reviews; " +
  "reviewCount = the COUNT of ratings/reviews, an integer that is often in the hundreds or thousands (e.g. 141531); " +
  "url = the product link. rating and reviewCount are different fields — do not put the review count in rating.";

function cachePath(channel, brandKey) {
  return join(CACHE_DIR, channel, `${brandKey}.json`);
}

async function getSnapshot(channel, brand) {
  const brandKey = norm(brand);
  const path = cachePath(channel, brandKey);
  if (!REFRESH && existsSync(path)) return { snap: JSON.parse(readFileSync(path, "utf8")), from: "cache" };
  if (!LIVE) return { snap: null, from: "skip" };

  const url = CHANNEL_URL[channel]?.(brand);
  if (!url) return { snap: null, from: `no url builder for ${channel}` };
  const res = await scrapeExtract(url, PRODUCT_SCHEMA, PROMPT);
  if (!res.ok || !res.json) return { snap: null, from: `scrape ${res.status}` };
  const products = Array.isArray(res.json.products) ? res.json.products : [];
  const snap = { brand, brandKey, channel, url, scrapedAt: new Date().toISOString(), products };
  mkdirSync(join(CACHE_DIR, channel), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return { snap, from: "scraped" };
}

// ---- run --------------------------------------------------------------------

const data = JSON.parse(readFileSync(ENTITIES, "utf8"));
// one target per competitor brand
const brands = new Map();
for (const e of data.entities) {
  if (!e.category.startsWith("Competitor")) continue;
  const key = norm(e.brand);
  if (!brands.has(key)) brands.set(key, e.brand);
}
let targets = [...brands.values()];
if (ONLY) targets = targets.filter((b) => norm(b) === norm(ONLY) || b.toLowerCase().includes(ONLY.toLowerCase()));

console.log(`Firecrawl shelf — base=${firecrawlBase} live=${LIVE} channels=${CHANNELS.join(",")}`);
console.log(`Targets: ${targets.length} competitor brands` + (Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""));

let scraped = 0;
const summaries = new Map(); // brandKey -> snapshots[]
for (const brand of targets) {
  if (scraped >= LIMIT * CHANNELS.length && !existsSync(cachePath(CHANNELS[0], norm(brand)))) continue;
  const snaps = [];
  for (const channel of CHANNELS) {
    const { snap, from } = await getSnapshot(channel, brand);
    if (snap) { snaps.push(snap); if (from === "scraped") scraped++; }
    if (from !== "skip" && from !== "cache") console.log(`  · ${brand} [${channel}] ${from}`);
  }
  if (snaps.length) {
    summaries.set(norm(brand), snaps);
    const s = summarizeShelf(snaps);
    console.log(`  ✓ ${brand}: ${s?.skuCount ?? 0} SKUs, avgRating=${s?.avgRating}, avgDiscount=${s?.avgDiscountPct}%`);
  }
}

// attach shelf summary to competitor entities
let attached = 0;
for (const e of data.entities) {
  if (!e.category.startsWith("Competitor")) continue;
  const snaps = summaries.get(norm(e.brand));
  if (snaps) { e.shelf = summarizeShelf(snaps); attached++; }
}
writeFileSync(ENTITIES, JSON.stringify(data, null, 2));

console.log(`\nDone. scraped=${scraped} | entity rows with shelf data: ${attached}`);
if (!LIVE) console.log("(cache-only — run with --live and FIRECRAWL_API_KEY to scrape)");
const cacheCount = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).length : 0;
console.log(`Cache dir: ${CACHE_DIR}/ (${cacheCount} channel folders)`);
