// Build the COMPLETE Probe42 story for every enriched supplier — nothing left in
// the raw file. Reads data/probe-cache/{cin}.json (full comprehensive responses)
// and emits data/clean/probe-detail.json keyed by CIN.
//
// Three things happen here:
//   1. Extract EVERY section (full multi-year financials: P&L, balance sheet,
//      cash flow, all 16 ratios; headcount trend; peers w/ medians for every
//      year; ownership; directors + their other companies; charges/lenders;
//      legal cases; group structure; related-party; GST; fundraising).
//   2. Turn every historical number into a trend series.
//   3. Run the negotiation-lever engine over the whole dataset (buildLevers).
//
// The heavy raw stays out of the app bundle; the deep-dive imports only this.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CACHE = "data/probe-cache";
const OUT = "data/clean/probe-detail.json";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null));
const cr = (n) => { const x = num(n); return x == null ? null : Math.round((x / 1e7) * 10) / 10; };          // rupees -> ₹ crore, 1dp
const crK = (n) => { const x = num(n); return x == null ? null : Math.round(x / 1e7); };                      // rupees -> ₹ crore, int
const round = (n, d = 1) => { const x = num(n); return x == null ? null : Math.round(x * 10 ** d) / 10 ** d; };
const fy = (iso) => (iso && String(iso).length >= 4 ? "FY" + String(iso).slice(2, 4) : iso);
const clean = (s) => (typeof s === "string" ? s.replace(/ (PRIVATE|LIMITED|PVT|LTD)\.?/gi, "").replace(/\s+/g, " ").trim() : s);

/* ------------------------------------------------------------ per-year records */

function pnlRow(f) {
  const L = f.pnl?.lineItems ?? {};
  return {
    revenue: cr(L.net_revenue), materialCost: cr(L.total_cost_of_materials_consumed), purchases: cr(L.total_purchases_of_stock_in_trade),
    employeeCost: cr(L.total_employee_benefit_expense), otherExpense: cr(L.total_other_expenses),
    ebitda: cr(L.operating_profit), otherIncome: cr(L.other_income), depreciation: cr(L.depreciation),
    ebit: cr(L.profit_before_interest_and_tax), interest: cr(L.interest), pbt: cr(L.profit_before_tax),
    tax: cr(L.income_tax), pat: cr(L.profit_after_tax),
  };
}
function bsRow(f) {
  const a = f.bs?.assets ?? {}, l = f.bs?.liabilities ?? {};
  const equity = (num(l.share_capital) ?? 0) + (num(l.reserves_and_surplus) ?? 0);
  const debt = (num(l.long_term_borrowings) ?? 0) + (num(l.short_term_borrowings) ?? 0);
  return {
    tangibleAssets: cr(a.tangible_assets), investments: cr((num(a.noncurrent_investments) ?? 0) + (num(a.current_investments) ?? 0)),
    inventory: cr(a.inventories), receivables: cr(a.trade_receivables), cash: cr(a.cash_and_bank_balances),
    totalAssets: cr(a.given_assets_total),
    shareCapital: cr(l.share_capital), reserves: cr(l.reserves_and_surplus), equity: cr(equity),
    longTermDebt: cr(l.long_term_borrowings), shortTermDebt: cr(l.short_term_borrowings), debt: cr(debt),
    payables: cr(l.trade_payables),
  };
}
function cfRow(f) {
  const c = f.cash_flow ?? {};
  return {
    operating: cr(c.cash_flows_from_used_in_operating_activities),
    investing: cr(c.cash_flows_from_used_in_investing_activities),
    financing: cr(c.cash_flows_from_used_in_financing_activities),
  };
}
function ratioRow(f) {
  const r = f.ratios ?? {};
  return {
    revenueGrowth: round(r.revenue_growth), grossMargin: round(r.gross_profit_margin), ebitdaMargin: round(r.ebitda_margin),
    netMargin: round(r.net_margin), roe: round(r.return_on_equity), roce: round(r.return_on_capital_employed),
    debtRatio: round(r.debt_ratio, 2), debtEquity: round(r.debt_by_equity, 2), interestCover: round(r.interest_coverage_ratio, 1),
    currentRatio: round(r.current_ratio, 2), quickRatio: round(r.quick_ratio, 2),
    inventoryDays: round(r.inventory_by_sales_days, 0), debtorDays: round(r.debtors_by_sales_days, 0),
    payableDays: round(r.payables_by_sales_days, 0), cashConversion: round(r.cash_conversion_cycle, 0),
    salesByFixedAssets: round(r.sales_by_net_fixed_assets),
  };
}

