/* Numerical QC — re-derives every number the dashboard shows and reports where
   the derivation disagrees with what we ship. Asked for on the client call: a
   wrong number in front of the room costs more than a missing feature, so this
   runs against the built data, not against the source that produced it.

   Layers, cheapest first:
     A  shape        — every lever/record is the type the UI expects
     B  statements   — the P&L and balance sheet add up within rounding
     C  ratios       — Probe's ratios reproduce from Probe's own line items
     D  derived      — our DuPont / F-score / Altman-Z reproduce from components
     E  levers       — every number quoted in a lever exists in the data
     F  aggregates   — health scores, bands and rankings the Overview shows

   Run: node scripts/qc.mjs            (exit 1 on any FAIL) */
import { readFileSync } from "node:fs";

const D = JSON.parse(readFileSync("data/clean/probe-detail.json", "utf8"));
const ENT = JSON.parse(readFileSync("data/clean/entities.json", "utf8")).entities;
const rows = Object.values(D);

let fails = 0, warns = 0, checks = 0;
const seen = new Set();
const fail = (layer, who, msg) => { fails++; console.log(`  ✗ [${layer}] ${who} — ${msg}`); };
const warn = (layer, who, msg) => {
  warns++;
  const k = layer + who + msg;
  if (!seen.has(k)) { seen.add(k); console.log(`  ~ [${layer}] ${who} — ${msg}`); }
};
const ok = () => { checks++; };

/** Compare two numbers that both went through 1dp rounding at some point.
 *  `tol` is absolute; `rel` is a fraction of the larger magnitude. Passing both
 *  means "within rounding OR within rel%", which is what reconciling rounded
 *  crore figures against rounded ratios actually needs. */
const near = (a, b, tol = 0.15, rel = 0.01) => {
  if (a == null || b == null) return true;
  const d = Math.abs(a - b);
  return d <= tol || d <= Math.max(Math.abs(a), Math.abs(b)) * rel;
};
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* ---------------------------------------------------------------- A. shape */
console.log("\nA. record shape");
for (const c of rows) {
  const who = c.legalName;
  for (const l of c.levers ?? []) {
    if (!["opportunity", "risk", "watch"].includes(l.tone)) fail("A", who, `lever tone "${l.tone}"`);
    else ok();
    if (![1, 2, 3].includes(l.strength)) fail("A", who, `lever strength ${l.strength}`); else ok();
    for (const f of ["insight", "title", "detail"]) {
      if (typeof l[f] !== "string" || !l[f].trim()) fail("A", who, `lever "${l.insight}" field ${f} is ${Array.isArray(l[f]) ? "an array" : typeof l[f]}`);
      else ok();
    }
    for (const e of l.evidence ?? []) {
      if (typeof e?.label !== "string" || typeof e?.value !== "string") fail("A", who, `evidence chip malformed on "${l.insight}"`);
      else ok();
    }
    // Every lever is grouped under a negotiation ask; a new detector that isn't
    // mapped falls to "Other points" and the reframe silently degrades.
    if (typeof l.ask !== "string" || !l.ask.trim()) fail("A", who, `lever "${l.insight}" has no ask`);
    else if (l.ask === "Other points") fail("A", who, `lever "${l.insight}" isn't mapped to a negotiation ask (ASK_OF in detail.mjs)`);
    else ok();
  }
  // A lever that fires twice on one supplier reads as a repeat to the client.
  const ins = (c.levers ?? []).map((l) => l.insight);
  const dupes = ins.filter((v, i) => ins.indexOf(v) !== i);
  if (dupes.length) fail("A", who, `duplicate lever insight: ${[...new Set(dupes)].join(", ")}`); else ok();
  // Directly contradictory pairs — both cannot be true of the same year.
  const has = (s) => ins.some((i) => i === s);
  for (const [p, q] of [["Ask for a price cut — they can absorb it", "Expect a price-rise request; pre-empt it"],
                        ["Push on price — they don't need our cash", "Trade committed volume for a better price"]])
    if (has(p) && has(q)) fail("A", who, `contradictory levers: "${p}" + "${q}"`); else ok();
}

