// Build a rich, chart-ready detail file for the Probe42-enriched suppliers.
// Reads data/probe-cache/{cin}.json (full comprehensive responses) and emits
// data/clean/probe-detail.json keyed by CIN — consumed by the Supplier Deep Dive.
//
// Keeps the heavy raw out of the app bundle; the deep dive imports only this.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CACHE = "data/probe-cache";
const OUT = "data/clean/probe-detail.json";
const cr = (n) => (typeof n === "number" ? Math.round((n / 1e7) * 10) / 10 : null); // rupees -> ₹ crore, 1dp
const fy = (iso) => (iso && iso.length >= 4 ? "FY" + iso.slice(2, 4) : iso);
const round = (n, d = 1) => (typeof n === "number" ? Math.round(n * 10 ** d) / 10 ** d : null);

function build(raw) {
  const d = raw.data ?? raw;
  const fin = d.financials ?? [];
  const latestFin = fin[0] ?? {};
  const r0 = latestFin.ratios ?? {};
  const bs0 = latestFin.bs ?? {};
  const pnl0 = latestFin.pnl?.lineItems ?? {};

  // multi-year series (oldest -> newest), only years with revenue
  const series = [...fin]
    .filter((f) => typeof f.pnl?.lineItems?.net_revenue === "number")
    .reverse()
    .slice(-8)
    .map((f) => {
      const rt = f.ratios ?? {};
      const li = f.pnl?.lineItems ?? {};
      return {
        year: fy(f.year),
        revenueCr: cr(li.net_revenue),
        ebitdaCr: cr(li.operating_profit),
        patCr: cr(li.profit_after_tax),
        ebitdaMargin: round(rt.ebitda_margin),
        netMargin: round(rt.net_margin),
        roce: round(rt.return_on_capital_employed),
        receivableDays: round(rt.debtors_by_sales_days, 0),
        payableDays: round(rt.payables_by_sales_days, 0),
        cashConversionCycle: round(rt.cash_conversion_cycle, 0),
        revenueGrowth: round(rt.revenue_growth),
      };
    });

  // self vs peer median (latest benchmark row)
  const bm = d.peer_comparison?.[0]?.benchMarks?.[0] ?? {};
  const vs = (self, med) => ({ self: round(bm[self], self.includes("days") || self.includes("cycle") ? 0 : 1), median: round(bm[med], 0) });
  const vsMedian = {
    receivableDays: vs("debtor_days_outstanding", "median_debtor_days_outstanding"),
    payableDays: vs("trade_payable_days", "median_trade_payable_days"),
    cashConversionCycle: vs("cash_conversion_cycle", "median_cash_conversion_cycle"),
    ebitdaMargin: vs("ebitda_margin", "median_ebitda_margin"),
    roce: vs("return_on_capital_employed", "median_return_on_capital_employed"),
    netMargin: vs("net_margin", "median_net_margin"),
  };

  // named peers + self, by revenue (Probe's peer list can already include self)
  const selfCin = d.company?.cin;
  const peersRaw = d.peer_comparison?.[0]?.peers ?? [];
  const peers = peersRaw
    .filter((p) => p.cin !== selfCin)
    .map((p) => ({ name: p.legalName, revenueCr: cr(p.revenue), city: p.city ?? null, isSelf: false }))
    .filter((p) => p.name && p.revenueCr != null);
  peers.push({ name: d.company?.legal_name ?? "This company", revenueCr: cr(pnl0.net_revenue), city: d.company?.registered_address?.city ?? null, isSelf: true });
  peers.sort((a, b) => (b.revenueCr ?? 0) - (a.revenueCr ?? 0));

  // shareholders (>5%), latest FY
  const sh0 = (d.shareholdings_more_than_five_percent ?? [])[0] ?? {};
  const shareholders = [];
  for (const [type, arr] of [["Corporate", sh0.company], ["Individual", sh0.individual], ["LLP", sh0.llp], ["Other", sh0.others]]) {
    for (const h of arr ?? []) if (h?.name && h.shareholding_percentage) shareholders.push({ name: h.name, pct: round(h.shareholding_percentage, 1), type });
  }
  shareholders.sort((a, b) => b.pct - a.pct);

  // secured charges (lender exposure)
  const oc = d.open_charges ?? [];
  const bigCharge = [...oc].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
  const charges = { count: oc.length, sumCr: cr(d.company?.sum_of_charges), topHolder: bigCharge?.holder_name ?? null, topAmountCr: cr(bigCharge?.amount), topDate: bigCharge?.date ?? null };

  const ki = d.key_indicators ?? {};
  const score = d.probe_financial_score ?? {};

  return {
    cin: d.company?.cin ?? null,
    legalName: d.company?.legal_name ?? null,
    website: d.company?.website ?? null,
    city: d.company?.registered_address?.city ?? null,
    state: d.company?.registered_address?.state ?? null,
    incorporation: d.company?.incorporation_date ?? null,
    paidUpCr: cr(d.company?.paid_up_capital),
    lastUpdated: raw.metadata?.last_updated ?? null,
    bands: { revenue: ki.revenue ?? null, profit: ki.profit ?? null, employees: ki.employee_count ?? null },
    flags: {
      gstDelay: !!ki.gst_filing_delay,
      epfDelay: !!ki.epf_payment_delay,
      bureauDefaults: !!ki.bureau_defaults,
      pendingCases: !!ki.pending_cases_filed_against_this_corporate,
      severeCases: !!ki.severe_pending_cases_filed_against_this_corporate,
    },
    creditRating: ki.credit_rating ?? null,
    score: {
      overall: score.overall_financial_score ?? null,
      growth: score.growth_score ?? null,
      profitability: score.profitability_score ?? null,
      liquidity: score.liquidity_score ?? null,
      solvency: score.solvency_score ?? null,
      efficiency: score.efficiency_score ?? null,
    },
    latest: {
      year: fy(latestFin.year),
      revenueCr: cr(pnl0.net_revenue),
      ebitdaCr: cr(pnl0.operating_profit),
      patCr: cr(pnl0.profit_after_tax),
      ebitdaMargin: round(r0.ebitda_margin),
      netMargin: round(r0.net_margin),
      roce: round(r0.return_on_capital_employed),
      roe: round(r0.return_on_equity),
      currentRatio: round(r0.current_ratio, 2),
      debtToEquity: round(r0.debt_by_equity, 2),
      receivableDays: round(r0.debtors_by_sales_days, 0),
      payableDays: round(r0.payables_by_sales_days, 0),
      inventoryDays: round(r0.inventory_by_sales_days, 0),
      cashConversionCycle: round(r0.cash_conversion_cycle, 0),
      receivablesCr: cr(bs0.assets?.trade_receivables),
      payablesCr: cr(bs0.liabilities?.trade_payables),
      inventoryCr: cr(bs0.assets?.inventories),
      cashCr: cr(bs0.assets?.cash_and_bank_balances),
    },
    series,
    vsMedian,
    peers,
    shareholders,
    charges,
  };
}

const out = {};
if (existsSync(CACHE)) {
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const cin = f.replace(/\.json$/, "");
    try {
      out[cin] = build(JSON.parse(readFileSync(join(CACHE, f), "utf8")));
    } catch (e) {
      console.log(`  ! ${cin}: ${e.message}`);
    }
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT} — ${Object.keys(out).length} companies`);
for (const [cin, v] of Object.entries(out))
  console.log(`  ${v.legalName} (${cin}): ${v.series.length}yr series, ${v.peers.length} peers, ${v.shareholders.length} holders, score ${v.score.overall}/5`);
