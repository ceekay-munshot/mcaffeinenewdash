// One-off Probe42 fetcher for an EXTERNAL CIN list — the packaging vendors of our
// sister project "FDC". Mirrors scripts/probe/enrich.mjs but reads its own list
// (data/fdc-vendors.json) and caches into its own dir (fdc-probe-cache/), so it
// NEVER touches mcAffeine's own data/clean/entities.json or data/probe-cache/.
//
// It reuses the EXACT same Probe42 client (./client.mjs) — same endpoints, same
// env-driven auth (PROBE42_API_KEY, PROBE42_BASE_URL, PROBE42_PATH_PREFIX, …) —
// and the same datastatus→comprehensive credit-safe flow.
//
//   node scripts/probe/fetch-fdc.mjs --status              # FREE: datastatus only, 0 credits
//   node scripts/probe/fetch-fdc.mjs --live --limit 15     # PAID: pull comprehensive (default limit 15)
//   node scripts/probe/fetch-fdc.mjs --live --only U21014PN1987PTC012926,U74999MH2020PTC349649
//
// Credit safety (identical guarantees to enrich.mjs):
//   * datastatus is FREE and is ALWAYS called first.
//   * comprehensive-details (PAID) is called ONLY when data exists (last_details_updated
//     present) AND the returned legal name roughly matches the expected name.
//   * a wrong CIN, a company with no data, or a name mismatch => NO credit spent.
//   * already-cached CINs are never re-fetched (never re-pay).
//   * no async update is auto-requested — if there's no data we just report it.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
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
const LIMIT = val("--limit") ? Number(val("--limit")) : 15;
const ONLY = val("--only");
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;

// A valid Indian CIN: L/U/F + 5-digit industry code + 2-letter state + 4-digit year
// + 3-letter ownership + 6-digit RoC number. Anything else (null, "FIND CIN …") is
// treated as unresolved and never sent to the API.
const CIN_RE = /^[LUF]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const isValidCin = (c) => typeof c === "string" && CIN_RE.test(c.trim());

// ---- name matching ----------------------------------------------------------
// Rough legal-name check so we never spend a credit on the wrong company. We strip
// company-form suffixes and punctuation, then accept if either normalized name
// contains the other, or they share a strong majority of significant tokens.
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
  if (!actual) return { ok: false, score: 0, reason: "no name in datastatus" };
  const a = tokens(expected), b = tokens(actual);
  if (!a.length || !b.length) return { ok: false, score: 0, reason: "empty after normalize" };
  const collapsedA = a.join(""), collapsedB = b.join("");
  if (collapsedA.includes(collapsedB) || collapsedB.includes(collapsedA)) {
    return { ok: true, score: 1, reason: "containment" };
  }
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  const score = shared / Math.min(a.length, b.length);
  // Require the significant tokens of the shorter name to be mostly present.
  return { ok: score >= 0.6, score: Math.round(score * 100) / 100, reason: `token-overlap ${shared}/${Math.min(a.length, b.length)}` };
}
// Pull the legal name out of a datastatus (or comprehensive) response.
function legalNameOf(body) {
  return (
    findFirst(body, "legal_name") ??
    findFirst(body, "company_name") ??
    findFirst(body, "name") ??
    null
  );
}

// ---- cache ------------------------------------------------------------------
function cachePath(cin) { return join(CACHE_DIR, `${cin}.json`); }
mkdirSync(CACHE_DIR, { recursive: true });

// ---- load vendors -----------------------------------------------------------
const doc = JSON.parse(readFileSync(VENDORS, "utf8"));
let vendors = Array.isArray(doc.vendors) ? doc.vendors : [];
if (ONLY_SET) vendors = vendors.filter((v) => v.cin && ONLY_SET.has(v.cin));

console.log(`Probe42 FDC fetch — base=${probe.base} env=${probe.env} live=${LIVE}${STATUS_ONLY ? " (status-only)" : ""}`);
console.log(`Vendors in list: ${doc.vendors?.length ?? 0}${ONLY_SET ? ` · filtered to ${vendors.length} via --only` : ""}`);
if (LIVE && !STATUS_ONLY) console.log(`Paid-fetch cap (--limit): ${LIMIT}`);
console.log(`Cache dir: ${CACHE_DIR}/\n`);

// ---- run --------------------------------------------------------------------
const summary = {
  hasData: [],      // { name, cin, updated }
  noData: [],       // { name, cin }
  fetched: [],      // { name, cin }       (comprehensive pulled this run = 1 credit each)
  alreadyCached: [],// { name, cin }       (skipped the paid call — already have it)
  mismatched: [],   // { name, cin, got }  (name didn't match — credit NOT spent)
  errors: [],       // { name, cin, detail }
  unresolved: [],   // { name, cin }       (no valid CIN — never called)
};
let creditsSpent = 0;

