// Phase 1 — "prep station": read every messy company folder under data/raw/
// and emit one clean, uniform record per company into data/clean/entities.json
//
// The raw Tracxn/web-research JSON was produced by many different AI runs, so the
// same fact hides under different key names (entityId | cin | entityId_CIN,
// latestRevenue.INR | latestRevenue_INR, legal_entity | legalEntities | legal_entity_record).
// This script is deliberately schema-tolerant: it searches recursively by pattern
// rather than trusting one fixed shape.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractProbe } from "./probe/extract.mjs";

const RAW_DIR = process.env.RAW_DIR || "data/raw";
const OUT_FILE = process.env.OUT_FILE || "data/clean/entities.json";

const CIN_RE = /\b([LUu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6})\b/;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/;

// ---- recursive helpers -----------------------------------------------------

function* walk(node, key = null) {
  yield [key, node];
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) yield* walk(v, k);
  }
}

// Find the first value whose KEY matches keyRe. `accept` turns a raw value into
// the result we want (return undefined to keep searching).
function findByKey(root, keyRe, accept) {
  for (const [k, v] of walk(root)) {
    if (k && keyRe.test(k)) {
      const got = accept(v);
      if (got !== undefined && got !== null) return got;
    }
  }
  return undefined;
}

// Parse an INR amount out of a free-text money string like
// "214.57 Cr (Rs 2,145,683,000)" or "₹58.3 Cr". Ranges ("100-500 Cr") are
// skipped to avoid inventing a precise-looking wrong number.
function parseMoneyINR(s) {
  let m = s.replace(/,/g, "").match(/(?:Rs|₹|INR)\s*(\d{6,})/i);
  if (m) return Number(m[1]);
  if (/\d\s*[-–]\s*\d/.test(s)) return undefined; // a range — ambiguous
  m = s.match(/(\d+(?:\.\d+)?)\s*Cr\b/i);
  if (m) return Math.round(Number(m[1]) * 1e7);
  return undefined;
}

