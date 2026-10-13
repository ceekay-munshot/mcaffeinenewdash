// One-off Probe42 fetcher for an EXTERNAL CIN list — the packaging vendors of our
// sister project "FDC". Mirrors scripts/probe/enrich.mjs but reads its own list
// (data/fdc-vendors.json) and caches into its own dir (fdc-probe-cache/), so it
// NEVER touches mcAffeine's own data/clean/entities.json or data/probe-cache/.
//
// It reuses the SAME Probe42 client (./client.mjs) — same endpoints, same env-driven
// auth (PROBE42_API_KEY, PROBE42_BASE_URL, PROBE42_PATH_PREFIX, …) — and the same
// datastatus→comprehensive credit-safe flow.
//
//   node scripts/probe/fetch-fdc.mjs --status              # FREE: datastatus only, 0 credits
//   node scripts/probe/fetch-fdc.mjs --live --limit 5      # PAID: pull comprehensive (default limit 15)
//   node scripts/probe/fetch-fdc.mjs --status --only U21014PN1987PTC012926,AAD-5116
//   node scripts/probe/fetch-fdc.mjs --live --limit 5 --only <CIN1,CIN2,...>   # fetch just these, in list order
//   node scripts/probe/fetch-fdc.mjs --live --include-unverified   # also fetch CINs we could not web-verify
//
// ── Credit safety ────────────────────────────────────────────────────────────
// Probe42's datastatus endpoint is FREE and is ALWAYS called first; empirically it
// returns ONLY data-availability (last_details_updated) and NO legal name, so the
// name cannot be verified before paying. We therefore gate the PAID call on:
//   1. datastatus shows data exists  → never pay for a company with no data;
//   2. the CIN↔name link is web-verified in fdc-vendors.json ("confirmed" /
//      "aggregator") → never pay for a CIN we could not tie to the expected company
//      (held unless --include-unverified); and
//   3. the vendor is NOT marked listed → listed companies come free from the FDC
//      screener, so we never spend a Probe42 credit on them.
// After the PAID fetch, the comprehensive response's legal_name IS present, so we
// check it against the expected name and FLAG any mismatch (keeping the paid file —
// paid data is never discarded). Already-cached CINs are never re-fetched.
//
// ── repo-cache preseed ───────────────────────────────────────────────────────
// A vendor may carry `source:"repo-cache"` + `repoCachePath` — a report already in
// THIS repo (e.g. Manjushree Technopack, cached as ALTERNICQ LIMITED). Those are
// COPIED into fdc-probe-cache/ for free (no API call), regardless of --only, so the
// output artifact carries them too. A `_labels.json` manifest maps every file in the
// cache dir to its display name + label (handy when the legal name differs, e.g.
// ALTERNICQ LIMITED = Manjushree Technopack).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { probe } from "./client.mjs";
import { extractProbe, findFirst } from "./extract.mjs";

const VENDORS = "data/fdc-vendors.json";
// Own cache dir at repo root — kept separate from mcAffeine's data/probe-cache so
// this one-off never mingles with mcAffeine's own entities. Copy this dir to FDC.
const CACHE_DIR = "fdc-probe-cache";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const LIVE = has("--live");
const STATUS_ONLY = has("--status");
const INCLUDE_UNVERIFIED = has("--include-unverified");
const LIMIT = val("--limit") ? Number(val("--limit")) : 15;
const ONLY = val("--only");
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;

// A valid Indian CIN: L/U/F + 5-digit industry code + 2-letter state + 4-digit year
// + 3-letter ownership + 6-digit RoC number. We ALSO accept an LLPIN (e.g. AAD-5116)
// for LLPs — datastatus is free, so attempting one costs nothing; if Probe42's
// company API doesn't cover LLPs the call simply errors and we skip (no credit).
// Anything else (null, "FIND CIN …") is treated as unresolved and never called.
const CIN_RE = /^[LUF]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const LLPIN_RE = /^[A-Z]{3}-?\d{4,}$/;
const isValidId = (c) => typeof c === "string" && (CIN_RE.test(c.trim()) || LLPIN_RE.test(c.trim()));
const isLlpin = (c) => typeof c === "string" && !CIN_RE.test(c.trim()) && LLPIN_RE.test(c.trim());
const WEB_VERIFIED = new Set(["confirmed", "aggregator"]);
const isRepoCache = (v) => String(v.source || "").toLowerCase() === "repo-cache";