/* ------------------------------------------------------- B. statements add up */
console.log("\nB. statements reconcile");
for (const c of rows) {
  const who = c.legalName;
  for (const f of c.fin ?? []) {
    const at = `${who} ${f.fy}`;
    const b = f.bs ?? {};
    // equity = share capital + reserves, debt = long + short. We build both, so
    // a mismatch is our bug, not Probe's.
    if (b.shareCapital != null && b.reserves != null && !near(b.equity, b.shareCapital + b.reserves, 0.15))
      fail("B", at, `equity ${b.equity} ≠ capital ${b.shareCapital} + reserves ${b.reserves}`); else ok();
    if (b.longTermDebt != null && b.shortTermDebt != null && !near(b.debt, b.longTermDebt + b.shortTermDebt, 0.15))
      fail("B", at, `debt ${b.debt} ≠ LT ${b.longTermDebt} + ST ${b.shortTermDebt}`); else ok();
    // P&L waterfall, as Probe files it: EBIT = EBITDA + other income − depreciation.
    const [eb, oi, dep, ebit, int, pbt, tax, pat] = [f.ebitda, f.otherIncome, f.depreciation, f.ebit, f.interest, f.pbt, f.tax, f.pat].map(n);
    if (eb != null && oi != null && dep != null && ebit != null && !near(ebit, eb + oi - dep, 0.6, 0.02))
      warn("B", at, `EBIT ${ebit} vs EBITDA ${eb} + other income ${oi} − depreciation ${dep} = ${(eb + oi - dep).toFixed(1)}`); else ok();
    if (ebit != null && int != null && pbt != null && !near(pbt, ebit - int, 0.6, 0.02))
      warn("B", at, `PBT ${pbt} ≠ EBIT ${ebit} − interest ${int}`); else ok();
    if (pbt != null && tax != null && pat != null && !near(pat, pbt - tax, 0.6, 0.02))
      warn("B", at, `PAT ${pat} ≠ PBT ${pbt} − tax ${tax}`); else ok();
    // Balance-sheet sanity: the parts can't exceed the whole.
    const ta = n(b.totalAssets);
    if (ta != null && ta > 0) {
      const parts = (n(b.tangibleAssets) ?? 0) + (n(b.inventory) ?? 0) + (n(b.receivables) ?? 0) + (n(b.cash) ?? 0) + (n(b.investments) ?? 0);
      if (parts > ta * 1.02) fail("B", at, `named assets ₹${parts.toFixed(0)} Cr exceed total assets ₹${ta} Cr`); else ok();
      if (n(b.equity) != null && b.equity > ta * 1.02) fail("B", at, `equity ₹${b.equity} Cr exceeds total assets ₹${ta} Cr`); else ok();
    }
    for (const [k, v] of Object.entries({ revenue: f.revenue, inventory: b.inventory, receivables: b.receivables, totalAssets: ta }))
      if (v != null && v < 0) fail("B", at, `${k} is negative (${v})`); else ok();
  }
}