for (const v of vendors) {
  const { name } = v;
  const cin = typeof v.cin === "string" ? v.cin.trim() : v.cin;

  if (!isValidCin(cin)) {
    console.log(`  ⚠ ${name} — UNRESOLVED CIN (${v.cin ?? "null"}) — not called.`);
    summary.unresolved.push({ name, cin: v.cin ?? null });
    continue;
  }

  // 1) datastatus — FREE. Always first.
  const s = await probe.dataStatus(cin);
  if (!s.ok) {
    console.log(`  ? ${name} (${cin}) — datastatus HTTP ${s.status}`);
    summary.errors.push({ name, cin, detail: `datastatus ${s.status}` });
    continue;
  }
  const last = findFirst(s.body, "last_details_updated");
  const got = legalNameOf(s.body);
  const match = nameMatches(name, got);

  // Surface any credit/quota header so cost is visible in the log.
  const quota = Object.entries(s.headers || {}).filter(([k]) => /credit|quota|limit|remain|balance|usage/i.test(k));
  const quotaStr = quota.length ? `  [${quota.map(([k, val2]) => `${k}=${val2}`).join(" · ")}]` : "";

  if (last == null) {
    console.log(`  · ${name} (${cin}) — NO DATA ready on Probe42 (name seen: ${got ?? "n/a"})${quotaStr}`);
    summary.noData.push({ name, cin, nameSeen: got ?? null });
    continue;
  }

  // Data exists — record it and verify the name before any paid call.
  console.log(`  ✓ ${name} (${cin}) — HAS DATA (updated ${last}) · name="${got ?? "n/a"}" · match=${match.ok} (${match.reason})${quotaStr}`);
  summary.hasData.push({ name, cin, updated: last, nameSeen: got ?? null, match: match.ok });

  if (!match.ok) {
    console.log(`      ↳ NAME MISMATCH — skipping, NO credit spent (expected "${name}", got "${got ?? "n/a"}").`);
    summary.mismatched.push({ name, cin, got: got ?? null, score: match.score });
    continue;
  }

  if (!LIVE) continue; // status survey mode: never pull the paid report

  // 2) comprehensive — PAID. Only reached when data exists AND name matches.
  if (existsSync(cachePath(cin))) {
    console.log(`      ↳ already cached (${cachePath(cin)}) — not re-fetching (no credit).`);
    summary.alreadyCached.push({ name, cin });
    continue;
  }
  if (creditsSpent >= LIMIT) {
    console.log(`      ↳ --limit ${LIMIT} reached — not fetching (will report as pending).`);
    summary.noData.push({ name, cin, nameSeen: got ?? null, pendingLimit: true });
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
  const p = extractProbe(comp.body);
  console.log(`      ↳ FETCHED → ${cachePath(cin)} (credit #${creditsSpent}) · recvDays=${p.receivableDays} payDays=${p.payableDays} roce=${p.roce} rating=${p.creditRating}`);
  summary.fetched.push({ name, cin });
}

// ---- summary ----------------------------------------------------------------
const line = "─".repeat(64);
console.log(`\n${line}\nSUMMARY\n${line}`);
console.log(`Has data on Probe42:  ${summary.hasData.length}`);
for (const h of summary.hasData) console.log(`   ✓ ${h.name} (${h.cin}) — updated ${h.updated}${h.match ? "" : "  ⚠ name mismatch"}`);
console.log(`\nFetched this run (PAID — credits spent = ${creditsSpent}):  ${summary.fetched.length}`);
for (const f of summary.fetched) console.log(`   💳 ${f.name} (${f.cin})`);
if (summary.alreadyCached.length) {
  console.log(`\nAlready cached (no credit):  ${summary.alreadyCached.length}`);
  for (const c of summary.alreadyCached) console.log(`   ⟳ ${c.name} (${c.cin})`);
}
console.log(`\nNo data on Probe42 (no async update requested):  ${summary.noData.length}`);
for (const n of summary.noData) console.log(`   · ${n.name} (${n.cin})${n.pendingLimit ? "  (held back by --limit)" : ""}`);
if (summary.mismatched.length) {
  console.log(`\nSkipped — name mismatch (NO credit spent):  ${summary.mismatched.length}`);
  for (const m of summary.mismatched) console.log(`   ✗ expected "${m.name}" (${m.cin}) but Probe42 says "${m.got}" (score ${m.score})`);
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
console.log(`Cache dir ${CACHE_DIR}/ now holds ${existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).length : 0} report(s). Copy this dir to the FDC repo.`);
if (!LIVE) console.log(`(status-only run — 0 comprehensive reports pulled, 0 credits)`);
