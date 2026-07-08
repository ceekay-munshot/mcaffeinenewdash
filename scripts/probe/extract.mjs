// Shared: turn a Probe42 comprehensive-details response into a compact P0 summary.
// Used by both enrich.mjs (after a live fetch) and normalize.mjs (from cache), so
// probe data survives a full rebuild of the clean dataset.

function* walk(node, key = null) {
  yield [key, node];
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) yield* walk(v, k);
}
function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
// exact-key lookup; if the value is a yearly array, take the latest year.
function findNum(root, exact) {
  let best, bestYear = -Infinity;
  for (const [k, v] of walk(root)) {
    if (k !== exact) continue;
    const n = num(v);
    if (n !== undefined) return n;
    if (Array.isArray(v)) {
      for (const item of v) {
        const y = num(item?.year) ?? num(item?.financial_year) ?? 0;
        const n2 = num(item?.value ?? item?.amount);
        if (n2 !== undefined && y >= bestYear) { best = n2; bestYear = y; }
      }
    }
  }
  return best;
}
export function findFirst(root, exact) {
  for (const [k, v] of walk(root)) if (k === exact && v != null && v !== "") return v;
  return undefined;
}
const days = (part, base) => (part != null && base) ? Math.round((part / base) * 365) : null;
const pct = (a, b) => (a != null && b) ? Math.round((a / b) * 1000) / 10 : null;

export function extractProbe(raw) {
  const preRecvDays = findNum(raw, "debtor_days_outstanding");
  const prePayDays = findNum(raw, "trade_payable_days");
  const preCCC = findNum(raw, "cash_conversion_cycle");
  const medPayDays = findNum(raw, "median_trade_payable_days");
  const medRecvDays = findNum(raw, "median_debtor_days_outstanding");

  const netRevenue = findNum(raw, "net_revenue") ?? findNum(raw, "revenue");
  const tradeReceivables = findNum(raw, "trade_receivables");
  const tradePayables = findNum(raw, "trade_payables");
  const pbit = findNum(raw, "profit_before_interest_and_tax");
  const equity = findNum(raw, "total_equity");
  const stBorrow = findNum(raw, "short_term_borrowings") ?? 0;
  const ltBorrow = findNum(raw, "long_term_borrowings") ?? 0;
  const operatingProfit = findNum(raw, "operating_profit");
  const pat = findNum(raw, "profit_after_tax");
  const capitalEmployed = ((equity ?? 0) + stBorrow + ltBorrow) || null;

  return {
    receivableDays: preRecvDays ?? days(tradeReceivables, netRevenue),
    payableDays: prePayDays ?? days(tradePayables, netRevenue),
    cashConversionCycleDays: preCCC ?? null,
    roce: findNum(raw, "return_on_capital_employed") ?? pct(pbit, capitalEmployed),
    roe: findNum(raw, "return_on_equity") ?? pct(pat, equity),
    ebitdaMargin: findNum(raw, "ebitda_margin") ?? pct(operatingProfit, netRevenue),
    netMargin: findNum(raw, "net_margin") ?? pct(pat, netRevenue),
    peerMedianPayableDays: medPayDays ?? null,
    peerMedianReceivableDays: medRecvDays ?? null,
    creditRating: findFirst(raw, "rating") ?? null,
    profitabilityScore: findNum(raw, "profitability_score") ?? null,
  };
}