// ---- name matching ----------------------------------------------------------
// Rough legal-name check. We strip company-form suffixes and punctuation, then
// accept if either normalized name contains the other, or they share a strong
// majority of significant tokens. Used as a hard gate IF datastatus returns a name,
// and always as a post-fetch sanity check against the comprehensive response.
const STOP = new Set([
  "private", "limited", "pvt", "ltd", "llp", "plc", "the", "india", "indian",
  "co", "company", "corp", "corporation", "and", "of", "&",
]);
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s) {
  return normName(s).split(" ").filter((t) => t && !STOP.has(t));
}
function nameMatches(expected, actual) {
  if (!actual) return { ok: false, score: 0, reason: "no name returned" };
  const a = tokens(expected), b = tokens(actual);
  if (!a.length || !b.length) return { ok: false, score: 0, reason: "empty after normalize" };
  const collapsedA = a.join(""), collapsedB = b.join("");
  if (collapsedA.includes(collapsedB) || collapsedB.includes(collapsedA)) {
    return { ok: true, score: 1, reason: "containment" };
  }
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  const score = shared / Math.min(a.length, b.length);
  return { ok: score >= 0.6, score: Math.round(score * 100) / 100, reason: `token-overlap ${shared}/${Math.min(a.length, b.length)}` };
}
// Pull a legal name out of a datastatus (usually none) or comprehensive response.
function legalNameOf(body) {
  for (const k of [
    "legal_name", "company_name", "name", "legalName", "companyName",
    "entity_name", "registered_name", "company_legal_name",
  ]) {
    const v = findFirst(body, k);
    if (v != null && v !== "") return v;
  }
  return null;
}

// ---- cache ------------------------------------------------------------------
function cachePath(cin) { return join(CACHE_DIR, `${cin}.json`); }
mkdirSync(CACHE_DIR, { recursive: true });

// ---- load vendors -----------------------------------------------------------
const doc = JSON.parse(readFileSync(VENDORS, "utf8"));
const allVendors = Array.isArray(doc.vendors) ? doc.vendors : [];
// repo-cache preseeds are handled separately and ALWAYS included (ignore --only).
const preseeds = allVendors.filter(isRepoCache);
let apiVendors = allVendors.filter((v) => !isRepoCache(v));
if (ONLY_SET) apiVendors = apiVendors.filter((v) => v.cin && ONLY_SET.has(String(v.cin).trim()));

console.log(`Probe42 FDC fetch — base=${probe.base} env=${probe.env} live=${LIVE}${STATUS_ONLY ? " (status-only)" : ""}`);
console.log(`Vendors: ${allVendors.length} total · ${preseeds.length} repo-cache preseed · ${apiVendors.length} via API${ONLY_SET ? ` (filtered by --only)` : ""}`);
if (LIVE && !STATUS_ONLY) console.log(`Paid-fetch cap (--limit): ${LIMIT} · include-unverified: ${INCLUDE_UNVERIFIED}`);
console.log(`Cache dir: ${CACHE_DIR}/\n`);

// ---- run --------------------------------------------------------------------
const summary = {
  preseeded: [],      // { name, cin, label }   (copied from repo cache — free)
  hasData: [],        // { name, cin, updated }
  noData: [],         // { name, cin }
  fetched: [],        // { name, cin, gotName, nameOk }   (comprehensive pulled = 1 credit each)
  alreadyCached: [],  // { name, cin }
  listed: [],         // { name, cin }   (listed co — skipped, use screener)
  heldUnverified: [], // { name, cin }   (data exists but CIN not web-verified — no credit)
  heldLimit: [],      // { name, cin }   (data exists & cleared but --limit reached)
  postFetchMismatch: [], // { name, cin, got }   (PAID, but legal name mismatched — flagged)
  errors: [],         // { name, cin, detail }
  unresolved: [],     // { name, cin }   (no valid CIN/LLPIN — never called)
};
let creditsSpent = 0;
let dumpedStatusBody = false;
const labelFor = {}; // cin -> { name, label, source } for _labels.json

// ---- 0) repo-cache preseed (free; always, even with --only) ------------------
for (const v of preseeds) {
  const cin = typeof v.cin === "string" ? v.cin.trim() : v.cin;
  const src = v.repoCachePath;
  const label = v.label || v.name;
  if (!src || !existsSync(src)) {
    console.log(`  ! ${v.name} — repo-cache file missing (${src ?? "no repoCachePath"}) — not included.`);
    summary.errors.push({ name: v.name, cin, detail: `repo-cache missing: ${src ?? "unset"}` });
    continue;
  }
  const dest = cachePath(cin);
  if (!existsSync(dest)) copyFileSync(src, dest);
  labelFor[cin] = { name: v.name, label, source: "repo-cache" };
  summary.preseeded.push({ name: v.name, cin, label });
  console.log(`  ⊕ preseeded (FREE, from repo cache) ${v.name}  [${label}] → ${dest}`);
}