// Pull an INR money amount out of a value that might be a number, a string,
// or {INR|amountINR|value: ...}.
function asINR(v) {
  if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? v : undefined;
  if (typeof v === "string") return parseMoneyINR(v);
  if (v && typeof v === "object") {
    for (const k of ["INR", "amountINR", "value"]) {
      const n = asINR(v[k]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

function asNumber(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.value === "number") return v.value;
  return undefined;
}

function firstString(root, keyRe) {
  return findByKey(root, keyRe, (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined));
}
function firstNum(root, keyRe) {
  return findByKey(root, keyRe, (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined));
}
function firstArray(root, keyRe) {
  return findByKey(root, keyRe, (v) => (Array.isArray(v) && v.length ? v : undefined));
}
function firstObject(root, keyRe) {
  return findByKey(root, keyRe, (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined));
}
const strv = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const usdM = (n) => (typeof n === "number" ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : "");

// Competitor-specific enrichment (funding, M&A, cap-table signals) — P2.
function extractCompetitor(blob) {
  const stage = firstString(blob, /^stage$/i);
  const strList = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  const founders = strList(firstArray(blob, /keyPeople|key_people|founders/i)).filter((p) => /founder|ceo/i.test(p));
  const investors = strList(firstArray(blob, /^investors$/i));
  const geoServed = strList(firstArray(blob, /geoServed|geographies/i));
  const hqCity = firstString(blob, /^hqCity$/i);
  const fundingUSD = firstNum(blob, /totalEquityFundingUSD|totalFundingUSD/i) ?? null;

  const lr = firstObject(blob, /latestFundingRound/i);
  const latestRound = lr
    ? { name: strv(lr.name), date: strv(lr.date || lr.roundDate), amountUSD: typeof lr.amountUSD === "number" ? lr.amountUSD : null }
    : null;

  const acq = firstObject(blob, /latestAcquiredBy|acquiredBy/i);
  const acquiredBy = acq
    ? { acquirer: strv(acq.acquirer || acq.name), amountUSD: typeof acq.amountUSD === "number" ? acq.amountUSD : null, date: strv(acq.date) }
    : null;

  let materialEvent = null;
  if (acquiredBy?.acquirer)
    materialEvent = `Acquired by ${acquiredBy.acquirer}${usdM(acquiredBy.amountUSD) ? " · " + usdM(acquiredBy.amountUSD) : ""}${acquiredBy.date ? " · " + acquiredBy.date : ""}`;
  else if (latestRound?.name || latestRound?.amountUSD)
    materialEvent = `${latestRound.name || "Funding"}${usdM(latestRound.amountUSD) ? " · " + usdM(latestRound.amountUSD) : ""}${latestRound.date ? " · " + latestRound.date : ""}`;

  return { stage: stage ?? null, founders, investors, geoServed, hqCity: hqCity ?? null, fundingUSD, latestRound, acquiredBy, materialEvent };
}

// Search every string in the blob for a regex (CIN / PAN live in many places).
function findPattern(root, re) {
  for (const [, v] of walk(root)) {
    if (typeof v === "string") {
      const m = v.match(re);
      if (m) return m[1];
    }
  }
  return undefined;
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ---- master-sheet fallback (fills CIN / legal name for PDF-only companies) --

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function buildMasterIndex() {
  const idx = new Map(); // normalized name -> {cin, legalName, tracxnUrl}
  const put = (name, rec) => {
    const k = norm(name);
    if (!k) return;
    const cur = idx.get(k) || {};
    idx.set(k, {
      cin: cur.cin || rec.cin || null,
      legalName: cur.legalName || rec.legalName || null,
      tracxnUrl: cur.tracxnUrl || rec.tracxnUrl || null,
    });
  };
  const ver = readJSON(join(RAW_DIR, "masters/entity_verification.json"));
  for (const row of ver?.["Tracxn Verification"] || []) {
    const cinRaw = row["Registration ID (CIN/Reg No.)"] || "";
    const cin = (cinRaw.match(CIN_RE) || [])[1] || null;
    const rec = {
      cin,
      legalName: row["Linked Legal Entity (Primary Source)"] || row["Matched Company / Brand (Tracxn)"] || null,
      tracxnUrl: row["Tracxn URL(s)"] || null,
    };
    put(row["Entity Name (as in file)"], rec);
    put(row["Matched Company / Brand (Tracxn)"], rec);
  }
  const fin = readJSON(join(RAW_DIR, "masters/final_extraction_list.json"));
  for (const row of fin?.["Sheet1"] || []) {
    const rec = {
      cin: null,
      legalName: row["Linked Legal Entity (Primary Source)"] || null,
      tracxnUrl: row["Tracxn URL(s)"] || null,
    };
    put(row["Entity Name (as in file)"], rec);
    put(row["Matched Company / Brand (Tracxn)"], rec);
  }
  return idx;
}

const MASTER = buildMasterIndex();

function masterLookup(...names) {
  for (const n of names) {
    const hit = MASTER.get(norm(n));
    if (hit) return hit;
  }
  return {};
}

// ---- per-company extraction ------------------------------------------------

function extract(category, folder, dir) {
  const tracxn = readJSON(join(dir, "tracxn_data.json"));
  const web = readJSON(join(dir, "web_research.json"));
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const blob = { tracxn, web };

  let cin = findPattern(blob, CIN_RE);
  const pan = findPattern(blob, PAN_RE);

  const revenueINR = findByKey(blob, /revenue/i, asINR);
  const ebitdaINR = findByKey(blob, /ebitda/i, asINR);
  const netProfitINR = findByKey(blob, /(net[_\s]?profit|netprofit|pat\b)/i, asINR);
  const ebitdaMarginPct = findByKey(blob, /ebitda.?margin/i, asNumber);
  const netMarginPct = findByKey(blob, /(net.?profit.?margin|net.?margin)/i, asNumber);
  const revenueCAGR3yr = findByKey(blob, /cagr.?3/i, asNumber);
  const employeeCount = findByKey(blob, /employee.?count/i, asNumber);

  // legal name: prefer an explicit legal-entity name, else the brand/company name
  const legalName =
    firstString(blob, /^(name|legalName|legal_name)$/i) ||
    firstString(blob, /entity.?name/i);
  const brand =
    firstString({ tracxn: tracxn?.company ?? tracxn?.company_record, web }, /^name$/i) ||
    folder;

  const website = firstString(blob, /^(website|domain|url)$/i);
  const incorporationDate = findByKey(blob, /incorporation/i, (v) =>
    typeof v === "string" ? v : v && v.year ? `${v.year}-${v.month ?? 1}-${v.day ?? 1}` : undefined
  );
  const statusAtRegistrar = firstString(blob, /statusAtRegistrar|registrarStatus/i);
  const entityType = firstString(blob, /mappedEntityType|entityType|typeOfEntity/i);
  const parent = firstString(blob, /^(partOf|parent|parentCompany)$/i);

  // funding / acquisitions — relevant mostly for competitors
  let fundingRounds = 0;
  let acquisitions = 0;
  for (const [k, v] of walk(blob)) {
    if (k && /funding.?rounds?$/i.test(k) && Array.isArray(v)) fundingRounds = Math.max(fundingRounds, v.length);
    if (k && /acquisitions?$/i.test(k) && Array.isArray(v)) acquisitions = Math.max(acquisitions, v.length);
  }

  // Fill CIN / legal name / tracxn URL from the master sheets when the
  // folder itself only shipped a PDF (common for PM vendors & delivery partners).
  const m = masterLookup(folder, brand, legalName);
  if (!cin && m.cin) cin = m.cin;
  const finalLegalName = legalName || m.legalName || null;
  const tracxnUrl = firstString(blob, /tracxnPlatformUrl|tracxn.?url/i) || m.tracxnUrl || null;

  // coverage signal:
  //   full     = identified + has financials
  //   partial  = identified (CIN or legal name) but numbers still to be pulled
  //   not_found = couldn't be resolved to a legal entity at all
  let coverage;
  if (cin && revenueINR) coverage = "full";
  else if (cin || revenueINR || finalLegalName) coverage = "partial";
  else coverage = "not_found";

  return {
    category,
    folder,
    brand,
    legalName: finalLegalName,
    cin: cin || null,
    pan: pan || null,
    coverage,
    tracxnUrl,
    website: website || null,
    incorporationDate: incorporationDate || null,
    entityType: entityType || null,
    statusAtRegistrar: statusAtRegistrar || null,
    parent: parent || null,
    financials: {
      revenueINR: revenueINR ?? null,
      ebitdaINR: ebitdaINR ?? null,
      netProfitINR: netProfitINR ?? null,
      ebitdaMarginPct: ebitdaMarginPct ?? null,
      netMarginPct: netMarginPct ?? null,
      revenueCAGR3yrPct: revenueCAGR3yr ?? null,
      employeeCount: employeeCount ?? null,
    },
    funding: { rounds: fundingRounds, acquisitions },
    competitor: category.startsWith("Competitor") ? extractCompetitor(blob) : undefined,
    sources: {
      tracxn: !!tracxn,
      webResearch: !!web,
      pdfs: files.filter((f) => f.toLowerCase().endsWith(".pdf")).length,
    },
  };
}

// ---- run over all categories/companies ------------------------------------

const entities = [];
for (const category of readdirSync(RAW_DIR)) {
  if (category === "masters") continue;
  const catDir = join(RAW_DIR, category);
  if (!statSync(catDir).isDirectory()) continue;
  for (const folder of readdirSync(catDir)) {
    const dir = join(catDir, folder);
    if (!statSync(dir).isDirectory()) continue;
    entities.push(extract(category, folder, dir));
  }
}

// Attach Probe42 deep financials from the paid cache (if any), so probe data
// survives a full rebuild without re-hitting the API.
const PROBE_CACHE = join("data", "probe-cache");
if (existsSync(PROBE_CACHE)) {
  const byCin = new Map(entities.filter((e) => e.cin).map((e) => [e.cin, e]));
  for (const f of readdirSync(PROBE_CACHE)) {
    if (!f.endsWith(".json")) continue;
    const e = byCin.get(f.replace(/\.json$/, ""));
    if (!e) continue;
    try {
      e.probe = extractProbe(JSON.parse(readFileSync(join(PROBE_CACHE, f), "utf8")));
    } catch { /* skip unreadable cache entry */ }
  }
}

entities.sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand));

const generatedAt = process.env.BUILD_STAMP || new Date().toISOString();
writeFileSync(
  OUT_FILE,
  JSON.stringify({ generatedAt, count: entities.length, entities }, null, 2)
);

// ---- console report --------------------------------------------------------

const by = {};
for (const e of entities) {
  const b = (by[e.category] ??= { n: 0, cin: 0, rev: 0, full: 0 });
  b.n++;
  if (e.cin) b.cin++;
  if (e.financials.revenueINR) b.rev++;
  if (e.coverage === "full") b.full++;
}
console.log(`\nNormalized ${entities.length} companies → ${OUT_FILE}\n`);
console.log("CATEGORY".padEnd(26) + "n".padStart(4) + "CIN".padStart(6) + "Rev".padStart(6) + "Full".padStart(6));
for (const cat of Object.keys(by).sort()) {
  const b = by[cat];
  console.log(cat.padEnd(26) + String(b.n).padStart(4) + String(b.cin).padStart(6) + String(b.rev).padStart(6) + String(b.full).padStart(6));
}
