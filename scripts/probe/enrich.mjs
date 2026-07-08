// Phase 3 — enrich the clean dataset with Probe42 deep financials
// (receivable/payable days, RoCE, cash-conversion-cycle, credit rating).
//
// Operates on the committed data/clean/entities.json (does NOT need data/raw),
// so it can run in CI. Paid API calls are gated behind --live; without it the
// script only rebuilds `probe` blocks from the local cache (free & safe).
//
//   node scripts/probe/enrich.mjs                 # cache-only, no API calls
//   node scripts/probe/enrich.mjs --live --limit 2   # fetch up to 2 uncached cos
//   node scripts/probe/enrich.mjs --live --only U74110MH2000PTC126561
//   node scripts/probe/enrich.mjs --live --refresh   # ignore cache, re-fetch
//
// Raw comprehensive responses are cached under data/probe-cache/{cin}.json — the
// paid "asset", kept so we never re-pay for the same fetch.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { probe } from "./client.mjs";
import { extractProbe, findFirst } from "./extract.mjs";

const ENTITIES = "data/clean/entities.json";
const CACHE_DIR = "data/probe-cache";
const SUPPLY = new Set(["RM Vendor", "PM Vendor", "Manufacturer"]);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const LIVE = has("--live");
const REFRESH = has("--refresh");
const LIMIT = val("--limit") ? Number(val("--limit")) : Infinity;
const ONLY = val("--only");

mkdirSync(CACHE_DIR, { recursive: true });

// ---- fetch (or read cache) --------------------------------------------------

function cachePath(cin) { return join(CACHE_DIR, `${cin}.json`); }

async function getComprehensive(cin) {
  if (!REFRESH && existsSync(cachePath(cin))) {
    return { raw: JSON.parse(readFileSync(cachePath(cin), "utf8")), from: "cache" };
  }
  if (!LIVE) return { raw: null, from: "skip" };

  const status = await probe.dataStatus(cin);
  if (!status.ok) return { raw: null, from: `datastatus ${status.status}` };
  const last = findFirst(status.body, "last_details_updated");
  if (last == null) {
    const upd = await probe.requestUpdate(cin);
    const reqId = findFirst(upd.body, "request_id");
    return { raw: null, from: `update-requested${reqId ? " " + reqId : ""} (async ~4h)` };
  }
  const comp = await probe.comprehensive(cin);
  if (!comp.ok) return { raw: null, from: `comprehensive ${comp.status}` };
  writeFileSync(cachePath(cin), JSON.stringify(comp.body, null, 2));
  return { raw: comp.body, from: "fetched" };
}

// ---- run --------------------------------------------------------------------

const data = JSON.parse(readFileSync(ENTITIES, "utf8"));
let targets = data.entities.filter((e) => SUPPLY.has(e.category) && e.cin && e.coverage !== "not_found");
if (ONLY) targets = targets.filter((e) => e.cin === ONLY || e.folder === ONLY);

console.log(`Probe42 enrich — base=${probe.base} env=${probe.env} live=${LIVE}`);
console.log(`Targets: ${targets.length} supply-side companies with a CIN` + (Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""));

let fetched = 0, cached = 0, skipped = 0;
for (const e of targets) {
  if (fetched >= LIMIT && !existsSync(cachePath(e.cin))) { skipped++; continue; }
  const { raw, from } = await getComprehensive(e.cin);
  if (raw) {
    e.probe = { ...extractProbe(raw), fetchedAt: new Date().toISOString() };
    if (from === "fetched") fetched++; else cached++;
    console.log(`  ✓ ${e.brand} (${e.cin}) [${from}] recvDays=${e.probe.receivableDays} payDays=${e.probe.payableDays} roce=${e.probe.roce}`);
  } else {
    skipped++;
    if (from !== "skip") console.log(`  · ${e.brand} (${e.cin}) — ${from}`);
  }
}

// keep count of how many entities now carry probe data
const enriched = data.entities.filter((e) => e.probe).length;
data.probeEnrichedCount = enriched;
writeFileSync(ENTITIES, JSON.stringify(data, null, 2));

console.log(`\nDone. fetched=${fetched} fromCache=${cached} skipped=${skipped} | entities with probe data: ${enriched}`);
if (!LIVE && cached === 0) console.log("(cache empty — run with --live and PROBE42_API_KEY to pull real data)");
console.log(`Cache dir: ${CACHE_DIR}/  (${existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).length : 0} files)`);