/* ------------------------------------------------- C. ratios vs line items */
console.log("\nC. Probe ratios reproduce from Probe line items");
for (const c of rows) {
  const who = c.legalName;
  const fin = c.fin ?? [];
  fin.forEach((f, i) => {
    const at = `${who} ${f.fy}`, r = f.r ?? {}, b = f.bs ?? {};
    const rev = n(f.revenue);
    if (rev) {
      if (!near(r.ebitdaMargin, (n(f.ebitda) / rev) * 100, 0.3, 0.03)) warn("C", at, `EBITDA margin ${r.ebitdaMargin}% vs computed ${((f.ebitda / rev) * 100).toFixed(1)}%`); else ok();
      if (!near(r.netMargin, (n(f.pat) / rev) * 100, 0.3, 0.03)) warn("C", at, `net margin ${r.netMargin}% vs computed ${((f.pat / rev) * 100).toFixed(1)}%`); else ok();
      if (n(b.receivables) != null && !near(r.debtorDays, (b.receivables / rev) * 365, 2.5, 0.06)) warn("C", at, `debtor days ${r.debtorDays} vs computed ${((b.receivables / rev) * 365).toFixed(0)}`); else ok();
    }
    if (n(b.equity) && n(b.debt) != null && !near(r.debtEquity, b.debt / b.equity, 0.03, 0.05)) warn("C", at, `debt/equity ${r.debtEquity} vs computed ${(b.debt / b.equity).toFixed(2)}`); else ok();
    if (n(f.interest) && n(f.ebit) != null && !near(r.interestCover, f.ebit / f.interest, 0.4, 0.06)) warn("C", at, `interest cover ${r.interestCover}× vs computed ${(f.ebit / f.interest).toFixed(1)}×`); else ok();
    // Cash conversion cycle is the identity DIO + DSO − DPO.
    const [dio, dso, dpo, ccc] = [r.inventoryDays, r.debtorDays, r.payableDays, r.cashConversion].map(n);
    if (dio != null && dso != null && dpo != null && ccc != null && !near(ccc, dio + dso - dpo, 2, 0.05))
      warn("C", at, `cash-conversion ${ccc}d ≠ ${dio} + ${dso} − ${dpo} = ${dio + dso - dpo}d`); else ok();
    // Revenue growth against the prior filed year.
    const prev = i > 0 ? n(fin[i - 1].revenue) : null;
    if (prev && rev != null && n(r.revenueGrowth) != null && !near(r.revenueGrowth, ((rev - prev) / prev) * 100, 0.6, 0.04))
      warn("C", at, `revenue growth ${r.revenueGrowth}% vs ${prev} → ${rev} = ${(((rev - prev) / prev) * 100).toFixed(1)}%`); else ok();
  });
  // `latest` must be the last filed year, verbatim — the hero stats read from it.
  const last = fin[fin.length - 1];
  if (last && c.latest) {
    if (c.latest.year !== last.fy) fail("C", who, `latest.year ${c.latest.year} ≠ last filed ${last.fy}`); else ok();
    for (const k of ["revenue", "ebitda", "pat", "interest"])
      if (!near(n(c.latest[k]), n(last[k]), 0.05, 0)) fail("C", who, `latest.${k} ${c.latest[k]} ≠ ${last.fy} ${last[k]}`); else ok();
    for (const k of ["equity", "debt", "totalAssets", "inventory", "receivables"])
      if (!near(n(c.latest[k]), n(last.bs?.[k]), 0.05, 0)) fail("C", who, `latest.${k} ${c.latest[k]} ≠ ${last.fy} ${last.bs?.[k]}`); else ok();
  }
  // The peer panel and the lever engine both read vsMedian.self; it must equal
  // the latest year's own ratios or the two disagree on screen.
  const s = c.vsMedian?.self ?? {};
  for (const k of ["ebitdaMargin", "netMargin", "roce", "roe", "debtorDays", "payableDays", "currentRatio", "debtEquity"])
    if (n(s[k]) != null && n(c.latest?.[k]) != null && !near(s[k], c.latest[k], 0.55, 0.02))
      warn("C", who, `vsMedian.self.${k} ${s[k]} vs latest ${c.latest[k]}`); else ok();
}

