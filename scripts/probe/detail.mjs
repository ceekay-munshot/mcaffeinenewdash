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

// Probe's registered name is normally the best display name, but a supplier that
// was renamed after an acquisition can come back under a stale/holdco name that
// no longer matches the vendor we track (Manjushree's Advent holdco still files as
// "Alternicq Limited"; Connell Brothers now files as "Caldic"). When Probe's name
// shares no token with the tracked brand, use our own curated name instead.
function displayLegalName(probeName, entity) {
  const p = clean(probeName);
  const brand = entity?.brand ?? "";
  const tok = brand.toLowerCase().split(/\s+/)[0];
  if (!p) return entity?.legalName ?? brand ?? null;
  if (tok && tok.length >= 3 && p.toLowerCase().includes(tok)) return p; // Probe name matches the brand → trust it
  return entity?.legalName ?? p; // renamed / holdco name → prefer our curated name
}

// Registry descriptions open with the filed legal name, which for a renamed or
// holdco-owned company is a name nobody recognises ("Alternicq Limited (AL), as
// per its credit ratings report…" for Manjushree). Say the name the rest of the
// dashboard uses, and end on a full stop — a hard character cut left the text
// hanging mid-word ("branches located in Amritsar, Badd").
function tidyDescription(rawDesc, probeName, displayName) {
  let t = String(rawDesc ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (probeName && displayName && probeName.toLowerCase() !== displayName.toLowerCase()) {
    // registry names are ALL-CAPS; title-case so the sentence doesn't shout
    const bare = displayName.replace(/\s+(private|limited|pvt\.?|ltd\.?)\b/gi, "").trim() || displayName;
    const short = bare === bare.toUpperCase() ? bare.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : bare;
    const esc = probeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // drop the "(AL)" initialism that trails the old name, else it is orphaned
    t = t.replace(new RegExp(`${esc}\\s*\\([A-Z]{1,5}\\)`, "gi"), short).replace(new RegExp(esc, "gi"), short);
  }
  const LIMIT = 520;
  if (t.length > LIMIT) {
    const cut = t.slice(0, LIMIT);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = stop > 160 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return t;
}

function build(raw, entity) {
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
  const bmKeys = [["revenueGrowth", "revenue_growth"], ["ebitdaMargin", "ebitda_margin"], ["netMargin", "net_margin"], ["roce", "return_on_capital_employed"], ["roe", "return_on_equity"], ["debtorDays", "debtor_days_outstanding"], ["payableDays", "trade_payable_days"], ["cashConversion", "cash_conversion_cycle"], ["debtEquity", "debt_by_equity"], ["currentRatio", "current_ratio"], ["grossMargin", "gross_profit_margin"], ["inventoryDays", "inventory_holding_period"]];
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

  // directors + their OTHER current directorships (the "overboarding" signal).
  // Exclude this very company, any board the person has already left, and dupes,
  // so the count reflects how stretched they are across other live companies.
  const selfCin = d.company?.cin ?? null;
  const sig = d.authorized_signatories ?? [];
  const netByName = new Map((d.director_network ?? []).map((x) => [x.name, x.network?.companies ?? []]));
  // how much of THIS company each director personally owns (skin in the game)
  const ownByName = new Map();
  for (const s of [...(d.director_shareholdings ?? [])].sort((a, b) => String(a.financial_year ?? "").localeCompare(String(b.financial_year ?? "")))) {
    const pc = num(s.percentage_holding);
    if (s.full_name && pc != null) ownByName.set(clean(s.full_name), round(pc, 1)); // sorted ascending → latest year wins
  }
  const directors = sig.filter((s) => !s.date_of_cessation).map((s) => {
    const raw = (netByName.get(s.name) ?? []).filter((c) => c.cin && c.cin !== selfCin && !c.date_of_cessation);
    const names = [...new Set(raw.map((c) => clean(c.legal_name)).filter(Boolean))];
    return { name: clean(s.name), designation: s.designation ?? null, since: s.date_of_appointment ? String(s.date_of_appointment).slice(0, 4) : null, age: num(s.age), otherCount: names.length, others: names.slice(0, 6), ownPct: ownByName.get(clean(s.name)) ?? null };
  });

  // charges / lenders — current open charges + the full history (created vs satisfied)
  const oc = d.open_charges ?? [];
  const cs = d.charge_sequence ?? [];
  const charges = { count: oc.length, sumCr: cr(d.company?.sum_of_charges),
    everCreated: cs.length, satisfied: cs.filter((c) => /satisf/i.test(c.status ?? "")).length,
    list: [...oc].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 8).map((c) => ({ holder: c.holder_name, amountCr: cr(c.amount), date: c.date, type: c.type })) };

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

  // financial-dispute litigation (recovery / default / insolvency) — distinct from
  // the general legal history. "receivable" = they're chasing a customer for money;
  // "payable" = someone is chasing THEM for a default.
  const fd0 = d.legal_cases_of_financial_disputes ?? {};
  const fdItems = [];
  for (const [bucket, arr] of Object.entries(fd0))
    for (const c of arr ?? []) fdItems.push({ direction: /pay/i.test(bucket) ? "payable" : "receivable", type: c.type_of_financial_dispute, verdict: c.verdict, court: c.court, counterparty: clean(c.litigant), caseNo: c.case_no, amountCr: cr(c.amount_under_default), date: c.date_of_judgement });
  const financialDisputes = { count: fdItems.length, receivable: fdItems.filter((x) => x.direction === "receivable").length, payable: fdItems.filter((x) => x.direction === "payable").length, list: fdItems.slice(0, 8) };

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

  // external credit ratings (CRISIL / CARE / ICRA) — the strongest outside-in signal
  const LT_RANK = { AAA: 20, "AA+": 19, AA: 18, "AA-": 17, "A+": 16, A: 15, "A-": 14, "BBB+": 13, BBB: 12, "BBB-": 11, "BB+": 10, BB: 9, "BB-": 8, "B+": 7, B: 6, "B-": 5, C: 3, D: 1 };
  const ltGrade = (s) => { const m = String(s ?? "").toUpperCase().match(/\b(AAA|AA[+-]|AA|BBB[+-]|BBB|BB[+-]|BB|A[+-]|A|B[+-]|B|C|D)\b/); return m ? m[1] : null; };
  const crAll = [...(d.credit_ratings ?? [])].sort((a, b) => String(b.rating_date ?? "").localeCompare(String(a.rating_date ?? "")));
  let creditRating = null;
  if (crAll.length) {
    const latestDate = crAll[0].rating_date;
    const batch = crAll.filter((r) => r.rating_date === latestDate);
    const txt = (r) => `${r.rating ?? ""} ${(r.rating_details ?? []).map((x) => `${x.action ?? ""} ${x.remarks ?? ""}`).join(" ")}`;
    const grades = batch.map((r) => ltGrade(r.rating)).filter(Boolean);
    const grade = grades.length ? grades.reduce((b, g) => ((LT_RANK[g] ?? 0) > (LT_RANK[b] ?? 0) ? g : b)) : null;
    const rank = grade ? LT_RANK[grade] : null;
    const dated = crAll.map((r) => ltGrade(r.rating)).filter(Boolean).map((g) => LT_RANK[g] ?? 0);
    creditRating = {
      agency: batch[0].rating_agency ? String(batch[0].rating_agency).toUpperCase() : null,
      date: latestDate, grade, gradeText: batch[0].rating ?? null, ratedAmountCr: cr(batch.reduce((s, r) => s + (num(r.amount) ?? 0), 0)),
      // the agency's forward view (Stable / Positive / Negative) — a Negative
      // outlook is a downgrade warning the grade alone doesn't show.
      outlook: [...new Set(batch.flatMap((r) => (r.rating_details ?? []).map((x) => x.outlook)).filter(Boolean))][0] ?? null,
      facilities: batch.slice(0, 6).map((r) => ({ loan: r.type_of_loan, rating: r.rating, amountCr: cr(r.amount) })),
      flags: {
        inc: crAll.some((r) => /not cooperating/i.test(txt(r))),
        withdrawn: batch.length > 0 && batch.every((r) => /withdrawn/i.test(txt(r))),
        isDefault: batch.some((r) => ltGrade(r.rating) === "D" || /\bdefault\b/i.test(txt(r))),
        subInvestmentGrade: rank != null && rank < 11,
        downgraded: dated.length >= 2 && dated[0] < dated[dated.length - 1],
        strong: rank != null && rank >= 14,
      },
    };
  }

  // "formerly known as" — the rename trail (Manjushree ← Alternicq, Caldic ← Connell)
  const curNameLc = (clean(co.legal_name) ?? "").toLowerCase();
  const nameHistory = [...new Set((d.name_history ?? []).map((h) => clean(h.name)).filter((nm) => nm && nm.toLowerCase() !== curNameLc))];

  // forex exposure + aged receivables (from financial_parameters, newest first)
  const fpRaw = d.financial_parameters ?? [];
  const fxRow = fpRaw.find((p) => num(p.earning_fc) != null || num(p.expenditure_fc) != null) ?? null;
  const forex = fxRow ? { fy: fy(fxRow.year), earnCr: cr(fxRow.earning_fc), spendCr: cr(fxRow.expenditure_fc) } : null;
  const arRow = fpRaw.find((p) => num(p.trade_receivable_exceeding_six_months) != null) ?? null;
  const agedReceivables = arRow ? { fy: fy(arRow.year), amountCr: cr(arRow.trade_receivable_exceeding_six_months) } : null;

  // ---- auditor: who signs the accounts, and did the firm change? -------------
  // A mid-stream auditor swap is a classic governance signal, and an adverse
  // remark is a hard red flag on the numbers we're basing every lever on.
  const audRows = fin.length ? [] : [];
  const auditors = (d.financials ?? []).map((f) => ({
    fy: fy(f.year),
    firm: f.auditor?.auditor_firm_name ? clean(f.auditor.auditor_firm_name) : null,
    name: f.auditor?.auditor_name ? clean(f.auditor.auditor_name) : null,
    adverse: f.auditor_comments?.report_has_adverse_remarks === true,
  })).filter((a) => a.firm || a.name);
  const audFirms = [...new Set(auditors.map((a) => a.firm).filter(Boolean))];
  const adverseYears = auditors.filter((a) => a.adverse).map((a) => a.fy);
  // Recency matters: a single adverse remark from eight years ago is history, a
  // remark in the latest filed year (or a repeated pattern) is a live problem.
  // Treating both the same would overstate the risk.
  const recentFys = auditors.slice(0, 2).map((a) => a.fy);
  const auditor = auditors.length ? {
    current: auditors[0].firm ?? auditors[0].name,
    signedBy: auditors[0].name,
    changes: Math.max(0, audFirms.length - 1),
    firms: audFirms.slice(0, 4),
    anyAdverse: adverseYears.length > 0,
    adverseYears,
    adverseRecent: adverseYears.some((y) => recentFys.includes(y)),
    adverseSustained: adverseYears.length >= 3,
    latestFy: auditors[0].fy,
  } : null;
  void audRows;

  // ---- revenue mix: manufactured vs traded vs services, domestic vs export ---
  // Structurally decisive for a price conversation: a trader marks up someone
  // else's goods (thin, little to give), a manufacturer owns its conversion
  // margin (real room). Export share tells us how much demand sits outside India.
  const rb = latestFin.pnl?.revenue_breakup ?? {};
  const rbNum = (k) => num(rb[k]) ?? 0;
  const mfg = rbNum("sale_of_goods_manufactured_domestic") + rbNum("sale_of_goods_manufactured_export") + rbNum("revenue_from_sale_of_products");
  const trade = rbNum("sale_of_goods_traded_domestic") + rbNum("sale_of_goods_traded_export");
  const svc = rbNum("sale_or_supply_of_services_domestic") + rbNum("sale_or_supply_of_services_export") + rbNum("revenue_from_sale_of_services");
  const exportRs = rbNum("sale_of_goods_manufactured_export") + rbNum("sale_of_goods_traded_export") + rbNum("sale_or_supply_of_services_export");
  const rbTotal = mfg + trade + svc;
  const revenueMix = rbTotal > 0 ? {
    fy: fy(latestFin.year),
    manufacturedCr: cr(mfg), tradedCr: cr(trade), servicesCr: cr(svc),
    manufacturedPct: round((mfg / rbTotal) * 100, 1), tradedPct: round((trade / rbTotal) * 100, 1), servicesPct: round((svc / rbTotal) * 100, 1),
    exportCr: cr(exportRs), exportPct: round((exportRs / rbTotal) * 100, 1),
    // what the business mostly is — drives the "how much margin can they give" read
    kind: mfg >= trade && mfg >= svc ? "manufacturer" : trade >= svc ? "trader" : "services",
  } : null;

  // ---- what the registry says they actually do ------------------------------
  const activityGroup = (d.principal_business_activities ?? []).map((a) => a.main_activity_group_description).filter(Boolean)[0] ?? null;
  const gstNature = [...new Set((d.gst_details ?? []).flatMap((g) => String(g.nature_of_business_activities ?? "").split("|").map((s) => s.trim()).filter(Boolean)))];

  // ---- cash leaving the business to its owners / managers --------------------
  const mgrRemRs = num(latestFin.pnl_key_schedule?.managerial_remuneration) ?? 0;
  const patRs = num(latestFin.pnl?.lineItems?.profit_after_tax) ?? null;
  const managerialPay = mgrRemRs > 0 ? {
    fy: fy(latestFin.year), amountCr: cr(mgrRemRs),
    pctOfProfit: patRs && patRs > 0 ? round((mgrRemRs / patRs) * 100, 1) : null,
  } : null;
  const proposedDividend = (fpRaw ?? []).some((p) => p.proposed_dividend && !/^no$/i.test(String(p.proposed_dividend)));

  // ---- what their borrowed money actually costs ------------------------------
  // Charge filings carry the rate on secured facilities. Many are free text
  // ("as per bank tariff"), so only take a clean percentage, and ignore absurd
  // values. This is the ceiling on what an early-payment discount is worth to
  // them: money we release early saves them exactly this rate.
  const chargeEvents = [...(d.open_charges_latest_event ?? []), ...(d.open_charges ?? [])];
  const rates = chargeEvents
    .map((e) => String(e.rate_of_interest ?? ""))
    .filter((s) => /^\s*\d{1,2}(\.\d+)?\s*%?\s*$/.test(s))
    .map((s) => num(s.replace("%", "").trim()))
    .filter((v) => v != null && v > 1 && v <= 30);
  const borrowingCost = rates.length ? { ratePct: round(Math.max(...rates), 2) } : null;

  // ---- energy intensity ------------------------------------------------------
  const powerRs = num(latestFin.pnl_key_schedule?.power_and_fuel) ?? 0;
  const revRs = num(latestFin.pnl?.lineItems?.net_revenue) ?? null;
  const powerCost = powerRs > 0 ? {
    fy: fy(latestFin.year), amountCr: cr(powerRs),
    pctOfRevenue: revRs && revRs > 0 ? round((powerRs / revRs) * 100, 1) : null,
  } : null;

  // ---- how worn is the plant? ------------------------------------------------
  // Net ÷ gross fixed assets says how much life is left in the asset base. A
  // heavily written-down plant means replacement capex is coming, which changes
  // what a long contract is worth to them.
  const grossFa = num(latestFin.bs?.notes?.gross_fixed_assets) ?? num((fpRaw ?? [])[0]?.gross_fixed_assets) ?? null;
  const netFa = num(latestFin.bs?.subTotals?.net_fixed_assets) ?? null;
  const assetAge = grossFa && grossFa > 0 && netFa != null ? {
    fy: fy(latestFin.year), grossCr: cr(grossFa), netCr: cr(netFa),
    depreciatedPct: round((1 - netFa / grossFa) * 100, 1),
  } : null;

  // ---- capacity being built right now ---------------------------------------
  const wipRs = num(latestFin.bs?.subTotals?.capital_wip) ?? 0;
  const nfaRs = num(latestFin.bs?.subTotals?.net_fixed_assets) ?? null;
  const capexWip = wipRs > 0 ? {
    fy: fy(latestFin.year), amountCr: cr(wipRs),
    pctOfFixedAssets: nfaRs && nfaRs > 0 ? round((wipRs / nfaRs) * 100, 1) : null,
  } : null;

  const detail = {
    // identity
    cin: co.cin ?? null, legalName: displayLegalName(co.legal_name, entity),
    description: tidyDescription(d.description?.desc_thousand_char, co.legal_name, displayLegalName(co.legal_name, entity)),
    website: co.website ?? null, city: co.registered_address?.city ?? null, state: co.registered_address?.state ?? null,
    incorporation: co.incorporation_date ?? null, classification: co.classification ?? null, status: co.status ?? null,
    industry: pc0.bizIndustry ?? null, segment: pc0.bizSegment ?? null, segments: d.industry_segments?.[0]?.segments ?? [],
    activities: (d.principal_business_activities ?? []).map((a) => ({ desc: a.business_activity_description, pct: num(a.percentage_of_turnover) })).filter((a) => a.desc).slice(0, 4),
    paidUpCr: cr(co.paid_up_capital), authorizedCr: cr(co.authorized_capital), lastAgm: co.last_agm_date ?? null, lastFiling: co.last_filing_date ?? null,
    lastUpdated: raw.metadata?.last_updated ?? null, yearsCovered: fin.length,
    // scores / bands / flags
    score: { overall: num(score.overall_financial_score), growth: num(score.growth_score), profitability: num(score.profitability_score), liquidity: num(score.liquidity_score), solvency: num(score.solvency_score), efficiency: num(score.efficiency_score) },
    bands: { revenue: ki.revenue ?? null, profit: ki.profit ?? null, employees: ki.employee_count ?? null },
    flags: { gstDelay: !!ki.gst_filing_delay, epfDelay: !!ki.epf_payment_delay, bureauDefaults: !!ki.bureau_defaults, pendingCases: !!ki.pending_cases_filed_against_this_corporate, severeCases: !!ki.severe_pending_cases_filed_against_this_corporate, struckOff: /struck/i.test(d.struckoff248_details?.struck_off_status ?? "") },
    creditRating, nameHistory, forex, agedReceivables,
    auditor, revenueMix, activityGroup, gstNature, managerialPay, proposedDividend, capexWip, borrowingCost, powerCost, assetAge,
    // latest snapshot
    latest: { year: fy(latestFin.year), ...L, ...r0 },
    // the full stories
    fin, employees: { latest: latestHeadcount, yearly: empYearly, monthly: empMonthly },
    peers: { industry: pc0.bizIndustry ?? null, segment: pc0.bizSegment ?? null, sampleSize: benchmarks[0]?.peers ?? null, named: namedPeers, benchmarks },
    vsMedian: { self: bm, median: bmMed },
    ownership, shareholders, directors, charges, legal, financialDisputes, group, relatedParty, gst: { list: gst, onTime: gstOnTime, total: gst.length }, allotments, paymentBehaviour,
  };

  detail.advanced = advanced(detail);
  detail.levers = buildLevers(detail);
  return detail;
}

/* --------------------------------------------------- advanced financial analysis
   Analyst-grade metrics computed from the statements we already hold (zero extra
   credits): 3- & 5-step DuPont decomposition of RoE, Piotroski F-score (0-9),
   Altman Z''-score (distress), free cash flow, earnings quality (accruals),
   operating leverage and per-year cost structure. Feeds both the health panel and
   the lever engine. Everything is null-safe — a metric only appears when its
   inputs exist, so nothing is fabricated. */
function advanced(x) {
  const fin = x.fin;
  const pc = (a, b) => (a != null && b != null && b !== 0 ? round((a / b) * 100, 1) : null); // a/b as %
  const perYear = fin.map((f) => {
    const rev = num(f.revenue), pat = num(f.pat), ebit = num(f.ebit), pbt = num(f.pbt);
    const ta = num(f.bs.totalAssets), eq = num(f.bs.equity);
    const inv = num(f.bs.inventory) ?? 0, recv = num(f.bs.receivables) ?? 0, cash = num(f.bs.cash) ?? 0;
    const pay = num(f.bs.payables) ?? 0, std = num(f.bs.shortTermDebt) ?? 0;
    const ocf = num(f.cf.operating), icf = num(f.cf.investing);
    const mat = (num(f.materialCost) ?? 0) + (num(f.purchases) ?? 0);
    const emp = num(f.employeeCost) ?? 0, oth = num(f.otherExpense) ?? 0, dep = num(f.depreciation) ?? 0;
    // DuPont is only defined on positive net worth. With negative equity the
    // multiplier goes negative, and a loss-making company then multiplies two
    // negatives into a healthy-looking positive RoE — Arovea showed +100% while
    // insolvent. Below zero the decomposition means nothing, so don't publish one.
    const netMargin = rev ? pat / rev : null, assetTurn = ta ? rev / ta : null, equityMult = eq && eq > 0 ? ta / eq : null;
    return {
      fy: f.fy, ta,
      // DuPont pieces (ratios, not %)
      netMargin, assetTurn, equityMult,
      roe: netMargin != null && assetTurn != null && equityMult != null ? round(netMargin * assetTurn * equityMult * 100, 1) : null,
      taxBurden: pbt ? round(pat / pbt, 2) : null, intBurden: ebit ? round(pbt / ebit, 2) : null, opMargin: rev ? round((ebit / rev) * 100, 1) : null,
      // cash
      fcf: ocf != null && icf != null ? round(ocf + icf, 1) : null,
      accruals: pat != null && ocf != null && ta ? round(((pat - ocf) / ta) * 100, 1) : null, // % of assets; high +ve = low quality
      workingCapital: round(inv + recv + cash - pay - std, 1),
      // cost structure (% of revenue)
      costMix: rev ? { material: pc(mat, rev), employee: pc(emp, rev), other: pc(oth, rev), deprec: pc(dep, rev) } : null,
      _raw: { rev, pat, ocf, ebit, roa: ta ? pat / ta : null, gross: num(f.r.grossMargin), de: num(f.r.debtEquity), cur: num(f.r.currentRatio), share: num(f.bs.shareCapital), reserves: num(f.bs.reserves), eq },
    };
  });
  const A = perYear[perYear.length - 1] ?? null, B = perYear.length > 1 ? perYear[perYear.length - 2] : null;

  // Piotroski F-score — 9 fundamental checks, latest vs prior year
  let fscore = null; const fChecks = [];
  if (A && B) {
    const ck = (ok, label) => { fChecks.push({ ok: !!ok, label }); return ok ? 1 : 0; };
    fscore = ck(A._raw.pat > 0, "Profitable (net profit > 0)")
      + ck(A._raw.ocf > 0, "Positive operating cash flow")
      + ck(A._raw.roa != null && B._raw.roa != null && A._raw.roa > B._raw.roa, "Return on assets improving")
      + ck(A._raw.ocf != null && A._raw.pat != null && A._raw.ocf > A._raw.pat, "Cash flow beats profit (earnings quality)")
      + ck(A._raw.de != null && B._raw.de != null && A._raw.de <= B._raw.de, "Leverage down or flat")
      + ck(A._raw.cur != null && B._raw.cur != null && A._raw.cur > B._raw.cur, "Liquidity (current ratio) improving")
      + ck(A._raw.share != null && B._raw.share != null && A._raw.share <= B._raw.share, "No equity dilution")
      + ck(A._raw.gross != null && B._raw.gross != null && A._raw.gross > B._raw.gross, "Gross margin rising")
      + ck(A.assetTurn != null && B.assetTurn != null && A.assetTurn > B.assetTurn, "Asset turnover rising");
  }

  // Altman Z''-score (private / emerging-market form) — distress predictor
  let z = null, zZone = null, zNote = null;
  if (A && A.ta) {
    const totLiab = A.ta - (A._raw.eq ?? 0);
    // X4 (equity ÷ liabilities) is unbounded, so a near-debt-free company sends
    // the score to absurdity — Northern Aromatics carries equity 67× its
    // liabilities, which alone contributed 70 of a 79 "Z-score". Past roughly
    // 5× the ratio says nothing further about distress, so cap its contribution.
    // Everything above the cap is equally "not going bankrupt for lack of equity".
    const X1 = A.workingCapital / A.ta, X2 = (A._raw.reserves ?? 0) / A.ta, X3 = (A._raw.ebit ?? 0) / A.ta;
    const X4 = Math.min(totLiab > 0 ? (A._raw.eq ?? 0) / totLiab : 0, 5);
    z = round(3.25 + 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4, 2);
    zZone = z >= 2.6 ? "safe" : z >= 1.1 ? "grey" : "distress";
    // The Z'' form carries a 3.25 intercept, which is enough to float a company
    // with negative net worth into the "safe" band on working capital alone —
    // Ananya Herbal scored 3.94 "safe" on equity of −₹8 Cr. Liabilities above
    // assets is the textbook definition of balance-sheet insolvency, so it
    // overrides the arithmetic rather than being averaged into it.
    if ((A._raw.eq ?? 0) < 0) { zZone = "distress"; zNote = "liabilities exceed assets — negative net worth overrides the score"; }
  }

  // Operating leverage over the last 3 filed years: %Δ EBIT ÷ %Δ revenue (>1 = leverage working)
  let opLeverage = null;
  const win = perYear.slice(-3);
  if (win.length >= 2) {
    const r0 = win[0]._raw.rev, r1 = win[win.length - 1]._raw.rev, e0 = win[0]._raw.ebit, e1 = win[win.length - 1]._raw.ebit;
    if (r0 && r1 && e0 && e0 !== 0 && r0 !== 0) {
      const dRev = (r1 - r0) / Math.abs(r0), dEbit = (e1 - e0) / Math.abs(e0);
      if (Math.abs(dRev) > 0.02) opLeverage = round(dEbit / dRev, 2);
    }
  }

  const dupont = A ? { netMargin: A.netMargin != null ? round(A.netMargin * 100, 1) : null, assetTurn: A.assetTurn != null ? round(A.assetTurn, 2) : null, equityMult: A.equityMult != null ? round(A.equityMult, 2) : null, roe: A.roe, taxBurden: A.taxBurden, intBurden: A.intBurden, opMargin: A.opMargin } : null;
  // strip the private _raw before returning
  const clean = perYear.map(({ _raw, ...keep }) => keep);
  return { perYear: clean, fscore, fChecks, z, zZone, zNote, opLeverage, dupont, fcfLatest: A?.fcf ?? null, accrualsLatest: A?.accruals ?? null };
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
  const ev = (label, value, tab = "financials") => ({ label, value, tab });
  // insight = what we DO about it (the card header); title = the observation
  // behind it ("why"). The client asked for the action to lead, not the finding.
  // The signature widened from 5 args to 6 when `insight` was introduced, and two
  // detectors written afterwards kept the old shape — every argument landed one
  // slot early, so the card rendered the observation as the action and handed the
  // expander an evidence array where prose belongs. Cheap to assert, so assert.
  const add = (tone, strength, insight, title, detail, evidence) => {
    if (typeof insight !== "string" || typeof title !== "string" || typeof detail !== "string")
      throw new Error(`lever add() called with the old 5-arg signature: ${JSON.stringify([tone, strength, insight]).slice(0, 120)}`);
    out.push({ tone, strength, insight, title, detail, evidence: (evidence ?? []).filter(Boolean) });
  };
  const l = x.latest, med = x.vsMedian.median, fin = x.fin, a = x.advanced ?? {}, py = a.perYear ?? [];
  const gap = (self, m) => (self != null && m != null ? round(self - m, 1) : null);
  const rs = (v) => (v == null ? "—" : `₹${Math.round(Math.abs(v))} Cr`);
  const flOf = (sel) => { const v = py.map(sel).filter((n) => n != null); return v.length >= 2 ? { first: v[0], last: v[v.length - 1], d: round(v[v.length - 1] - v[0], 1) } : null; };
  const dp = a.dupont;

  /* ===== A. MARGIN & COST STRUCTURE ===== */
  const emGap = gap(l.ebitdaMargin, med.ebitdaMargin);
  if (emGap != null && emGap >= 3) add("opportunity", emGap >= 8 ? 3 : 2, "Room to push on price", "Fatter margins than its peers",
    `EBITDA margin ${l.ebitdaMargin}% vs the peer median ${med.ebitdaMargin}% — about ${emGap}pp of extra cushion baked into their pricing. There's room to push on price.`,
    [ev("EBITDA margin", l.ebitdaMargin + "%"), ev("Peer median", med.ebitdaMargin + "%", "peers"), ev("Advantage", emGap + "pp", "peers")]);
  else if (emGap != null && emGap <= -3) add("watch", 1, "Push on terms, not on price", "Thinner margins than peers",
    `EBITDA margin ${l.ebitdaMargin}% is below the peer median ${med.ebitdaMargin}% — less room; lean on input-cost transparency rather than a blunt cut.`,
    [ev("EBITDA margin", l.ebitdaMargin + "%"), ev("Peer median", med.ebitdaMargin + "%", "peers")]);

  const em = trendOf(fin, (f) => f.r.ebitdaMargin);
  if (em && em.all.length >= 3 && em.delta >= 1.5) add("opportunity", 2, "Ask for a price cut — they can absorb it", "Margins are widening",
    `EBITDA margin climbed ${em.first}% → ${em.last}% — profit is expanding, so they can absorb a better price for us.`,
    [ev("EBITDA margin", `${em.first}% → ${em.last}%`)]);
  else if (em && em.all.length >= 3 && em.delta <= -1.5) add("watch", 1, "Expect a price-rise request; pre-empt it", "Margins are compressing",
    `EBITDA margin slipped ${em.first}% → ${em.last}% — they're being squeezed; a hard cut meets resistance, but they need our volume.`,
    [ev("EBITDA margin", `${em.first}% → ${em.last}%`)]);

  const othFL = flOf((p) => p.costMix?.other);
  if (othFL && othFL.d >= 3 && l.grossMargin != null && l.grossMargin >= 20)
    add("opportunity", 2, "Anchor on their COGS, not their net margin", "Margin eaten by overhead, not input cost",
      `Gross margin is a healthy ${l.grossMargin}% — their raw-material economics are fine — but overhead (other expenses) climbed from ${othFL.first}% to ${othFL.last}% of sales. Overhead is semi-fixed and amortises as they scale, so their underlying unit economics already support a lower price. Anchor on their COGS, not the reported net margin.`,
      [ev("Gross margin", l.grossMargin + "%"), ev("Overhead % of sales", `${othFL.first}% → ${othFL.last}%`), ev("EBITDA margin", l.ebitdaMargin + "%")]);

  const matFL = flOf((p) => p.costMix?.material);
  if (matFL && matFL.d >= 4)
    add("watch", 1, "Fix a rupee price before they pass it through", "Their input costs are climbing",
      `Material cost rose ${matFL.first}% → ${matFL.last}% of sales — they'll try to pass this on. Pre-empt with a fixed-price or index-linked contract before they reprice us.`,
      [ev("Material % of sales", `${matFL.first}% → ${matFL.last}%`)]);

  /* ===== B. RETURNS (DuPont) ===== */
  if (l.roce != null && (l.roce >= 25 || (med.roce != null && l.roce > med.roce * 1.3)))
    add("opportunity", l.roce >= 35 ? 3 : 2, "They can afford to share margin", "Very profitable use of capital",
      `RoCE ${l.roce}%${med.roce != null ? ` vs peers ${med.roce}%` : ""} — they earn well above the cost of capital; there's margin to share with us.`,
      [ev("RoCE", l.roce + "%"), med.roce != null ? ev("Peer median", med.roce + "%", "peers") : null]);

  if (dp && dp.roe != null) {
    if (dp.equityMult != null && dp.equityMult >= 2.5 && (dp.netMargin ?? 0) < 6)
      add("risk", 2, "Don't squeeze — continuity is the risk here", "Their returns are debt-manufactured",
        `DuPont: RoE ${dp.roe}% is propped up by leverage (equity multiplier ${dp.equityMult}×), not operations (net margin only ${dp.netMargin}%). A leverage-driven return is fragile — they need steady cash (our leverage), but squeeze too hard and continuity is at risk.`,
        [ev("RoE", dp.roe + "%"), ev("Equity multiplier", dp.equityMult + "×"), ev("Net margin", dp.netMargin + "%")]);
    else if (dp.netMargin != null && dp.netMargin >= 8 && (dp.equityMult ?? 99) <= 1.6)
      add("opportunity", 2, "Real, structural room in the price", "Returns come from fat margins, not leverage",
        `DuPont: RoE ${dp.roe}% is driven by a ${dp.netMargin}% net margin on a near-unleveraged balance sheet (equity multiplier ${dp.equityMult}×). An under-leveraged, high-margin operator — plenty of margin to give. Push on price, not terms.`,
        [ev("RoE", dp.roe + "%"), ev("Net margin", dp.netMargin + "%"), ev("Equity multiplier", dp.equityMult + "×")]);
  }

  const roceT = trendOf(fin, (f) => f.r.roce);
  if (roceT && roceT.all.length >= 3 && roceT.delta <= -5)
    add("opportunity", 1, "They need the volume — trade it for price", "Returns are trending down",
      `RoCE slid ${roceT.first}% → ${roceT.last}% over recent years — profitability pressure strengthens our case; they may concede on price to hold volume.`,
      [ev("RoCE", `${roceT.first}% → ${roceT.last}%`)]);

  /* ===== C. WORKING CAPITAL ===== */
  if (l.payableDays != null && med.payableDays != null && l.payableDays >= med.payableDays + 10)
    add("opportunity", 2, "Ask for the terms they take themselves", "They already stretch their own suppliers",
      `They take ${l.payableDays} days to pay vs a peer norm of ${med.payableDays} — asking them for longer terms is credible; they do it themselves.`,
      [ev("Their payment days", l.payableDays + " d"), ev("Peer norm", med.payableDays + " d", "peers")]);

  const dpoT = trendOf(fin, (f) => f.r.payableDays, 6);
  if (dpoT && dpoT.all.length >= 4 && dpoT.first - dpoT.last >= 15)
    add("watch", 2, "Offer early payment for a discount", "Their suppliers are squeezing them (paying faster)",
      `Days-payable fell ${Math.round(dpoT.first)} → ${Math.round(dpoT.last)} — their upstream cut their credit. A vendor forced to pay faster passes the same pressure to us; lock our terms in now.`,
      [ev("Days payable", `${Math.round(dpoT.first)} → ${Math.round(dpoT.last)}`)]);

  const cccT = trendOf(fin, (f) => f.r.cashConversion, 8);
  if (l.cashConversion != null && l.cashConversion >= 90)
    add("opportunity", 2, "Trade faster payment for a lower price", "Cash is tied up for months",
      `Cash-conversion cycle ${l.cashConversion} days${cccT && cccT.all.length >= 3 ? ` (was ${Math.round(cccT.first)})` : ""} — a lot of working capital is locked up. An early-payment-for-discount offer will land well.`,
      [ev("Cash cycle", l.cashConversion + " d"), med.cashConversion != null ? ev("Peer median", med.cashConversion + " d", "peers") : null]);
  else if (cccT && cccT.all.length >= 4 && cccT.last - cccT.first >= 30)
    add("opportunity", 2, "Early payment is worth real money to them", "Working capital is deteriorating",
      `Cash-conversion cycle stretched ${Math.round(cccT.first)} → ${Math.round(cccT.last)} days — inventory and receivables increasingly tie up cash. They're cash-hungry: trade faster payment for a price cut.`,
      [ev("Cash cycle", `${Math.round(cccT.first)} → ${Math.round(cccT.last)} d`)]);

  const dsoT = trendOf(fin, (f) => f.r.debtorDays, 6);
  if (dsoT && dsoT.all.length >= 4 && dsoT.last - dsoT.first >= 20)
    add("opportunity", 1, "Use early payment as our lever", "They're funding their own customers",
      `Collection days rose ${Math.round(dsoT.first)} → ${Math.round(dsoT.last)} — cash is increasingly stuck in receivables. That pressure is our early-pay leverage.`,
      [ev("Collection days", `${Math.round(dsoT.first)} → ${Math.round(dsoT.last)} d`)]);
  else if (l.debtorDays != null && l.debtorDays <= 55 && (med.debtorDays == null || l.debtorDays <= med.debtorDays))
    add("opportunity", 1, "Push our own payment terms out", "Collects its cash quickly",
      `Gets paid in ${l.debtorDays} days${med.debtorDays != null ? ` (peers ${med.debtorDays})` : ""} — a healthy cash position, so we can push to extend our own terms.`,
      [ev("Collection days", l.debtorDays + " d"), med.debtorDays != null ? ev("Peer median", med.debtorDays + " d", "peers") : null]);

  const invT = trendOf(fin, (f) => f.r.inventoryDays, 6);
  if (invT && invT.all.length >= 4 && invT.last - invT.first >= 25)
    add("opportunity", 1, "Buy off their existing stock at a discount", "Inventory is piling up",
      `Inventory days rose ${Math.round(invT.first)} → ${Math.round(invT.last)} — stock is building faster than it sells. Overstocked suppliers move on price to clear volume.`,
      [ev("Inventory days", `${Math.round(invT.first)} → ${Math.round(invT.last)} d`)]);

  if (l.currentRatio != null && l.currentRatio < 1.2)
    add("opportunity", 1, "Buy a discount with faster payment", "Thin liquidity — early pay is valuable to them",
      `Current ratio ${l.currentRatio}${l.quickRatio != null ? ` (quick ${l.quickRatio})` : ""} — short on near-term cash cover. Faster payment from us is worth a discount to them.`,
      [ev("Current ratio", String(l.currentRatio)), l.quickRatio != null ? ev("Quick ratio", String(l.quickRatio)) : null]);

  /* ===== D. CASH FLOW & QUALITY ===== */
  const cfo = l.operating;
  if (cfo != null && cfo < 0) add("risk", 2, "Secure supply before pressing on price", "Burning cash from operations",
    `Operating cash flow was −${rs(cfo)} last year — the core business consumed cash; watch supply continuity.`,
    [ev("Operating cash flow", `−${rs(cfo)}`)]);
  // Gated on free cash flow too: operating cash above profit says the P&L is
  // real, not that they're cash-rich. Manjushree throws off ₹300 Cr of operating
  // cash and still runs negative after capex, so "they don't need our cash" sat
  // on the same page as "they're cash-hungry". Below, the FCF lever gets it.
  else if (cfo != null && l.pat != null && cfo > l.pat * 1.2 && cfo > 0 && (a.fcfLatest ?? 0) >= 0) add("opportunity", 1, "Push on price — they don't need our cash", "Strong cash generation",
    `Generated ${rs(cfo)} of operating cash (above net profit ${rs(l.pat)}) — comfortably cash-positive, so they don't need to claw margin from us. Push on price, not terms.`,
    [ev("Operating cash flow", rs(cfo)), ev("Net profit", rs(l.pat))]);

  if (a.accrualsLatest != null && a.accrualsLatest >= 6)
    add("watch", 1, "Treat the reported profit with caution", "Profit isn't turning into cash",
      `Reported profit runs well ahead of cash generated (accruals ${a.accrualsLatest}% of assets) — soft earnings quality, a sign of hidden cash strain. They're more cash-motivated than the P&L suggests.`,
      [ev("Accruals (profit vs cash)", a.accrualsLatest + "% of assets")]);

  if (a.fcfLatest != null && a.fcfLatest < 0 && l.pat != null && l.pat > 0)
    add("opportunity", 1, "Trade committed volume for a better price", "Free cash flow is negative — they're cash-hungry",
      `Despite ${rs(l.pat)} of net profit, free cash flow is −${rs(a.fcfLatest)} — they're pouring cash into capex/working capital. A supplier funding expansion needs committed volume; trade it for price.`,
      [ev("Free cash flow", `−${rs(a.fcfLatest)}`), ev("Net profit", rs(l.pat))]);

  /* ===== E. LEVERAGE & SOLVENCY ===== */
  if (l.debtEquity != null && l.debtEquity <= 0.3)
    add("opportunity", 1, "They can carry a longer credit period for us", "Almost no debt",
      `Debt-to-equity just ${l.debtEquity} — a clean balance sheet, no interest burden to hide behind. There's room on price.`,
      [ev("Debt / equity", String(l.debtEquity))]);
  if (l.debtEquity != null && l.debtEquity >= 1.5)
    add("risk", 2, "Keep a second source qualified", "Heavily leveraged",
      `Debt-to-equity ${l.debtEquity}${l.interestCover != null ? `, interest cover ${l.interestCover}×` : ""} — a stretched balance sheet; squeeze too hard and supply reliability is at risk.`,
      [ev("Debt / equity", String(l.debtEquity)), l.interestCover != null ? ev("Interest cover", l.interestCover + "×") : null]);
  else if (l.interestCover != null && l.interestCover < 2.5)
    add("risk", 2, "Don't push to breaking point — qualify a backup", "Barely covers its interest bill",
      `Interest cover only ${l.interestCover}× — profit barely clears the interest. A cash-strained, rate-sensitive supplier; continuity risk if pushed.`,
      [ev("Interest cover", l.interestCover + "×")]);

  if (a.zZone === "distress")
    add("risk", 3, "Qualify an alternative source now", "Distress-zone balance sheet (Altman Z)",
      `Altman Z-score ${a.z} puts them in the distress zone — elevated financial-failure risk. A real continuity concern: qualify a backup source now, and they may trade price for guaranteed, promptly-paid volume.`,
      [ev("Altman Z-score", `${a.z} (distress)`, "risk")]);
  else if (a.zZone === "grey")
    add("watch", 1, "Watch solvency before committing volume", "Balance sheet in the caution zone (Altman Z)",
      `Altman Z-score ${a.z} sits in the grey zone — not distress, but not comfortably safe. Worth keeping an eye on continuity.`,
      [ev("Altman Z-score", `${a.z} (grey)`, "risk")]);

  /* ===== F. HEALTH COMPOSITE (Piotroski) ===== */
  if (a.fscore != null && a.fscore >= 7)
    add("watch", 1, "A strengthening supplier will hold its price", "Fundamentally strengthening (F-score high)",
      `Piotroski F-score ${a.fscore}/9 — improving on most fundamental checks (profitability, cash, efficiency). A healthy, strengthening supplier that wants to grow with us — good for a volume-commitment deal, though they can hold their price.`,
      [ev("Piotroski F-score", a.fscore + "/9")]);
  else if (a.fscore != null && a.fscore <= 3)
    add("opportunity", 2, "They need the business — lean in", "Fundamentals are weakening (F-score low)",
      `Piotroski F-score ${a.fscore}/9 — deteriorating across profitability/leverage/efficiency checks. A weakening supplier is likelier to concede on price to keep our volume — but line up a backup.`,
      [ev("Piotroski F-score", a.fscore + "/9")]);

  /* ===== G. GROWTH & SCALE ===== */
  const rev = trendOf(fin, (f) => f.revenue, 3);
  const growth = rev && rev.first ? round(((rev.last - rev.first) / rev.first) * 100, 0) : null;
  if (growth != null && growth >= 25) add("opportunity", 1, "Trade our growth for their price", "Growing fast — wants to keep us",
    `Revenue up ${rs(rev.first)} → ${rs(rev.last)}${a.opLeverage != null && a.opLeverage > 1.3 ? `, with operating leverage ${a.opLeverage}× (profit growing faster than sales)` : ""} — a growing supplier that will fight to keep our volume.`,
    [ev("Revenue", `${rs(rev.first)} → ${rs(rev.last)}`), a.opLeverage != null ? ev("Operating leverage", a.opLeverage + "×") : null]);
  else if (growth != null && growth <= -10) add("opportunity", 2, "They need the business — press on price and terms", "Revenue is shrinking",
    `Revenue fell ${rs(rev.first)} → ${rs(rev.last)} — they need the business; lean in on price and terms.`,
    [ev("Revenue", `${rs(rev.first)} → ${rs(rev.last)}`)]);

  if (a.opLeverage != null && a.opLeverage >= 2 && !(growth != null && growth >= 25))
    add("opportunity", 1, "Trade volume for a lower unit price", "High operating leverage — hungry for volume",
      `Operating leverage ${a.opLeverage}× — each 1% of extra sales lifts profit about ${a.opLeverage}%. Incremental volume is very profitable to them, so they'll trade price for our order size.`,
      [ev("Operating leverage", a.opLeverage + "×")]);

  /* ===== H. BEHAVIOUR / STATUTORY / LEGAL ===== */
  if (x.paymentBehaviour.hasData && (x.paymentBehaviour.worstLakh ?? 0) >= 10)
    add("watch", 1, "Expect them to hold firm on terms", "Pays its own small vendors late",
      `Delayed MSME dues (worst ${x.paymentBehaviour.worstPeriod}: ₹${x.paymentBehaviour.worstLakh} L) — a tight cash desk. They'll hold firm on terms, but that same cash need makes an early-pay discount attractive to them.`,
      [ev("Worst MSME overdue", `₹${x.paymentBehaviour.worstLakh} L`, "risk")]);
  if (x.score.overall != null && x.score.overall < 4)
    add("risk", 2, "Diligence them before committing volume", "Weak overall financial score",
      `Probe rates them ${x.score.overall}/10 overall — financially fragile; keep a qualified backup source.`,
      [ev("Probe score", x.score.overall + "/10")]);
  if (x.legal.high > 0) add("risk", 3, "Diligence the litigation before renewing", "Serious legal cases pending",
    `${x.legal.high} high-severity court case${x.legal.high > 1 ? "s" : ""} (of ${x.legal.count} total) — a real continuity/reputation risk worth diligence.`,
    [ev("High-severity cases", String(x.legal.high), "risk"), ev("Total cases", String(x.legal.count), "risk")]);
  else if (x.legal.count >= 5) add("watch", 1, "Worth a look before renewal", "Several court cases on record",
    `${x.legal.count} cases on file (${x.legal.against} filed against them) — mostly routine, but worth a glance.`,
    [ev("Cases on file", String(x.legal.count), "risk")]);
  // --- financial-dispute litigation (recovery / default) ---
  const fd = x.financialDisputes;
  if (fd && fd.payable > 0) add("risk", 2, "Treat any advance payment with caution", "Being pursued for financial defaults",
    `${fd.payable} financial-dispute case${fd.payable > 1 ? "s" : ""} where they're the defendant — someone is chasing them in court for money owed. A solvency / cash-flow red flag.`,
    [ev("Defaults pursued", String(fd.payable), "risk")]);
  else if (fd && fd.receivable >= 2) add("watch", 1, "Expect them to stay tight on our terms", "Chasing customers through the courts",
    `${fd.receivable} recovery/insolvency case${fd.receivable > 1 ? "s" : ""} they've filed to collect from customers — their own receivables are turning bad, so expect them to stay tight on the terms they give us.`,
    [ev("Recovery cases", String(fd.receivable), "risk")]);
  if (x.flags.gstDelay || x.flags.epfDelay) add("watch", 1, "An early cash-squeeze signal — watch it", "Late on statutory filings",
    `${[x.flags.gstDelay && "GST filing", x.flags.epfDelay && "EPF payment"].filter(Boolean).join(" + ")} delays on record — often an early sign of a cash squeeze.`,
    [ev("Filing flags", [x.flags.gstDelay && "GST", x.flags.epfDelay && "EPF"].filter(Boolean).join(" + "), "risk")]);
  if (x.flags.bureauDefaults) add("risk", 3, "Secure supply and avoid advances", "Credit-bureau default flagged",
    "A bureau default is on record — treat commitments and advances with caution.",
    [ev("Bureau default", "on record", "risk")]);

  const hc = x.employees.yearly;
  if (hc.length >= 3) {
    const f = hc[hc.length - 3].count, la = hc[hc.length - 1].count;
    if (f && la && la <= f * 0.85) add("watch", 1, "Check they can still service our volume", "Cutting headcount",
      `Employees down ~${f} → ~${la} — a shrinking team can signal distress or restructuring.`,
      [ev("Headcount", `~${f} → ~${la}`)]);
  }

  // --- external credit rating (the outside-in agency view) ---
  const rt = x.creditRating;
  if (rt) {
    const rev = rt.gradeText ? [ev("Rating", rt.gradeText, "risk"), rt.agency && ev("Agency", rt.agency, "risk")].filter(Boolean) : [];
    if (rt.flags.isDefault) add("risk", 3, "Secure supply now", "Rated in default",
      `${rt.agency ?? "Their agency"} has them at default grade (${rt.gradeText ?? "D"}) — a serious solvency signal; secure supply and treat any advance with caution.`, rev);
    else if (rt.flags.inc) add("risk", 2, "Push for transparency; keep a backup ready", "Rating flagged 'Issuer Not Cooperating'",
      `${rt.agency ?? "The agency"} tags them "Issuer Not Cooperating"${rt.grade ? `, last around ${rt.grade}` : ""} — they stopped engaging their rating agency, often a stress or opacity signal. Push for transparency; keep a qualified backup.`, rev);
    else if (rt.flags.subInvestmentGrade) add("risk", 2, "Good for an early-pay discount, bad for continuity", "Sub-investment-grade credit",
      `${rt.agency ?? "Their agency"} rates them ${rt.grade} — below investment grade; lenders price in elevated risk. Read as cash-constrained: a strong lever for early-pay discounts, and worth hedging supply.`, rev);
    else if (rt.flags.downgraded) add("watch", 2, "Watch for cash strain building", "Credit rating has slipped",
      `Their agency rating has been downgraded over time (now ${rt.grade}) — deteriorating credit quality; watch for cash strain building.`, rev);
    else if (rt.flags.strong) add("watch", 1, "They can hold price — push volume and service instead", "Solid investment-grade credit",
      `${rt.agency ?? "Their agency"} rates them ${rt.grade} — a financially sound, well-regarded supplier: reliable, but they can comfortably hold their price.`, rev);
  }
  // --- forex / import exposure ---
  if (x.forex && x.forex.spendCr != null && x.forex.spendCr >= 20 && x.forex.spendCr > (x.forex.earnCr ?? 0) * 1.5)
    add("watch", 1, "Lock a rupee price before the next FX move", "Import-exposed cost base",
      `Spends ₹${x.forex.spendCr} Cr in foreign currency vs ₹${x.forex.earnCr ?? 0} Cr earned — a net importer, so a weaker rupee lifts their input costs and they'll try to pass it on. Lock a fixed-price rupee contract to pre-empt it.`,
      [ev("Forex spend", `₹${x.forex.spendCr} Cr`), ev("Forex earned", `₹${x.forex.earnCr ?? 0} Cr`)]);
  // --- aged receivables (>6 months) ---
  if (x.agedReceivables && x.agedReceivables.amountCr != null && x.latest.revenue && x.agedReceivables.amountCr >= x.latest.revenue * 0.1)
    add("watch", 1, "Early payment should buy us a discount", "Aged receivables piling up",
      `₹${x.agedReceivables.amountCr} Cr of receivables are over six months old — cash stuck, a sign of collection strain. A cash-tight supplier is more open to early-pay-for-discount.`,
      [ev("Receivables >6m", `₹${x.agedReceivables.amountCr} Cr`, "risk")]);

  // --- what kind of business are we actually negotiating with? ---
  // A trader marks up someone else's goods: the markup IS their whole margin, so
  // pushing hard risks the relationship. A manufacturer owns its conversion
  // margin, which is where the real, defensible room lives.
  const rm = x.revenueMix;
  if (rm) {
    if (rm.kind === "trader" && rm.tradedPct >= 60)
      add("watch", 2, "Negotiate their markup, or go upstream", "They're a trader, not a maker",
        `${rm.tradedPct}% of revenue is bought-in goods resold, not manufactured. Their margin is the markup on someone else's price, so there's less to concede than the headline suggests — push them to disclose the landed cost and negotiate the markup, or go upstream to the actual maker.`,
        [ev("Traded", `${rm.tradedPct}%`), ev("Manufactured", `${rm.manufacturedPct}%`)]);
    else if (rm.kind === "manufacturer" && rm.manufacturedPct >= 70 && (x.latest.grossMargin ?? 0) > 0)
      add("opportunity", 2, "Structural room in the price, not just a markup", "They own their conversion margin",
        `${rm.manufacturedPct}% of revenue is goods they manufacture themselves, on a ${x.latest.grossMargin}% gross margin. Unlike a trader, the spread between input cost and our price is theirs to set — so there is real, structural room in the price, not just a thin resale markup.`,
        [ev("Manufactured", `${rm.manufacturedPct}%`), ev("Gross margin", `${x.latest.grossMargin}%`)]);
    // Export share cuts both ways — hedge against us, but also a rupee tailwind.
    if (rm.exportPct >= 25)
      add("watch", 2, "Argue the rupee gain into our price", "A quarter-plus of demand is export",
        `${rm.exportPct}% of sales (₹${rm.exportCr} Cr) go abroad. They're not dependent on Indian buyers, which weakens our volume threat — but export revenue also earns them foreign currency, so a weak rupee is already lifting their realisations. Argue that the rupee gain should show up in our price.`,
        [ev("Export share", `${rm.exportPct}%`), ev("Export revenue", `₹${rm.exportCr} Cr`)]);
  }

  // --- inventory: cash sitting on their floor ---
  const inv = { self: x.vsMedian.self.inventoryDays, median: x.vsMedian.median.inventoryDays };
  if (inv.self != null && inv.median != null && inv.self >= inv.median * 1.4 && inv.self >= 45)
    add("opportunity", 2, "Push for a volume commitment against a lower price", "Stock is sitting far longer than peers",
      `They hold inventory ${inv.self} days vs a peer norm of ${inv.median} — that's cash frozen on their own floor. A supplier carrying excess stock wants it moving: push for a volume commitment against a lower unit price, or buy off their existing stock at a discount rather than a fresh run.`,
      [ev("Inventory days", `${inv.self} d`), ev("Peer norm", `${inv.median} d`)]);

  // --- money leaving for the owners while they hold price ---
  const mp = x.managerialPay;
  if (mp && mp.pctOfProfit != null && mp.pctOfProfit >= 25)
    add("opportunity", 2, "Treat a \"we have no margin\" claim with scepticism", "Owner pay is a big slice of profit",
      `Managerial remuneration of ₹${mp.amountCr} Cr is ${mp.pctOfProfit}% of profit after tax. A chunk of what the business earns is being taken out at the top, which means the reported bottom line understates what the operation itself can absorb — treat a "we have no margin" claim with scepticism.`,
      [ev("Managerial pay", `₹${mp.amountCr} Cr`), ev("Of profit after tax", `${mp.pctOfProfit}%`)]);
  if (x.proposedDividend && (x.latest.netMargin ?? 0) > 0)
    add("opportunity", 1, "Hard to plead poverty while paying shareholders", "Paying dividends out",
      `They're proposing a dividend — cash is being distributed to shareholders rather than retained for the business. Hard to argue they're too cash-strapped to move on price when they're paying owners.`,
      [ev("Proposed dividend", "yes")]);

  // --- capacity under construction: the classic future-margin chain ---
  // Money is in the ground, the asset isn't earning yet, and it will need volume
  // to pay back. That combination is at its most negotiable right now.
  const wip = x.capexWip;
  if (wip && wip.pctOfFixedAssets != null && wip.pctOfFixedAssets >= 15)
    add("opportunity", 3, "Lock a multi-year price before the line starts", "Building capacity they'll need to fill",
      `₹${wip.amountCr} Cr sits in capital work-in-progress — ${wip.pctOfFixedAssets}% of their fixed assets is capacity that's paid for but not yet producing. Once it comes online their fixed costs step up and they need volume to absorb it, so committed offtake is worth more to them now than it will be later. Trade a multi-year volume commitment for a lower unit price before the line starts.`,
      [ev("Capital WIP", `₹${wip.amountCr} Cr`), ev("Of fixed assets", `${wip.pctOfFixedAssets}%`)]);

  // --- what their money costs: the price of an early-payment discount ---
  // If they borrow at 14%, thirty days of early cash is worth ~1.2% to them —
  // that is a real, arithmetic ceiling on the discount we can ask for, not a
  // guess. Cheap borrowers simply won't trade much for early cash.
  const bc = x.borrowingCost;
  if (bc?.ratePct != null && bc.ratePct >= 11) {
    const perMonth = Math.round((bc.ratePct / 12) * 100) / 100;
    add("opportunity", 3, "Ask for an early-pay discount priced at their loan rate", "Their borrowed money is expensive",
      `Their secured facilities carry ${bc.ratePct}% interest. Every month we pay early effectively lends them cash at that rate — worth about ${perMonth}% a month to them. That sets a defensible number for an early-payment discount: ask for ~${perMonth}% for 30 days, ~${Math.round(perMonth * 2 * 100) / 100}% for 60, and it still leaves them better off than their bank.`,
      [ev("Interest on secured debt", `${bc.ratePct}%`, "risk"), ev("Worth per month early", `~${perMonth}%`)]);
  } else if (bc?.ratePct != null && bc.ratePct <= 8.5) {
    add("watch", 1, "Push unit price, not payment timing", "They borrow cheaply",
      `Secured facilities at just ${bc.ratePct}% — bank funding is cheap for them, so early payment buys us very little. Push on unit price and volume terms instead of payment timing.`,
      [ev("Interest on secured debt", `${bc.ratePct}%`)]);
  }

  // --- energy intensity: whose cost shock is it? ---
  const pw = x.powerCost;
  if (pw?.pctOfRevenue != null && pw.pctOfRevenue >= 4)
    add("watch", 1, "Fix the energy component in the contract", "Energy-heavy cost base",
      `Power and fuel run ₹${pw.amountCr} Cr, ${pw.pctOfRevenue}% of revenue. Tariff moves hit them directly and they'll try to pass them through — worth fixing the energy component in a contract rather than reopening price every tariff revision.`,
      [ev("Power & fuel", `₹${pw.amountCr} Cr`), ev("Of revenue", `${pw.pctOfRevenue}%`)]);

  // --- how much life is left in the plant ---
  const aa = x.assetAge;
  if (aa?.depreciatedPct != null && aa.depreciatedPct >= 70)
    add("opportunity", 2, "Committed volume beats a few rupees on unit price", "Their plant is largely written down",
      `${aa.depreciatedPct}% of the gross asset base is already depreciated (₹${aa.netCr} Cr left of ₹${aa.grossCr} Cr). Two things follow: the depreciation charge dragging on their reported profit is mostly historic, so cash generation is better than the P&L suggests — and replacement capex is coming, which makes committed volume from us worth more than a few rupees on unit price.`,
      [ev("Depreciated", `${aa.depreciatedPct}%`), ev("Net / gross fixed assets", `₹${aa.netCr} / ₹${aa.grossCr} Cr`)]);

  // --- who signs the accounts ---
  const au = x.auditor;
  if (au?.anyAdverse && (au.adverseRecent || au.adverseSustained))
    add("risk", 3, "Treat the financials as unreliable until clarified", "Auditor keeps raising adverse remarks",
      `Their auditor filed adverse remarks in ${au.adverseYears.join(", ")}${au.adverseSustained ? ` — ${au.adverseYears.length} years of them` : ` (including the latest filed year)`}. Every number in this analysis rests on those accounts, so treat the financials as unreliable until clarified and diligence hard before committing volume.`,
      [ev("Adverse years", au.adverseYears.join(", "), "risk"), ev("Latest filed", au.latestFy ?? "—", "risk")]);
  else if (au?.anyAdverse)
    add("watch", 1, "Worth one question, not a red flag", "Auditor raised adverse remarks in the past",
      `There were adverse auditor remarks in ${au.adverseYears.join(", ")}, but not in the recent filed years (latest ${au.latestFy}). Reads as a resolved historical issue rather than a live one — worth one question, not a red flag.`,
      [ev("Adverse years", au.adverseYears.join(", ")), ev("Latest filed", au.latestFy ?? "—")]);
  else if (au && au.changes >= 2)
    add("watch", 2, "Ask why before leaning on their reported numbers", "Auditor has changed repeatedly",
      `${au.changes} auditor changes across the filed years (${au.firms.join(" → ")}). Frequent rotation isn't proof of anything on its own, but it's a governance signal worth a question before leaning on their reported numbers.`,
      [ev("Auditor changes", String(au.changes)), ev("Current", au.current ?? "—")]);

  // --- the agency's forward view ---
  if (rt?.outlook && /negative/i.test(rt.outlook))
    add("watch", 2, "Trade price for certainty while they still want it", "Rating outlook is negative",
      `${rt.agency ?? "Their agency"} has them on a Negative outlook at ${rt.grade ?? rt.gradeText} — the agency expects deterioration, which the grade alone doesn't show. Expect cash discipline and more willingness to trade price for certainty; keep a backup qualified.`,
      [ev("Outlook", rt.outlook, "risk"), ev("Grade", rt.grade ?? "—", "risk")]);

  // sort: opportunities first, then watch, then risk; strongest first
  const toneRank = { opportunity: 0, watch: 1, risk: 2 };
  out.sort((p, q) => toneRank[p.tone] - toneRank[q.tone] || q.strength - p.strength);
  return out;
}

/* ------------------------------------------------------------------------- run */

const ENT = existsSync("data/clean/entities.json")
  ? new Map((JSON.parse(readFileSync("data/clean/entities.json", "utf8")).entities ?? []).map((e) => [e.cin, e]))
  : new Map();

const outObj = {};
if (existsSync(CACHE)) {
  for (const f of readdirSync(CACHE)) {
    if (!f.endsWith(".json")) continue;
    const cin = f.replace(/\.json$/, "");
    try { outObj[cin] = build(JSON.parse(readFileSync(join(CACHE, f), "utf8")), ENT.get(cin)); }
    catch (e) { console.log(`  ! ${cin}: ${e.message}`); }
  }
}
writeFileSync(OUT, JSON.stringify(outObj, null, 2));
console.log(`Wrote ${OUT} — ${Object.keys(outObj).length} companies`);
for (const [cin, v] of Object.entries(outObj))
  console.log(`  ${clean(v.legalName)} (${cin}): ${v.yearsCovered}yr · ${v.fin.length} fin rows · ${v.employees.monthly.length}mo headcount · ${v.legal.count} cases · ${v.levers.length} levers · score ${v.score.overall}/10`);