/* -------------------------------------------------------------------- build one */

function build(raw) {
  const d = raw.data ?? raw;
  const finsRaw = d.financials ?? [];

  // Some companies file BOTH standalone and consolidated for a year (and the raw
  // list isn't clean chronological). Keep ONE row per fiscal year — prefer
  // standalone (the company on its own, not the group) — then sort oldest->newest.
  const byYear = new Map();
  for (const f of finsRaw) {
    if (!f.year) continue;
    const prev = byYear.get(f.year);
    if (!prev || (/standalone/i.test(f.nature ?? "") && !/standalone/i.test(prev.nature ?? ""))) byYear.set(f.year, f);
  }
  const finsSorted = [...byYear.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)));

  // FULL financial series — every year, oldest -> newest, P&L + BS + CF + all ratios
  const fin = finsSorted.map((f) => ({ fy: fy(f.year), yearFull: f.year, nature: f.nature, ...pnlRow(f), bs: bsRow(f), cf: cfRow(f), r: ratioRow(f) }));

  const latestFin = finsSorted[finsSorted.length - 1] ?? {};
  const L = { ...pnlRow(latestFin), ...bsRow(latestFin), ...cfRow(latestFin) };
  const r0 = ratioRow(latestFin);

  // headcount — yearly (financial_parameters) + monthly (EPFO)
  const empYearly = [...(d.financial_parameters ?? [])]
    .filter((p) => num(p.number_of_employees))
    .map((p) => ({ fy: fy(p.year), count: num(p.number_of_employees) }))
    .reverse();
  const est = [...(d.establishments_registered_with_epfo ?? [])].sort((a, b) => (b.filing_details?.length ?? 0) - (a.filing_details?.length ?? 0))[0];
  const rawMonthly = [...(est?.filing_details ?? [])]
    .map((x) => ({ month: x.wage_month, count: num(x.no_of_employees), onTime: /on time/i.test(x.payment_timeliness ?? "") }))
    .filter((x) => x.count != null && x.count > 0);
  // Drop placeholder / nil-filing months: a real headcount doesn't crash to ~1 and
  // back to 45. Anything under 30% of the median is a filing artifact, not real.
  const medHC = rawMonthly.length ? [...rawMonthly.map((x) => x.count)].sort((a, b) => a - b)[Math.floor(rawMonthly.length / 2)] : 0;
  const empMonthly = rawMonthly.filter((x) => medHC === 0 || x.count >= medHC * 0.3).reverse().slice(-24);
  const latestHeadcount = empMonthly.length ? empMonthly[empMonthly.length - 1].count : (empYearly.length ? empYearly[empYearly.length - 1].count : null);

  // peers — every benchmark year, self vs peer median across the key ratios
  const pc0 = d.peer_comparison?.[0] ?? {};
  const bmKeys = [["revenueGrowth", "revenue_growth"], ["ebitdaMargin", "ebitda_margin"], ["netMargin", "net_margin"], ["roce", "return_on_capital_employed"], ["roe", "return_on_equity"], ["debtorDays", "debtor_days_outstanding"], ["payableDays", "trade_payable_days"], ["cashConversion", "cash_conversion_cycle"], ["debtEquity", "debt_by_equity"], ["currentRatio", "current_ratio"], ["grossMargin", "gross_profit_margin"]];
  const benchmarks = (pc0.benchMarks ?? []).map((b) => {
    const self = {}, median = {};
    for (const [k, src] of bmKeys) { self[k] = round(b[src], 2); median[k] = round(b["median_" + src], 2); }
    return { year: b.year, peers: num(b.no_of_peers_in_sample), self, median };
  });
  const bm = benchmarks[0]?.self ?? {};
  const bmMed = benchmarks[0]?.median ?? {};
  const namedPeers = (pc0.peers ?? []).filter((p) => p.cin !== d.company?.cin).map((p) => ({ name: clean(p.legalName), revenueCr: cr(p.revenue), city: p.city ?? null })).filter((p) => p.name && p.revenueCr != null);
  namedPeers.push({ name: clean(d.company?.legal_name) ?? "This company", revenueCr: cr(latestFin.pnl?.lineItems?.net_revenue), city: d.company?.registered_address?.city ?? null, isSelf: true });
  namedPeers.sort((a, b) => (b.revenueCr ?? 0) - (a.revenueCr ?? 0));

  // ownership
  const sh0 = (d.shareholdings_more_than_five_percent ?? [])[0] ?? {};
  const shareholders = [];
  for (const [type, arr] of [["Corporate", sh0.company], ["Individual", sh0.individual], ["LLP", sh0.llp], ["Other", sh0.others]])
    for (const h of arr ?? []) if (h?.name && num(h.shareholding_percentage)) shareholders.push({ name: clean(h.name), pct: round(h.shareholding_percentage, 1), type });
  shareholders.sort((a, b) => b.pct - a.pct);
  const shSum = (d.shareholdings_summary ?? [])[0] ?? {};
  const ownership = { promoterPct: round(shSum.promoter, 1), publicPct: round(typeof shSum.public === "number" ? shSum.public : shSum.public?.total, 1) };

  // directors + their other companies
  const sig = d.authorized_signatories ?? [];
  const netByName = new Map((d.director_network ?? []).map((x) => [x.name, x.network?.companies ?? []]));
  const directors = sig.filter((s) => !s.date_of_cessation).map((s) => {
    const others = netByName.get(s.name) ?? [];
    return { name: clean(s.name), designation: s.designation ?? null, since: s.date_of_appointment ? String(s.date_of_appointment).slice(0, 4) : null, age: num(s.age), otherCount: others.length, others: others.slice(0, 6).map((c) => clean(c.legal_name)) };
  });

  // charges / lenders
  const oc = d.open_charges ?? [];
  const charges = { count: oc.length, sumCr: cr(d.company?.sum_of_charges), list: [...oc].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 8).map((c) => ({ holder: c.holder_name, amountCr: cr(c.amount), date: c.date, type: c.type })) };

  // legal cases
  const legalRaw = d.legal_history ?? [];
  const sevRank = { high: 3, medium: 2, low: 1 };
  const legal = {
    count: legalRaw.length,
    high: legalRaw.filter((c) => c.severity === "high").length,
    medium: legalRaw.filter((c) => c.severity === "medium").length,
    against: legalRaw.filter((c) => /against/i.test(c.case_type ?? "")).length,
    list: [...legalRaw].sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0)).slice(0, 8)
      .map((c) => ({ court: c.court, date: c.date, status: c.case_status, type: c.case_type, category: c.case_category, severity: c.severity, counterparty: clean(/against/i.test(c.case_type ?? "") ? c.petitioner : c.respondent) })),
  };

  // group structure
  const names = (o) => (o?.company ?? []).map((c) => ({ name: clean(c.legal_name), pct: round(c.share_holding_percentage, 0), city: c.city }));
  const group = { holding: names(d.holding_entities), subsidiaries: names(d.subsidiary_entities), associates: names(d.associate_entities), jointVentures: names(d.joint_ventures) };

  // related-party (latest year)
  const rp0 = (d.related_party_transactions ?? [])[0] ?? {};
  const rpAll = [...(rp0.company ?? []), ...(rp0.individual ?? []), ...(rp0.others ?? [])];
  const relatedParty = { year: rp0.financial_year, count: rpAll.length, totalCr: cr(rpAll.reduce((s, x) => s + (num(x.amount) ?? 0), 0)), top: rpAll.map((x) => ({ name: clean(x.name), relationship: x.relationship, kind: x.type_of_transaction, amountCr: cr(x.amount) })).sort((a, b) => Math.abs(b.amountCr ?? 0) - Math.abs(a.amountCr ?? 0)).slice(0, 6) };

  // GST reliability
  const gst = (d.gst_details ?? []).map((g) => ({ gstin: g.gstin, state: g.state, status: g.status, timeliness: g.filing_timeliness }));
  const gstOnTime = gst.filter((g) => /regular|on time|timely/i.test(g.timeliness ?? "")).length;

  // fundraising
  const allotments = (d.securities_allotment ?? []).map((a) => ({ date: a.allotment_date, type: a.allotment_type, instrument: a.instrument, amountCr: cr(a.total_amount_raised) })).filter((a) => a.amountCr != null);

  // MSME payment behaviour
  const lakh = (n) => { const x = num(n); return x == null ? null : Math.round((x / 1e5) * 10) / 10; };
  const msme = d.msme_supplier_payment_delays ?? {};
  const dfp = msme.delays_for_period ?? {};
  const payTrend = (msme.trend ?? []).map((t) => ({ period: t.period, lakh: lakh(t.amount) }));
  const worst = payTrend.reduce((m, t) => ((t.lakh ?? 0) > (m?.lakh ?? -1) ? t : m), null);
  const paymentBehaviour = { hasData: !!(payTrend.length || dfp.latest_period), latestPeriod: dfp.latest_period ?? null, latestDueLakh: lakh(dfp.total_amount_due_for_period), worstPeriod: worst?.period ?? null, worstLakh: worst?.lakh ?? null, delayedSuppliers: (dfp.delays ?? []).map((x) => clean(x.supplier_name)).filter(Boolean).slice(0, 4), trend: payTrend };

  const ki = d.key_indicators ?? {};
  const score = d.probe_financial_score ?? {};
  const co = d.company ?? {};

  const detail = {
    // identity
    cin: co.cin ?? null, legalName: co.legal_name ?? null, description: (d.description?.desc_thousand_char ?? "").slice(0, 600) || null,
    website: co.website ?? null, city: co.registered_address?.city ?? null, state: co.registered_address?.state ?? null,
    incorporation: co.incorporation_date ?? null, classification: co.classification ?? null, status: co.status ?? null,
    industry: pc0.bizIndustry ?? null, segment: pc0.bizSegment ?? null,
    activities: (d.principal_business_activities ?? []).map((a) => ({ desc: a.business_activity_description, pct: num(a.percentage_of_turnover) })).filter((a) => a.desc).slice(0, 4),
    paidUpCr: cr(co.paid_up_capital), authorizedCr: cr(co.authorized_capital), lastAgm: co.last_agm_date ?? null, lastFiling: co.last_filing_date ?? null,
    lastUpdated: raw.metadata?.last_updated ?? null, yearsCovered: fin.length,
    // scores / bands / flags
    score: { overall: num(score.overall_financial_score), growth: num(score.growth_score), profitability: num(score.profitability_score), liquidity: num(score.liquidity_score), solvency: num(score.solvency_score), efficiency: num(score.efficiency_score) },
    bands: { revenue: ki.revenue ?? null, profit: ki.profit ?? null, employees: ki.employee_count ?? null },
    flags: { gstDelay: !!ki.gst_filing_delay, epfDelay: !!ki.epf_payment_delay, bureauDefaults: !!ki.bureau_defaults, pendingCases: !!ki.pending_cases_filed_against_this_corporate, severeCases: !!ki.severe_pending_cases_filed_against_this_corporate, struckOff: /struck/i.test(d.struckoff248_details?.struck_off_status ?? "") },
    creditRating: ki.credit_rating ?? null,
    // latest snapshot
    latest: { year: fy(latestFin.year), ...L, ...r0 },
    // the full stories
    fin, employees: { latest: latestHeadcount, yearly: empYearly, monthly: empMonthly },
    peers: { industry: pc0.bizIndustry ?? null, segment: pc0.bizSegment ?? null, sampleSize: benchmarks[0]?.peers ?? null, named: namedPeers, benchmarks },
    vsMedian: { self: bm, median: bmMed },
    ownership, shareholders, directors, charges, legal, group, relatedParty, gst: { list: gst, onTime: gstOnTime, total: gst.length }, allotments, paymentBehaviour,
  };

  detail.levers = buildLevers(detail);
  return detail;
}

