// Comprehensive supplier profile extraction from the (flattened) Tracxn PDF text
// via gpt-4o. Pulls multi-year statements + full ratio suite + balance sheet +
// corporate structure + board + loans + cap table + competitors.
//
//   OPENAI_API_KEY=... node scripts/pdf/llm_financials.mjs            # all (cached)
//   OPENAI_API_KEY=... node scripts/pdf/llm_financials.mjs --only valuetree --refresh
//
// Output: data/raw/masters/supplier_financials.json  {folder: {...profile}}

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TEXT = "data/raw/masters/supplier_pdf_text.json";
const OUT = "data/raw/masters/supplier_financials.json";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const refresh = args.includes("--refresh");

const PROMPT = `Extract a COMPREHENSIVE structured profile of this Indian company from the flattened Tracxn report text below. Labels and their per-year values may be separated — align them by the fiscal-year columns ("FY 2024-25", "FY 2023-24", …).

Return STRICT JSON with exactly this shape:
{
 "years":[{"fy":"YYYY-YY","revenueCr":n,"ebitdaCr":n,"netProfitCr":n,"ebitdaMarginPct":n,"netMarginPct":n,"rocePct":n,"roePct":n,"receivableDays":n,"payableDays":n,"cashConversionDays":n,"currentRatio":n,"debtToEquity":n,"interestCoverage":n,"totalDebtCr":n,"tradePayablesCr":n,"tradeReceivablesCr":n,"inventoryCr":n,"cashCr":n,"totalEquityCr":n,"cashFromOpsCr":n,"cashFromInvestingCr":n,"cashFromFinancingCr":n}],
 "costStructure":{"fy":string|null,"materialsCr":n,"employeeCr":n,"marketingCr":n,"freightCr":n,"financeCr":n,"depreciationCr":n,"otherCr":n},
 "parent":string|null,
 "subsidiaries":[string],
 "associatedCompanies":[string],
 "directors":[{"name":string,"designation":string|null}],
 "loans":[{"lender":string,"amountCr":n|null,"status":string|null}],
 "capTable":{"promoterPct":n|null,"publicPct":n|null,"founders":[string]},
 "acquisitions":[{"role":"acquired"|"acquirer","counterparty":string|null,"date":string|null,"amountCr":n|null,"stake":string|null}],
 "competitors":[string]
}

RULES:
- All *Cr fields are the number IN CRORE exactly as printed — do NO unit conversion, add NO zeros (report shows "242 Cr" -> 242; "5.83 Cr" -> 5.83).
- Margins / rocePct / roePct are PERCENTAGES (e.g. 46.5). Days are numbers. Ratios (currentRatio, debtToEquity, interestCoverage) are plain numbers.
- Every fiscal year's values differ — NEVER repeat one year's number across years.
- cashFromOps/Investing/FinancingCr from the Cash Flow Statement per year (can be negative).
- costStructure = the LATEST year's expense breakdown (cost of materials consumed, employee benefit, advertising/marketing, freight/transport, finance costs, depreciation, other), in Cr.
- parent = holding/parent company (Corporate Structure / "part of"). subsidiaries & associatedCompanies from Corporate Structure.
- directors from "Board Members & Signatories". loans from "Loans & Charges" (lender + amount in Cr + open/closed).
- capTable: promoter % vs public % and founder names from the shareholding / cap-table section.
- acquisitions from "M&A and IPO": role "acquired" if THIS company was acquired, "acquirer" if it bought someone; counterparty, date, amount in Cr, stake %.
- competitors from the "Competitors" section.
- Use null or [] for anything genuinely absent. NEVER guess.`;

const crToINR = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e7) : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v) => (Array.isArray(v) ? v : []);

async function callLLM(folder, text) {
  const body = {
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract accurate structured data from messy Tracxn report text. Output only valid JSON. Never invent numbers." },
      { role: "user", content: `${PROMPT}\n\nCompany folder: ${folder}\n\nREPORT TEXT:\n${text.slice(0, 84000)}` },
    ],
  };
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
      const j = await res.json();
      return JSON.parse(j.choices[0].message.content);
    } catch (e) {
      if (a === 2) { console.log(`  ! ${folder}: ${String(e).slice(0, 110)}`); return null; }
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
}

