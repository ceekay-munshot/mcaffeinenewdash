import type { Entity } from "../types";

// "Negotiation room" — a first-cut, transparent heuristic that answers the
// client's core P0 question: "where do I send my negotiators?"
//
// Logic: the fatter a supplier's EBITDA margin, the more profit they are making
// (partly off us) — so the more room there is to push on price/terms. This is a
// signal, not a verdict; it gets sharper once Probe42 adds receivable days & RoCE.
export type Room = "High" | "Medium" | "Low" | "Unknown";

export function negotiationRoom(e: Entity): Room {
  const m = e.financials.ebitdaMarginPct;
  if (m == null) return "Unknown";
  if (m >= 20) return "High";
  if (m >= 10) return "Medium";
  return "Low";
}

export const ROOM_META: Record<Room, { label: string; cls: string; dot: string }> = {
  High: { label: "High", cls: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30", dot: "bg-emerald-400" },
  Medium: { label: "Medium", cls: "text-amber-300 bg-amber-500/10 ring-amber-500/30", dot: "bg-amber-400" },
  Low: { label: "Low", cls: "text-sky-300 bg-sky-500/10 ring-sky-500/30", dot: "bg-sky-400" },
  Unknown: { label: "—", cls: "text-slate-400 bg-slate-500/10 ring-slate-500/20", dot: "bg-slate-500" },
};

export const COVERAGE_META: Record<Entity["coverage"], { label: string; cls: string }> = {
  full: { label: "Full", cls: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30" },
  partial: { label: "Partial", cls: "text-amber-300 bg-amber-500/10 ring-amber-500/30" },
  not_found: { label: "Not found", cls: "text-rose-300 bg-rose-500/10 ring-rose-500/30" },
};
