// #2 — extract multi-year financial statements from the (flattened) Tracxn PDF
// text using an LLM, which can reassemble the label→value→year tables that a
// regex can't. Reads the committed supplier text, writes a clean per-year series.
//
//   OPENAI_API_KEY=... node scripts/pdf/llm_financials.mjs            # all suppliers
//   OPENAI_API_KEY=... node scripts/pdf/llm_financials.mjs --only valuetree --limit 1
//
// Output: data/raw/masters/supplier_financials.json  {folder: {years:[...]}}

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TEXT = "data/raw/masters/supplier_pdf_text.json";
const OUT = "data/raw/masters/supplier_financials.json";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const SCHEMA_HINT = `Extract the company's per-fiscal-year financials from the flattened Tracxn report text. A metric's label and its yearly values may be separated — align them by fiscal-year columns ("FY 2024-25", "FY 2023-24", …).

Return STRICT JSON: {"years":[{"fy":"YYYY-YY","revenueINR":number|null,"ebitdaINR":number|null,"netProfitINR":number|null,"receivableDays":number|null,"payableDays":number|null,"rocePct":number|null,"currentRatio":number|null}]}

UNITS — money fields are ABSOLUTE RUPEES. 1 Cr = 10,000,000 rupees, so 242 Cr -> 2420000000 and 5.83 Cr -> 58300000. Do NOT add an extra zero.

WHERE each field lives:
- revenueINR: "Revenue - INR (Cr)" chart, or "Total revenue" / "Total Sales" per year.
- netProfitINR: "Net Profit/Loss - INR (Cr)" chart, or "Total profit (loss) for period" — EACH year differs; never repeat one year's value across years.
- ebitdaINR: EBITDA per year if present, else null.
- receivableDays: "Days Sales Outstanding" per year.
- payableDays: "Days Payable Outstanding" (may appear only for the latest year).
- rocePct: "Return on Capital Employed" (%).
- currentRatio: "Current Ratio".

Include only fiscal years with a revenue figure. Sort oldest first. Use null for anything absent — never guess or copy another year's value.`;

async function extractOne(folder, text) {
  const body = {
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract structured financials from messy Tracxn report text. Output only valid JSON." },
      { role: "user", content: `${SCHEMA_HINT}\n\nCompany folder: ${folder}\n\nREPORT TEXT:\n${text.slice(0, 55000)}` },
    ],
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      const json = await res.json();
      const parsed = JSON.parse(json.choices[0].message.content);
      const years = Array.isArray(parsed.years) ? parsed.years.filter((y) => y && y.fy && y.revenueINR != null) : [];
      return { years };
    } catch (e) {
      if (attempt === 2) { console.log(`  ! ${folder}: ${String(e).slice(0, 100)}`); return null; }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
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
    if (out[folder]?.years?.length && !args.includes("--refresh")) { continue; } // cached
    const rec = await extractOne(folder, text);
    if (rec && rec.years.length) {
      out[folder] = rec;
      done++;
      console.log(`  ✓ ${folder}: ${rec.years.length} years (${rec.years[0].fy}–${rec.years[rec.years.length - 1].fy})`);
      writeFileSync(OUT, JSON.stringify(out, null, 1)); // checkpoint after each
    }
  }
  console.log(`\nDone. ${done} suppliers extracted this run · ${Object.keys(out).length} total → ${OUT}`);
}

main();