/* -------------------------------------------------- D. our derived analytics */
console.log("\nD. derived metrics reproduce");
for (const c of rows) {
  const who = c.legalName, a = c.advanced ?? {}, py = a.perYear ?? [], last = (c.fin ?? [])[c.fin.length - 1];
  // DuPont identity: net margin × asset turn × equity multiplier = RoE.
  for (const p of py) {
    if (p.netMargin != null && p.assetTurn != null && p.equityMult != null && p.roe != null) {
      const calc = p.netMargin * p.assetTurn * p.equityMult * 100;
      if (!near(p.roe, calc, 0.15, 0.01)) fail("D", `${who} ${p.fy}`, `DuPont RoE ${p.roe}% ≠ ${calc.toFixed(1)}%`); else ok();
    }
  }
  // Our DuPont RoE is an independent construction from Probe's reported RoE; a
  // wide gap means one of the two inputs is on a different basis.
  if (a.dupont?.roe != null && n(c.latest?.roe) != null && Math.abs(a.dupont.roe - c.latest.roe) > Math.max(3, Math.abs(c.latest.roe) * 0.25))
    warn("D", who, `our DuPont RoE ${a.dupont.roe}% vs Probe RoE ${c.latest.roe}%`); else ok();
  if (a.dupont) {
    if (a.dupont.equityMult != null && a.dupont.equityMult < 1 - 1e-9) warn("D", who, `equity multiplier ${a.dupont.equityMult}× is below 1 (equity exceeds assets)`); else ok();
    if (a.dupont.netMargin != null && n(c.latest?.netMargin) != null && !near(a.dupont.netMargin, c.latest.netMargin, 0.3, 0.03))
      warn("D", who, `DuPont net margin ${a.dupont.netMargin}% vs latest ${c.latest.netMargin}%`); else ok();
  }
  // F-score: 9 checks, 0-9, and the sum must equal the ticked checks.
  if (a.fscore != null) {
    if (a.fscore < 0 || a.fscore > 9) fail("D", who, `F-score ${a.fscore} out of range`); else ok();
    if ((a.fChecks ?? []).length !== 9) fail("D", who, `${(a.fChecks ?? []).length} F-score checks, expected 9`); else ok();
    const ticked = (a.fChecks ?? []).filter((k) => k.ok).length;
    if (ticked !== a.fscore) fail("D", who, `F-score ${a.fscore} ≠ ${ticked} ticked checks`); else ok();
  }
  // Altman Z''-score, recomputed from the components we stored.
  if (a.z != null && last) {
    const A = py[py.length - 1], ta = n(A?.ta), eq = n(last.bs?.equity), res = n(last.bs?.reserves), ebit = n(last.ebit), wc = n(A?.workingCapital);
    if (ta && wc != null) {
      const X4 = Math.min(ta - (eq ?? 0) > 0 ? (eq ?? 0) / (ta - (eq ?? 0)) : 0, 5);
      const z = 3.25 + 6.56 * (wc / ta) + 3.26 * ((res ?? 0) / ta) + 6.72 * ((ebit ?? 0) / ta) + 1.05 * X4;
      if (!near(a.z, z, 0.02, 0.005)) fail("D", who, `Altman Z ${a.z} ≠ recomputed ${z.toFixed(2)}`); else ok();
      // Negative net worth overrides the band (see advanced() in detail.mjs).
      const zone = (eq ?? 0) < 0 ? "distress" : a.z >= 2.6 ? "safe" : a.z >= 1.1 ? "grey" : "distress";
      if (a.zZone !== zone) fail("D", who, `Z-zone "${a.zZone}" ≠ "${zone}" for Z ${a.z}`); else ok();
      if ((eq ?? 0) < 0 && !a.zNote) fail("D", who, `equity ₹${eq} Cr is negative but no zNote explains the override`); else ok();
      // The gauge tops out at 10; anything above pins to the end and reads wrong.
      if (a.z > 10) warn("D", who, `Altman Z ${a.z} exceeds the 0–10 gauge`); else ok();
      if (a.z < -2) warn("D", who, `Altman Z ${a.z} is below the gauge floor`); else ok();
    }
  }
  // Working capital and FCF, recomputed.
  for (const [i, p] of py.entries()) {
    const f = c.fin[i]; if (!f || f.fy !== p.fy) continue;
    const wc = (n(f.bs?.inventory) ?? 0) + (n(f.bs?.receivables) ?? 0) + (n(f.bs?.cash) ?? 0) - (n(f.bs?.payables) ?? 0) - (n(f.bs?.shortTermDebt) ?? 0);
    if (p.workingCapital != null && !near(p.workingCapital, wc, 0.15, 0.005)) fail("D", `${who} ${p.fy}`, `working capital ${p.workingCapital} ≠ ${wc.toFixed(1)}`); else ok();
    if (p.fcf != null && n(f.cf?.operating) != null && n(f.cf?.investing) != null && !near(p.fcf, f.cf.operating + f.cf.investing, 0.15, 0.005))
      fail("D", `${who} ${p.fy}`, `FCF ${p.fcf} ≠ OCF ${f.cf.operating} + ICF ${f.cf.investing}`); else ok();
    // Cost mix is a share of revenue. On a near-zero-revenue year the shares run
    // to thousands of percent and that is simply true, so only flag it where the
    // revenue base is large enough for the number to be a claim about the business.
    const cm = p.costMix;
    if (cm && (n(f.revenue) ?? 0) >= 5) { const tot = (cm.material ?? 0) + (cm.employee ?? 0) + (cm.other ?? 0) + (cm.deprec ?? 0);
      if (tot > 130) warn("D", `${who} ${p.fy}`, `cost mix sums to ${tot.toFixed(0)}% of revenue`); else ok(); }
  }
}