// ---- 1) API vendors ----------------------------------------------------------
for (const v of apiVendors) {
  const { name } = v;
  const cin = typeof v.cin === "string" ? v.cin.trim() : v.cin;
  const verified = String(v.verified || "").toLowerCase();

  // Listed companies come free from the FDC screener — never spend a credit.
  if (v.listed) {
    console.log(`  ▣ ${name} (${cin}) — LISTED → skipped (use the FDC screener, not Probe42).`);
    summary.listed.push({ name, cin });
    continue;
  }

  if (!isValidId(cin)) {
    console.log(`  ⚠ ${name} — UNRESOLVED CIN (${v.cin ?? "null"}) — not called.`);
    summary.unresolved.push({ name, cin: v.cin ?? null });
    continue;
  }

  // 1) datastatus — FREE. Always first.
  const s = await probe.dataStatus(cin);
  if (!s.ok) {
    const extra = isLlpin(cin) ? " (LLPIN — Probe42 company API may not cover LLPs)" : "";
    console.log(`  ? ${name} (${cin}) — datastatus HTTP ${s.status}${extra}`);
    summary.errors.push({ name, cin, detail: `datastatus ${s.status}${extra}` });
    continue;
  }
  if (!dumpedStatusBody) {
    console.log(`  (raw datastatus body, 1st vendor, for schema inspection) ${JSON.stringify(s.body).slice(0, 600)}`);
    dumpedStatusBody = true;
  }
  const last = findFirst(s.body, "last_details_updated");
  const statusName = legalNameOf(s.body); // normally null for Probe42 datastatus

  const quota = Object.entries(s.headers || {}).filter(([k]) => /credit|quota|limit|remain|balance|usage/i.test(k));
  const quotaStr = quota.length ? `  [${quota.map(([k, val2]) => `${k}=${val2}`).join(" · ")}]` : "";

  if (last == null) {
    console.log(`  · ${name} (${cin}) — NO DATA ready on Probe42${quotaStr}`);
    summary.noData.push({ name, cin });
    continue;
  }

  console.log(`  ✓ ${name} (${cin}) — HAS DATA (updated ${last}) · verified=${verified || "n/a"}${statusName ? ` · datastatus-name="${statusName}"` : ""}${quotaStr}`);
  summary.hasData.push({ name, cin, updated: last });

  // 2) Pre-payment gate.
  if (statusName) {
    const m = nameMatches(name, statusName);
    if (!m.ok) {
      console.log(`      ↳ NAME MISMATCH in datastatus — skipping, NO credit spent (expected "${name}", got "${statusName}").`);
      summary.postFetchMismatch.push({ name, cin, got: statusName });
      continue;
    }
  } else if (!WEB_VERIFIED.has(verified) && !INCLUDE_UNVERIFIED) {
    console.log(`      ↳ HELD — CIN not web-verified (verified=${verified || "n/a"}) and datastatus carries no name. Pass --include-unverified to fetch it. NO credit spent.`);
    summary.heldUnverified.push({ name, cin });
    continue;
  }

  if (!LIVE) continue; // status survey mode: never pull the paid report

  // 3) comprehensive — PAID.
  if (existsSync(cachePath(cin))) {
    console.log(`      ↳ already cached (${cachePath(cin)}) — not re-fetching (no credit).`);
    labelFor[cin] = { name, label: v.label || name, source: "cached" };
    summary.alreadyCached.push({ name, cin });
    continue;
  }
  if (creditsSpent >= LIMIT) {
    console.log(`      ↳ --limit ${LIMIT} reached — not fetching (reported as held).`);
    summary.heldLimit.push({ name, cin });
    continue;
  }

  const comp = await probe.comprehensive(cin);
  if (!comp.ok) {
    console.log(`      ↳ comprehensive HTTP ${comp.status} — no data saved.`);
    summary.errors.push({ name, cin, detail: `comprehensive ${comp.status}` });
    continue;
  }
  writeFileSync(cachePath(cin), JSON.stringify(comp.body, null, 2));
  creditsSpent++;

  const compName = legalNameOf(comp.body);
  const pm = nameMatches(name, compName);
  const p = extractProbe(comp.body);
  labelFor[cin] = { name, label: v.label || name, source: "fetched" };
  if (!pm.ok) {
    console.log(`      ↳ ⚠ FETCHED but LEGAL NAME MISMATCH → ${cachePath(cin)} (credit #${creditsSpent}). Expected "${name}", Probe42 says "${compName ?? "n/a"}" (${pm.reason}). File kept — VERIFY before using.`);
    summary.postFetchMismatch.push({ name, cin, got: compName ?? null });
  } else {
    console.log(`      ↳ FETCHED → ${cachePath(cin)} (credit #${creditsSpent}) · legal_name="${compName ?? "n/a"}" ✓ · recvDays=${p.receivableDays} payDays=${p.payableDays} roce=${p.roce} rating=${p.creditRating}`);
  }
  summary.fetched.push({ name, cin, gotName: compName ?? null, nameOk: pm.ok });
}

