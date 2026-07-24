// Supplier-analysis insight engine. Turns the raw Tracxn / Probe42 numbers into
// plain-English, actionable levers for mcAFFEINE's negotiators — the core purpose
// of the dashboard: "where can we push, and where's the risk?".
//
// The headline idea (from the client): a supplier that collects cash from its own
// customers quickly, or already stretches its own suppliers, has room for us to
// negotiate longer payment terms / better price. Everything here is derived from
// data we actually hold, with the exact numbers quoted so a negotiator can use it.

import type { Entity } from "../types";

const ly = (e: Entity) => {
  const ys = e.profile?.years;
  return ys && ys.length ? ys[ys.length - 1] : null;
};
const fy = (e: Entity) => {
  const ys = e.profile?.years;
  return ys && ys.length ? ys[0] : null;
};

// Metric accessors — prefer the multi-year PDF profile, then Probe42, then the
// registry base. Used by both the insight rules and the benchmark charts.
export const supDSO = (e: Entity) => ly(e)?.receivableDays ?? e.probe?.receivableDays ?? null;
export const supDPO = (e: Entity) => ly(e)?.payableDays ?? e.probe?.payableDays ?? null;
export const supCCC = (e: Entity) => ly(e)?.cashConversionDays ?? e.probe?.cashConversionCycleDays ?? null;
export const supEbitda = (e: Entity) => e.financials.ebitdaMarginPct ?? ly(e)?.ebitdaMarginPct ?? null;
export const supNet = (e: Entity) => e.financials.netMarginPct ?? ly(e)?.netMarginPct ?? null;
export const supRoce = (e: Entity) => ly(e)?.rocePct ?? e.probe?.roce ?? null;
export const supCurrent = (e: Entity) => ly(e)?.currentRatio ?? e.pdf?.currentRatio ?? null;
export const supDebtEq = (e: Entity) => ly(e)?.debtToEquity ?? e.pdf?.debtToEquity ?? null;
export const supIntCov = (e: Entity) => ly(e)?.interestCoverage ?? e.pdf?.interestCoverage ?? null;
export const supRevChg = (e: Entity) => e.pdf?.revenueChangePct ?? null;

export type InsightTone = "opportunity" | "risk" | "watch";

export interface Insight {
  tone: InsightTone;
  icon: string; // emoji
  title: string; // short label
  detail: string; // one plain-English sentence with the actual numbers
}

const r0 = (n: number) => Math.round(n);

