import type { Entity } from "../types";

// "Negotiation room" — a first-cut, transparent heuristic that answers the
// client's core P0 question: "where do I send my negotiators?"
//
// Logic: the fatter a supplier's EBITDA margin, the more profit they are making
// (partly off us) — so the more room there is to push on price/terms. This is a
// signal, not a verdict; it gets sharper once Probe42 adds receivable days & RoCE.
export type Room = "High" | "Medium" | "Low" | "Unknown";

export function negotiationRoom(e: Entity): Room {
  // Prefer the thin base margin, but fall back to the latest year of the rich
  // Tracxn PDF profile so suppliers with only PDF statements still get scored.
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
