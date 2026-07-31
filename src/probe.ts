/* Single source of truth for a supplier's headline financials.
 *
 * The dashboard carries two lineages. Probe42 pulls the company's own MCA
 * filings — standalone, audited, the legal entity we actually contract with.
 * Tracxn's profile carries whatever the company published, which for a listed
 * group is usually the CONSOLIDATED number covering overseas subsidiaries.
 *
 * Both are true, and both were on screen: the supplier board read Tracxn while
 * the deep-dive read Probe, so EPL showed ₹4,257 Cr on the board and ₹1,323 Cr
 * on its own page — the same company, adjacent screens, 3.2× apart. Eighteen of
 * the twenty-four enriched suppliers disagreed on at least one headline metric,
 * payment days worst of all (Pragati: 220 days on the board, 75 on its profile,
 * because the two sources divide by different denominators).
 *
 * So: where we hold a Probe42 report, that is the number, everywhere. Tracxn
 * still covers the suppliers we never pulled a report for.
 *
 * Everything here returns the same unit as the Entity field it stands in for —
 * revenue in rupees, margins in percent, days in days. */
import DETAIL from "@data/clean/probe-detail.json";
import type { Entity } from "./types";

interface Latest {
  revenue: number | null; ebitdaMargin: number | null; netMargin: number | null; roce: number | null;
  debtorDays: number | null; payableDays: number | null; cashConversion: number | null;
  currentRatio: number | null; debtEquity: number | null; interestCover: number | null;
}
const D = DETAIL as unknown as Record<string, { latest: Latest }>;

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The latest filed year from the Probe42 report, or null if we hold no report. */
export function probeLatest(e: Entity): Latest | null {
  return (e.cin && D[e.cin]?.latest) || null;
}

/** Probe stores ₹ crore; the Entity financials are in rupees. */
const toINR = (cr: number | null) => (cr == null ? null : cr * 1e7);

/** Revenue in rupees, Probe first. A filed zero is a real filing, not a gap. */
export const probeRevenueINR = (e: Entity) => toINR(n(probeLatest(e)?.revenue));
export const probeEbitdaMargin = (e: Entity) => n(probeLatest(e)?.ebitdaMargin);
export const probeNetMargin = (e: Entity) => n(probeLatest(e)?.netMargin);
export const probeRoce = (e: Entity) => n(probeLatest(e)?.roce);
export const probeDSO = (e: Entity) => n(probeLatest(e)?.debtorDays);
export const probeDPO = (e: Entity) => n(probeLatest(e)?.payableDays);
export const probeCCC = (e: Entity) => n(probeLatest(e)?.cashConversion);
export const probeCurrentRatio = (e: Entity) => n(probeLatest(e)?.currentRatio);
export const probeDebtEquity = (e: Entity) => n(probeLatest(e)?.debtEquity);
export const probeIntCover = (e: Entity) => n(probeLatest(e)?.interestCover);

/** The financial year the Probe figures belong to, for labelling a mixed table. */
export function probeYear(e: Entity): string | null {
  const d = e.cin ? (D[e.cin] as unknown as { latest?: { year?: string } }) : null;
  return d?.latest?.year ?? null;
}