// ---- labels manifest ---------------------------------------------------------
const cacheFiles = existsSync(CACHE_DIR)
  ? readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json") && f !== "_labels.json")
  : [];
const labels = {};
for (const f of cacheFiles) {
  const cin = f.replace(/\.json$/, "");
  labels[cin] = labelFor[cin] || { name: cin, label: cin, source: "cache" };
}
writeFileSync(join(CACHE_DIR, "_labels.json"), JSON.stringify(labels, null, 2));

// ---- summary ----------------------------------------------------------------
const line = "─".repeat(64);
console.log(`\n${line}\nSUMMARY\n${line}`);
if (summary.preseeded.length) {
  console.log(`Preseeded from repo cache (FREE):  ${summary.preseeded.length}`);
  for (const p of summary.preseeded) console.log(`   ⊕ ${p.name} (${p.cin})  [${p.label}]`);
  console.log("");
}
console.log(`Has data on Probe42:  ${summary.hasData.length}`);
for (const h of summary.hasData) console.log(`   ✓ ${h.name} (${h.cin}) — updated ${h.updated}`);
console.log(`\nFetched this run (PAID — credits spent = ${creditsSpent}):  ${summary.fetched.length}`);
for (const f of summary.fetched) console.log(`   ${f.nameOk ? "💳" : "⚠ "} ${f.name} (${f.cin})${f.nameOk ? "" : `  NAME MISMATCH → got "${f.gotName}"`}`);
if (summary.alreadyCached.length) {
  console.log(`\nAlready cached (no credit):  ${summary.alreadyCached.length}`);
  for (const c of summary.alreadyCached) console.log(`   ⟳ ${c.name} (${c.cin})`);
}
if (summary.noData.length) {
  console.log(`\nNo data on Probe42 (no async update requested):  ${summary.noData.length}`);
  for (const n of summary.noData) console.log(`   · ${n.name} (${n.cin})`);
}
if (summary.listed.length) {
  console.log(`\nListed — skipped (use FDC screener, 0 credits):  ${summary.listed.length}`);
  for (const l of summary.listed) console.log(`   ▣ ${l.name} (${l.cin})`);
}
if (summary.heldUnverified.length) {
  console.log(`\nHeld — CIN not web-verified (NO credit; use --include-unverified):  ${summary.heldUnverified.length}`);
  for (const u of summary.heldUnverified) console.log(`   ⏸ ${u.name} (${u.cin})`);
}
if (summary.heldLimit.length) {
  console.log(`\nHeld by --limit ${LIMIT} (NO credit):  ${summary.heldLimit.length}`);
  for (const h of summary.heldLimit) console.log(`   ⏸ ${h.name} (${h.cin})`);
}
if (summary.postFetchMismatch.length) {
  console.log(`\n⚠ Name mismatches (VERIFY — may be a wrong CIN):  ${summary.postFetchMismatch.length}`);
  for (const m of summary.postFetchMismatch) console.log(`   ✗ expected "${m.name}" (${m.cin}) but Probe42 says "${m.got}"`);
}
if (summary.unresolved.length) {
  console.log(`\nUnresolved CIN (never called):  ${summary.unresolved.length}`);
  for (const u of summary.unresolved) console.log(`   ⚠ ${u.name} (${u.cin ?? "null"})`);
}
if (summary.errors.length) {
  console.log(`\nErrors:  ${summary.errors.length}`);
  for (const e of summary.errors) console.log(`   ! ${e.name} (${e.cin}) — ${e.detail}`);
}
console.log(`\n${line}`);
console.log(`CREDITS SPENT (comprehensive calls): ${creditsSpent}`);
const nFiles = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json") && f !== "_labels.json").length : 0;
console.log(`Cache dir ${CACHE_DIR}/ now holds ${nFiles} report(s) + _labels.json. Copy this dir to the FDC repo.`);
if (!LIVE) console.log(`(status-only run — 0 comprehensive reports pulled, 0 credits)`);