function shape(p) {
  const years = arr(p.years)
    .filter((y) => y && y.fy && y.revenueCr != null)
    .map((y) => ({
      fy: String(y.fy).replace(/^FY\s*/i, "").trim(),
      revenueINR: crToINR(y.revenueCr),
      ebitdaINR: crToINR(y.ebitdaCr),
      netProfitINR: crToINR(y.netProfitCr),
      ebitdaMarginPct: num(y.ebitdaMarginPct),
      netMarginPct: num(y.netMarginPct),
      rocePct: num(y.rocePct),
      roePct: num(y.roePct),
      receivableDays: num(y.receivableDays),
      payableDays: num(y.payableDays),
      cashConversionDays: num(y.cashConversionDays),
      currentRatio: num(y.currentRatio),
      debtToEquity: num(y.debtToEquity),
      interestCoverage: num(y.interestCoverage),
      totalDebtINR: crToINR(y.totalDebtCr),
      tradePayablesINR: crToINR(y.tradePayablesCr),
      tradeReceivablesINR: crToINR(y.tradeReceivablesCr),
      inventoryINR: crToINR(y.inventoryCr),
      cashINR: crToINR(y.cashCr),
      totalEquityINR: crToINR(y.totalEquityCr),
      cashFromOpsINR: crToINR(y.cashFromOpsCr),
      cashFromInvestingINR: crToINR(y.cashFromInvestingCr),
      cashFromFinancingINR: crToINR(y.cashFromFinancingCr),
    }));
  years.sort((a, b) => a.fy.localeCompare(b.fy)); // oldest → newest
  const cs = p.costStructure || {};
  return {
    years,
    costStructure: {
      fy: str(cs.fy),
      materialsINR: crToINR(cs.materialsCr),
      employeeINR: crToINR(cs.employeeCr),
      marketingINR: crToINR(cs.marketingCr),
      freightINR: crToINR(cs.freightCr),
      financeINR: crToINR(cs.financeCr),
      depreciationINR: crToINR(cs.depreciationCr),
      otherINR: crToINR(cs.otherCr),
    },
    acquisitions: arr(p.acquisitions).map((a) => ({
      role: str(a?.role),
      counterparty: str(a?.counterparty),
      date: str(a?.date),
      amountINR: crToINR(a?.amountCr),
      stake: str(a?.stake),
    })).filter((a) => a.counterparty || a.amountINR),
    parent: str(p.parent),
    subsidiaries: arr(p.subsidiaries).map(str).filter(Boolean),
    associatedCompanies: arr(p.associatedCompanies).map(str).filter(Boolean),
    directors: arr(p.directors).map((d) => ({ name: str(d?.name), designation: str(d?.designation) })).filter((d) => d.name),
    loans: arr(p.loans).map((l) => ({ lender: str(l?.lender), amountINR: crToINR(l?.amountCr), status: str(l?.status) })).filter((l) => l.lender),
    capTable: {
      promoterPct: num(p.capTable?.promoterPct),
      publicPct: num(p.capTable?.publicPct),
      founders: arr(p.capTable?.founders).map(str).filter(Boolean),
    },
    competitors: arr(p.competitors).map(str).filter(Boolean),
  };
}

async function main() {
  if (!KEY) throw new Error("OPENAI_API_KEY not set");
  const texts = JSON.parse(readFileSync(TEXT, "utf8"));
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  let entries = Object.entries(texts);
  if (only) entries = entries.filter(([f]) => f === only);
  let done = 0;
  for (const [folder, text] of entries) {
    if (done >= limit) break;
    if (out[folder]?.years?.length && !refresh) continue;
    const raw = await callLLM(folder, text);
    if (!raw) continue;
    const rec = shape(raw);
    if (!rec.years.length) { console.log(`  · ${folder}: no years parsed`); continue; }
    out[folder] = rec;
    done++;
    const y = rec.years;
    console.log(`  ✓ ${folder}: ${y.length}y ${y[0].fy}–${y[y.length - 1].fy} · ${rec.directors.length} dir · ${rec.subsidiaries.length} subs · ${rec.competitors.length} peers`);
    writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
  console.log(`\nDone. ${done} extracted this run · ${Object.keys(out).length} total → ${OUT}`);
}

main();
