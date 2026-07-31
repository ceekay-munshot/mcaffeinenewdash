import type { Entity } from "../types";

// "Negotiation room" — a first-cut, transparent heuristic that answers the
// client's core P0 question: "where do I send my negotiators?"
//
// Logic: the fatter a supplier's EBITDA margin, the more profit they are making
// (partly off us) — so the more room there is to push on price/terms. This is a
// signal, not a verdict; it gets sharper once Probe42 adds receivable days & RoCE.
export type Room = "High" | "Medium" | "Low" | "Unknown";

export function negotiationRoom(e: Entity): Room {
  // Use the brand's own base margin first; fall back to the latest year of the
  // Tracxn PDF profile only when the base is missing (so brands with only PDF
  // statements still get scored, without a linked parent's numbers overriding
  // the brand's own).
  const ys = e.profile?.years;
  const py = ys && ys.length ? ys[ys.length - 1] : null;
  const m = e.financials.ebitdaMarginPct ?? py?.ebitdaMarginPct ?? null;
  if (m == null) return "Unknown";
  if (m >= 20) return "High";
  if (m >= 10) return "Medium";
  return "Low";
}

export const ROOM_META: Record<Room, { label: string; cls: string; dot: string }> = {
  High: { label: "High", cls: "text-emerald-700 bg-emerald-50 ring-emerald-200", dot: "bg-emerald-500" },
  Medium: { label: "Medium", cls: "text-amber-700 bg-amber-50 ring-amber-200", dot: "bg-amber-500" },
  Low: { label: "Low", cls: "text-sky-700 bg-sky-50 ring-sky-200", dot: "bg-sky-500" },
  Unknown: { label: "—", cls: "text-slate-500 bg-slate-50 ring-slate-200", dot: "bg-slate-300" },
};

export const COVERAGE_META: Record<Entity["coverage"], { label: string; cls: string }> = {
  full: { label: "Full", cls: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
  partial: { label: "Partial", cls: "text-amber-700 bg-amber-50 ring-amber-200" },
  not_found: { label: "Not found", cls: "text-rose-700 bg-rose-50 ring-rose-200" },
};

/* ---- health-score bands ----------------------------------------------------
   One set of cut-offs for the whole dashboard. Six screens had grown their own
   copy at 65/50 while the Overview banded at 55/45, so a supplier scoring 58
   read "Strong" green on the landing page and amber on the next one. The score's
   own neutral baseline is 50, which is what 55/45 is anchored to. Lives here
   rather than in App.tsx because DeepDive needs it too, and DeepDive is imported
   by App — the other direction is a cycle. */
export const HEALTH_CUT = { strong: 55, ok: 45 } as const;

export const healthChip = (h: number) =>
  h >= HEALTH_CUT.strong ? "bg-emerald-100 text-emerald-700"
    : h >= HEALTH_CUT.ok ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";

export const healthDot = (h: number) =>
  h >= HEALTH_CUT.strong ? "bg-emerald-500" : h >= HEALTH_CUT.ok ? "bg-amber-500" : "bg-rose-500";