// Produce the list of levers / risks for one supplier.
export function supplierInsights(e: Entity): Insight[] {
  const out: Insight[] = [];
  const dso = supDSO(e);
  const dpo = supDPO(e);
  const ccc = supCCC(e);
  const ebitda = supEbitda(e);
  const cur = supCurrent(e);
  const de = supDebtEq(e);
  const ic = supIntCov(e);
  const revChg = supRevChg(e);
  const peerRecv = e.probe?.peerMedianReceivableDays ?? null;
  const first = fy(e);
  const last = ly(e);
  const years = e.profile?.years?.length ?? 0;

  /* ---------- OPPORTUNITIES — where we can push ---------- */

  // Payment-terms lever: they collect from customers fast → don't need us to pay fast.
  if (dso != null && dso <= 45) {
    out.push({
      tone: "opportunity",
      icon: "💸",
      title: "Room to extend our payment terms",
      detail: `Collects cash from its own customers in about ${r0(dso)} days, so its cash flow doesn't depend on us paying quickly — a strong case to negotiate longer payment terms with them.`,
    });
  } else if (peerRecv != null && dso != null && dso < peerRecv - 5) {
    out.push({
      tone: "opportunity",
      icon: "💸",
      title: "Collects faster than its peers",
      detail: `Gets paid in ~${r0(dso)} days versus the ~${r0(peerRecv)}-day peer norm — a healthier cash position than rivals, so there's room to push our payment terms out.`,
    });
  }

  // They already stretch their own suppliers → asking the same of them is credible.
  if (dpo != null && dpo >= 90 && dpo < 120) {
    out.push({
      tone: "opportunity",
      icon: "⏳",
      title: "They already stretch their suppliers",
      detail: `Takes around ${r0(dpo)} days to pay its own suppliers, so it's used to long terms — asking for the same treatment from them is realistic.`,
    });
  }

  // Fat margin → price lever.
  if (ebitda != null && ebitda >= 18) {
    out.push({
      tone: "opportunity",
      icon: "💰",
      title: "Fat margins — push on price",
      detail: `Runs a ${r0(ebitda)}% EBITDA margin and is comfortably profitable — there's cushion in their pricing to negotiate a better unit rate.`,
    });
  }

  // Margins widening over time → they keep the efficiency gains.
  if (first && last && first.ebitdaMarginPct != null && last.ebitdaMarginPct != null && last.ebitdaMarginPct - first.ebitdaMarginPct >= 4) {
    out.push({
      tone: "opportunity",
      icon: "📈",
      title: "Margins are widening",
      detail: `EBITDA margin climbed from ${r0(first.ebitdaMarginPct)}% to ${r0(last.ebitdaMarginPct)}% over ${years} years — they're keeping the efficiency gains, so it's a good moment to revisit our pricing.`,
    });
  }

  // Long cash cycle → cash-hungry → early-payment-for-discount play.
  if (ccc != null && ccc >= 60) {
    out.push({
      tone: "opportunity",
      icon: "🤝",
      title: "Offer early payment for a discount",
      detail: `A long ${r0(ccc)}-day cash-conversion cycle means working capital is tight for them — an "early payment for X% off" deal should land well.`,
    });
  }

  // Materials-heavy: the price they charge us moves with input / commodity costs,
  // so a fall in input prices is a concrete reason to reopen price.
  const rev = last?.revenueINR ?? e.financials.revenueINR ?? null;
  const materials = e.profile?.costStructure?.materialsINR ?? null;
  if (materials != null && rev != null && rev > 0) {
    const matPct = (materials / rev) * 100;
    if (matPct >= 65) {
      out.push({
        tone: "opportunity",
        icon: "🧪",
        title: "Input-cost pass-through",
        detail: `Raw materials are about ${r0(matPct)}% of its revenue, so the price it charges us tracks input costs closely — when commodity prices ease, push to have that saving passed through.`,
      });
    }
  }

  // Inventory-heavy: a lot of cash is locked up in stock, so a committed-volume /
  // faster-offtake deal in exchange for a better price is attractive to them.
  const inv = last?.inventoryINR ?? null;
  if (inv != null && rev != null && rev > 0) {
    const invDays = (inv / rev) * 365;
    if (invDays >= 90 && invDays <= 400) {
      out.push({
        tone: "opportunity",
        icon: "📦",
        title: "Carrying heavy stock",
        detail: `Holds roughly ${r0(invDays)} days of inventory (₹${r0(inv / 1e7)} Cr) — a lot of working capital tied up in stock, so a committed-volume or faster-offtake deal for a better price should land well.`,
      });
    }
  }

  /* ---------- RISKS — supply-continuity flags ---------- */

  if (cur != null && cur < 1) {
    out.push({
      tone: "risk",
      icon: "⚠️",
      title: "Liquidity looks tight",
      detail: `Current ratio of ${cur.toFixed(2)} (below 1) — short-term bills may outrun cash, a supply-continuity risk. Worth keeping a backup source.`,
    });
  }

  if ((de != null && de > 2) || (ic != null && ic < 2)) {
    const bits: string[] = [];
    if (de != null && de > 2) bits.push(`debt-to-equity of ${de.toFixed(1)}`);
    if (ic != null && ic < 2) bits.push(`interest cover of only ${ic.toFixed(1)}x`);
    out.push({
      tone: "risk",
      icon: "🏦",
      title: "Carrying heavy debt",
      detail: `${bits.join(" and ")} — financially stretched, which can dent reliability if credit tightens.`,
    });
  }

  if (revChg != null && revChg < -2) {
    out.push({
      tone: "risk",
      icon: "📉",
      title: "Revenue is shrinking",
      detail: `Sales fell ${Math.abs(r0(revChg))}% year-on-year — a shrinking supplier can signal trouble, so watch continuity and quality.`,
    });
  }

  if ((dpo != null && dpo >= 120) || e.pdf?.dpo?.flagged) {
    out.push({
      tone: "risk",
      icon: "🐌",
      title: "Pays its own suppliers very late",
      detail: `Stretches supplier payments past 120 days${e.pdf?.msme ? `, and is flagged for ${e.pdf.msme.count} late payments to small (MSME) vendors` : ""} — a sign of cash strain worth watching.`,
    });
  } else if (e.pdf?.msme) {
    out.push({
      tone: "risk",
      icon: "🚩",
      title: "Late paying its small vendors",
      detail: `Flagged for ${e.pdf.msme.count} delayed payments (₹${e.pdf.msme.amount}) to small suppliers. Indian law requires paying MSME (micro/small/medium) vendors within 45 days, so this is a working-capital-stress signal.`,
    });
  }

  /* ---------- WATCH ---------- */

  if (revChg != null && revChg > 25) {
    out.push({
      tone: "watch",
      icon: "🚀",
      title: "Scaling fast",
      detail: `Revenue up ${r0(revChg)}% year-on-year — strong momentum, but fast growers can raise prices or hit capacity limits, so lock in terms early.`,
    });
  }

  return out;
}

export const TONE_META: Record<InsightTone, { label: string; ring: string; bg: string; text: string; dot: string; emoji: string }> = {
  opportunity: { label: "Opportunity", ring: "ring-emerald-200", bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500", emoji: "💡" },
  risk: { label: "Risk", ring: "ring-rose-200", bg: "bg-rose-50", text: "text-rose-800", dot: "bg-rose-500", emoji: "🚩" },
  watch: { label: "Watch", ring: "ring-sky-200", bg: "bg-sky-50", text: "text-sky-800", dot: "bg-sky-500", emoji: "👀" },
};