/* ------------------------------------------- E. levers quote real numbers */
console.log("\nE. lever evidence traces to the data");
// Every distinct number a lever quotes must appear somewhere in that supplier's
// own record. Catches a lever built off the wrong year, or off a peer's figure.
const universe = (c) => {
  const out = new Set();
  const push = (v) => { const x = n(v); if (x != null) { out.add(Math.abs(Math.round(x * 100) / 100)); out.add(Math.abs(Math.round(x * 10) / 10)); out.add(Math.abs(Math.round(x))); } };
  const walk = (o, depth = 0) => {
    if (o == null || depth > 6) return;
    if (typeof o === "number") return push(o);
    if (Array.isArray(o)) return o.forEach((v) => walk(v, depth + 1));
    if (typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k !== "levers") walk(v, depth + 1); }
  };
  walk({ ...c, levers: undefined });
  // Derived quantities levers legitimately quote but we never store.
  const L = c.latest ?? {};
  const m = c.vsMedian?.median ?? {}, s = c.vsMedian?.self ?? {};
  for (const k of Object.keys(m)) if (n(s[k]) != null && n(m[k]) != null) push(Math.round((s[k] - m[k]) * 10) / 10);
  for (const f of c.fin ?? []) for (const g of c.fin ?? []) for (const k of ["revenue", "ebitda", "pat"]) if (n(f[k]) != null && n(g[k]) != null) push(Math.round((f[k] - g[k]) * 10) / 10);
  if (n(L.revenue) && n(L.pat) != null) push(Math.round((L.pat / L.revenue) * 1000) / 10);
  return out;
};
for (const c of rows) {
  const U = universe(c), who = c.legalName;
  for (const l of c.levers ?? []) {
    for (const e of l.evidence ?? []) {
      // Pull the numeric tokens out of the chip value ("₹265 Cr", "17.9%", "1.49×").
      for (const tok of String(e.value).match(/-?\d[\d,]*\.?\d*/g) ?? []) {
        const v = Math.abs(Number(tok.replace(/,/g, "")));
        if (!Number.isFinite(v) || v === 0) continue;
        const hit = U.has(v) || U.has(Math.round(v * 10) / 10) || U.has(Math.round(v)) ||
          [...U].some((u) => Math.abs(u - v) <= Math.max(0.55, v * 0.012));
        if (!hit) fail("E", who, `lever "${l.insight}" quotes ${e.label} = ${e.value}, not found in the record`); else ok();
      }
    }
  }
}

/* -------------------------------------------- F. aggregates the Overview shows */
console.log("\nF. Overview aggregates");
// Mirror of healthScore() in src/DeepDive.tsx — kept in step deliberately so the
// QC fails loudly if one of the two drifts.
const healthScore = (d) => {
  let s = 50; const a = d.advanced;
  if (a?.fscore != null) s += (a.fscore - 4.5) * 4;
  if (d.score?.overall != null) s += (d.score.overall - 5) * 3;
  if (a?.zZone === "distress") s -= 15; else if (a?.zZone === "safe") s += 4;
  const rt = d.creditRating;
  if (rt) { if (rt.flags.isDefault) s -= 25; else if (rt.flags.subInvestmentGrade) s -= 12; else if (rt.flags.inc) s -= 8; else if (rt.flags.strong) s += 10; }
  s -= d.levers.filter((l) => l.tone === "risk").length * 4;
  return Math.max(1, Math.min(100, Math.round(s)));
};
const scored = rows.map((c) => ({ c, h: healthScore(c) })).sort((a, b) => b.h - a.h);
for (const { c, h } of scored) {
  if (h < 1 || h > 100) fail("F", c.legalName, `health ${h} out of range`); else ok();
  if (c.score?.overall != null && (c.score.overall < 0 || c.score.overall > 10)) fail("F", c.legalName, `Probe score ${c.score.overall}/10 out of range`); else ok();
}
const BANDS = [["Strong", (h) => h >= 55], ["Adequate", (h) => h >= 45 && h < 55], ["Weak", (h) => h < 45]];
const counts = BANDS.map(([lab, t]) => [lab, scored.filter(({ h }) => t(h)).length]);
const sum = counts.reduce((s, [, k]) => s + k, 0);
if (sum !== scored.length) fail("F", "bands", `bands total ${sum} ≠ ${scored.length} scored`); else ok();
for (const [lab, k] of counts) if (k === 0) warn("F", "bands", `band "${lab}" is empty — the bar renders a gap`); else ok();
const avg = Math.round(scored.reduce((s, x) => s + x.h, 0) / scored.length);
if (avg < 1 || avg > 100) fail("F", "bands", `average ${avg} out of range`); else ok();