/* ------------------------------------------------------- negotiation-lever engine
   Reasons over the WHOLE extracted dataset and emits plain-language levers, each
   tagged opportunity (works for us) / risk (caution) / watch, with a strength
   (1-3) and the numbers behind it. This is the analysis layer on top of the data. */

function trendOf(fin, sel, n = 3) {
  const vals = fin.map(sel).filter((v) => v != null);
  if (vals.length < 2) return null;
  const recent = vals.slice(-n);
  return { first: recent[0], last: recent[recent.length - 1], delta: round(recent[recent.length - 1] - recent[0], 1), all: vals };
}

function buildLevers(x) {
  const out = [];
  const add = (tone, strength, title, detail) => out.push({ tone, strength, title, detail });
  const l = x.latest, med = x.vsMedian.median, fin = x.fin;
  const pctpt = (a, b) => (a != null && b != null ? round(a - b, 1) : null);

  // --- margin vs peers ---
  if (l.ebitdaMargin != null && med.ebitdaMargin != null) {
    const gap = pctpt(l.ebitdaMargin, med.ebitdaMargin);
    if (gap != null && gap >= 3) add("opportunity", gap >= 8 ? 3 : 2, "Fatter margins than its peers", `EBITDA margin ${l.ebitdaMargin}% vs the peer median of ${med.ebitdaMargin}% — about ${gap}pp of extra cushion baked into their pricing. Push on price.`);
    else if (gap != null && gap <= -3) add("watch", 1, "Thinner margins than peers", `EBITDA margin ${l.ebitdaMargin}% is below the peer median ${med.ebitdaMargin}% — they have less room, expect resistance on price; lean on input-cost transparency instead.`);
  }
  // --- margin trend ---
  const em = trendOf(fin, (f) => f.r.ebitdaMargin);
  if (em && em.all.length >= 3) {
    if (em.delta >= 1.5) add("opportunity", 2, "Margins are widening", `EBITDA margin climbed from ${em.first}% to ${em.last}% — profits are expanding, so they can absorb a better price for us.`);
    else if (em.delta <= -1.5) add("watch", 1, "Margins are compressing", `EBITDA margin slipped from ${em.first}% to ${em.last}% — they're being squeezed; a hard price cut will meet resistance.`);
  }
  // --- RoCE ---
  if (l.roce != null && (l.roce >= 25 || (med.roce != null && l.roce > med.roce * 1.3)))
    add("opportunity", l.roce >= 35 ? 3 : 2, "Very profitable use of capital", `RoCE ${l.roce}%${med.roce != null ? ` vs peers ${med.roce}%` : ""} — they earn strong returns; there's margin to share with us.`);
  // --- payment terms / cash ---
  if (l.debtorDays != null && l.debtorDays <= 60 && (med.debtorDays == null || l.debtorDays <= med.debtorDays))
    add("opportunity", 2, "Collects its cash quickly", `Gets paid in ${l.debtorDays} days${med.debtorDays != null ? ` (peers ${med.debtorDays})` : ""} — healthy cash position, so we can push to extend our own payment terms.`);
  if (l.payableDays != null && med.payableDays != null && l.payableDays >= med.payableDays + 10)
    add("opportunity", 2, "They already stretch their suppliers", `They take ${l.payableDays} days to pay vs a peer norm of ${med.payableDays} — asking them for longer terms is credible; they do it themselves.`);
  if (l.cashConversion != null && l.cashConversion >= 90)
    add("opportunity", 2, "Cash is tied up for months", `Cash-conversion cycle ${l.cashConversion} days — a lot of working capital is locked up, so an early-payment-for-discount offer will land well.`);
  if (x.paymentBehaviour.hasData && (x.paymentBehaviour.worstLakh ?? 0) >= 10)
    add("watch", 1, "Pays its own small vendors late", `Has delayed MSME dues (worst period ${x.paymentBehaviour.worstPeriod}: ₹${x.paymentBehaviour.worstLakh} L) — runs a tight cash desk, so expect them to hold firm on payment terms.`);

  // --- leverage / balance sheet ---
  if (l.debtEquity != null && l.debtEquity <= 0.3)
    add("opportunity", 1, "Almost no debt", `Debt-to-equity just ${l.debtEquity} — a clean balance sheet with no interest burden to pass on to us; there's room on price.`);
  if (l.debtEquity != null && l.debtEquity >= 1.5)
    add("risk", 2, "Heavily leveraged", `Debt-to-equity ${l.debtEquity}${l.interestCover != null ? `, interest cover ${l.interestCover}x` : ""} — a stretched balance sheet; squeeze too hard and supply reliability is at risk.`);
  else if (l.interestCover != null && l.interestCover < 2)
    add("risk", 2, "Struggles to cover its interest", `Interest cover only ${l.interestCover}x — profits barely clear the interest bill; a cash-strained supplier.`);

  // --- revenue trajectory ---
  const rev = trendOf(fin, (f) => f.revenue, 3);
  if (rev && rev.all.length >= 3) {
    const g = rev.first ? round(((rev.last - rev.first) / rev.first) * 100, 0) : null;
    if (g != null && g >= 25) add("opportunity", 1, "Growing fast — wants to keep us", `Revenue up from ₹${rev.first} Cr to ₹${rev.last} Cr — a growing supplier that will fight to keep our volume; use it.`);
    else if (g != null && g <= -10) add("opportunity", 2, "Revenue is shrinking", `Revenue fell from ₹${rev.first} Cr to ₹${rev.last} Cr — they need the business; lean in on price and terms.`);
  }
  // --- cash flow health ---
  const cfo = l.operating;
  if (cfo != null && cfo < 0) add("risk", 2, "Burning cash from operations", `Operating cash flow was −₹${Math.abs(cfo)} Cr last year — the core business consumed cash; watch supply continuity.`);
  else if (cfo != null && l.pat != null && cfo > l.pat * 1.2 && cfo > 0) add("opportunity", 1, "Strong cash generation", `Generated ₹${cfo} Cr of operating cash — comfortably cash-positive, so they don't need to claw margin from us.`);

  // --- headcount ---
  const hc = x.employees.yearly;
  if (hc.length >= 3) {
    const f = hc[hc.length - 3].count, la = hc[hc.length - 1].count;
    if (f && la && la <= f * 0.85) add("watch", 1, "Cutting headcount", `Employees down from ~${f} to ~${la} — a shrinking team can signal distress or restructuring.`);
  }

  // --- financial score ---
  if (x.score.overall != null && x.score.overall < 4)
    add("risk", 2, "Weak overall financial score", `Probe rates them ${x.score.overall}/10 overall — financially fragile; keep a qualified backup source.`);
  else if (x.score.overall != null && x.score.overall >= 7)
    add("watch", 1, "Financially very strong", `Probe rates them ${x.score.overall}/10 — a healthy, stable supplier (good for reliability, but they can hold their price).`);

  // --- legal / compliance ---
  if (x.legal.high > 0) add("risk", 3, "Serious legal cases pending", `${x.legal.high} high-severity court case${x.legal.high > 1 ? "s" : ""} (of ${x.legal.count} total) — a real continuity/reputation risk worth diligence.`);
  else if (x.legal.count >= 5) add("watch", 1, "Several court cases on record", `${x.legal.count} cases on file (${x.legal.against} filed against them) — mostly routine, but worth a glance.`);
  if (x.flags.gstDelay || x.flags.epfDelay) add("watch", 1, "Late on statutory filings", `${[x.flags.gstDelay && "GST filing", x.flags.epfDelay && "EPF payment"].filter(Boolean).join(" + ")} delays on record — often an early sign of a cash squeeze.`);
  if (x.flags.bureauDefaults) add("risk", 3, "Credit-bureau default flagged", "A bureau default is on record — treat commitments and advances with caution.");

  // sort: opportunities first, then watch, then risk; strongest first
  const toneRank = { opportunity: 0, watch: 1, risk: 2 };
  out.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || b.strength - a.strength);
  return out;
}

/* ------------------------------------------------------------------------- run */

const outObj = {};
if (existsSync(CACHE)) {
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const cin = f.replace(/\.json$/, "");
    try { outObj[cin] = build(JSON.parse(readFileSync(join(CACHE, f), "utf8"))); }
    catch (e) { console.log(`  ! ${cin}: ${e.message}`); }
  }
}
writeFileSync(OUT, JSON.stringify(outObj, null, 2));
console.log(`Wrote ${OUT} — ${Object.keys(outObj).length} companies`);
for (const [cin, v] of Object.entries(outObj))
  console.log(`  ${clean(v.legalName)} (${cin}): ${v.yearsCovered}yr · ${v.fin.length} fin rows · ${v.employees.monthly.length}mo headcount · ${v.legal.count} cases · ${v.levers.length} levers · score ${v.score.overall}/10`);
