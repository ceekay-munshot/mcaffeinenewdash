// Money is stored in rupees; Indian business reads it in crore (1 Cr = 10,000,000).
export function toCrore(inr: number | null): number | null {
  if (inr == null) return null;
  return inr / 1e7;
}

export function fmtCrore(inr: number | null): string {
  const cr = toCrore(inr);
  if (cr == null) return "—";
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(2)}k Cr`;
  if (cr >= 100) return `₹${cr.toFixed(0)} Cr`;
  return `₹${cr.toFixed(1)} Cr`;
}

export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

export function fmtInt(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-IN");
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