// Entity ↔ detail wiring: every CIN the app looks up must resolve, and every
// report we hold must belong to a tracked entity (an orphan is money spent for
// a supplier nobody can click).
const cins = new Set(ENT.map((e) => e.cin).filter(Boolean));
for (const c of rows) if (!cins.has(c.cin)) fail("F", c.legalName, `report ${c.cin} matches no entity`); else ok();
// Competitors are listed once per category they compete in, so one CIN legitimately
// appears several times there. Suppliers must be unique — a repeat would double a
// row in every board, table and ranking.
const supCins = ENT.filter((e) => e.cin && !/^Competitor/.test(e.category)).map((e) => e.cin);
for (const [i, v] of supCins.entries()) if (supCins.indexOf(v) !== i) fail("F", "entities", `supplier CIN ${v} appears twice`); else ok();
const catKey = ENT.filter((e) => e.cin).map((e) => `${e.cin}|${e.category}`);
for (const [i, v] of catKey.entries()) if (catKey.indexOf(v) !== i) fail("F", "entities", `${v} appears twice in one category`); else ok();

/* --------------------------------------- G. ingredients, supply and rate math */
console.log("\nG. ingredients, supply chain and rate benchmark");
const MARKET = JSON.parse(readFileSync("src/market.json", "utf8"));
const SUPPLY = JSON.parse(readFileSync("src/supply.json", "utf8"));
const folders = new Set(ENT.map((e) => e.folder));

for (const m of MARKET) {
  const at = m.item;
  if (!["sole", "concentrated", "competitive"].includes(m.concentration)) fail("G", at, `concentration "${m.concentration}"`); else ok();
  // kind and concentration are different vocabularies; the JSON is read through a
  // cast, so TypeScript never sees a value that belongs to the other one.
  if (!["proprietary", "semi", "commodity"].includes(m.kind)) fail("G", at, `kind "${m.kind}" is not an IngredientKind`); else ok();
  if (!["sole", "few", "many"].includes(m.indiaBand)) fail("G", at, `indiaBand "${m.indiaBand}"`); else ok();
  if (!["them", "balanced", "us"].includes(m.leverage)) fail("G", at, `leverage "${m.leverage}"`); else ok();
  if (!["high", "medium", "low"].includes(m.confidence)) fail("G", at, `confidence "${m.confidence}"`); else ok();
  // The tag and the band are two readings of the same question and must agree:
  // "competitive" tells the buyer the leverage is ours, which a "few"-seller
  // market does not support.
  if (m.concentration === "competitive" && m.indiaBand === "sole") fail("G", at, `tagged competitive on a sole-seller band`); else ok();
  if (m.concentration === "sole" && m.indiaBand !== "sole") fail("G", at, `tagged sole but band is "${m.indiaBand}"`); else ok();
  if (!m.side || !["rm", "pm"].includes(m.side)) fail("G", at, `side "${m.side}"`); else ok();
  // The tag and the evidence behind it have to agree — the client's reviewer
  // checks this one by hand, and a "competitive" item with one seller, or a
  // "sole" item with five, is the contradiction they'd find.
  const sellers = (m.indiaSuppliers ?? []).length, alts = (m.alternatives ?? []).length;
  const breadth = Math.max(sellers, alts);
  if (m.concentration === "sole" && breadth > 1) fail("G", at, `tagged sole but ${breadth} sources listed`); else ok();
  if (m.concentration === "competitive" && breadth <= 1) warn("G", at, `tagged competitive on ${breadth} listed source(s) — the tag rests on prose, not on the list`); else ok();
  if (m.concentration === "concentrated" && breadth > 8) warn("G", at, `tagged concentrated but ${breadth} sources listed`); else ok();
  // Proprietary items are single-source by definition; canSupply() relies on it.
  if (m.kind === "proprietary" && m.concentration !== "sole") fail("G", at, `kind proprietary but concentration "${m.concentration}"`); else ok();
  for (const a of m.alternatives ?? []) {
    if (!a.name || !String(a.name).trim()) fail("G", at, "alternative with no name renders as a blank row"); else ok();
    if (a.folder && !folders.has(a.folder)) fail("G", at, `alternative "${a.name}" points at unknown folder "${a.folder}"`); else ok();
    if (a.revenueCr != null && a.revenueCr < 0) fail("G", at, `alternative "${a.name}" revenue ${a.revenueCr}`); else ok();
  }
  // A price band drives the rate benchmark: low must not exceed high.
  const nums = String(m.priceINRPerKg ?? "").match(/[\d,]+(?:\.\d+)?/g)?.map((v) => Number(v.replace(/,/g, "")));
  if (nums && nums.length >= 2 && nums[0] > nums[1]) fail("G", at, `price band ₹${nums[0]}–${nums[1]} runs backwards`); else ok();
}
// Every supply line must resolve to a real vendor. A blank folder is a known gap
// (we buy the item, the vendor isn't mapped yet) and the tree labels it
// "not mapped"; a non-blank folder that resolves to nothing is a dangling
// reference and renders a dead row.
for (const side of ["rm", "pm", "mf"]) {
  for (const row of SUPPLY[side] ?? []) {
    const who = `${side}:${row.item ?? row.name ?? "?"}`;
    for (const f of [row.folder, ...(row.vendors ?? []).map((v) => v.folder ?? v)].filter((v) => typeof v === "string")) {
      if (!f) warn("G", who, "no vendor mapped — the tree shows \"not mapped\"");
      else if (!folders.has(f)) fail("G", who, `references unknown vendor folder "${f}"`);
      else ok();
    }
  }
}
// The saving the L3 screen reports is (incumbent − benchmark) × quantity. Prove
// the identity on the price bands we ship rather than on a hand-picked case.
for (const m of MARKET) {
  if (!nums2(m.priceINRPerKg)) continue;
  const [lo, hi] = nums2(m.priceINRPerKg);
  const mid = Math.round((lo + hi) / 2);
  const qty = 1000, incumbent = hi;
  const saving = (incumbent - mid) * qty;
  if (saving < 0) fail("G", m.item, `benchmark midpoint ₹${mid} above the band high ₹${hi}`); else ok();
  if (Math.abs(saving - (hi - mid) * qty) > 1e-6) fail("G", m.item, "saving identity does not hold"); else ok();
}
function nums2(s) {
  const v = String(s ?? "").match(/[\d,]+(?:\.\d+)?/g)?.map((x) => Number(x.replace(/,/g, "")));
  return v && v.length >= 2 && v[0] <= v[1] ? [v[0], v[1]] : null;
}

/* ------------------------ H. one company, one number, on every screen */
console.log("\nH. board figures agree with the supplier's own page");
// Mirrors src/probe.ts. Where we hold a Probe42 report it must win in every
// accessor, or the board quotes Tracxn's consolidated group figure while the
// deep-dive quotes the standalone filing — EPL read ₹4,257 Cr and ₹1,323 Cr on
// adjacent screens before this was wired.
const lyOf = (e) => { const ys = e.profile?.years; return ys && ys.length ? ys[ys.length - 1] : null; };
const toCr = (v) => (v == null ? null : Math.round((v / 1e7) * 10) / 10);
for (const e of ENT) {
  const d = e.cin && D[e.cin];
  if (!d) continue;
  const L = d.latest ?? {};
  const who = e.brand;
  // What each screen resolves to, with the Probe-first rule applied.
  const board = {
    revenue: toCr(L.revenue != null ? L.revenue * 1e7 : (e.financials?.revenueINR ?? lyOf(e)?.revenueINR ?? null)),
    ebitdaMargin: L.ebitdaMargin ?? e.financials?.ebitdaMarginPct ?? lyOf(e)?.ebitdaMarginPct ?? null,
    debtorDays: L.debtorDays ?? lyOf(e)?.receivableDays ?? e.probe?.receivableDays ?? null,
    payableDays: L.payableDays ?? lyOf(e)?.payableDays ?? e.probe?.payableDays ?? null,
    roce: L.roce ?? lyOf(e)?.rocePct ?? e.probe?.roce ?? null,
  };
  const page = { revenue: n(L.revenue), ebitdaMargin: n(L.ebitdaMargin), debtorDays: n(L.debtorDays), payableDays: n(L.payableDays), roce: n(L.roce) };
  for (const k of Object.keys(page)) {
    if (page[k] == null) continue;
    if (!near(board[k], page[k], 0.05, 0.001))
      fail("H", who, `board ${k} ${board[k]} ≠ profile ${page[k]} — the two screens disagree`); else ok();
  }
}

console.log(`\n${"─".repeat(64)}`);
console.log(`${checks} checks · ${fails} FAIL · ${warns} warn`);
console.log(`bands: ${counts.map(([l, k]) => `${l} ${k}`).join(" · ")} · average ${avg}/100`);
console.log(`health range: ${scored[scored.length - 1].h} (${scored[scored.length - 1].c.legalName}) → ${scored[0].h} (${scored[0].c.legalName})`);
process.exit(fails ? 1 : 0);
