// Lightweight, dependency-free charts (simple + colorful, mcAFFEINE theme).
// Only forms that are easy to read: horizontal bars and donuts. No scatter/bubble.
import { INK } from "./lib/palette";

export interface Slice {
  label: string;
  value: number;
  color: string;
  sub?: string;
}

// ---- Donut (part-to-whole) --------------------------------------------------

export function Donut({
  data,
  centerValue,
  centerLabel,
  unit = "",
}: {
  data: Slice[];
  centerValue: string;
  centerLabel: string;
  unit?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52, r = 34, C = 60; // viewBox 120
  const gap = 0.012; // 2px-ish gap between segments
  let a = -Math.PI / 2;
  const arcs = data.map((d) => {
    const frac = d.value / total;
    const start = a + gap * Math.PI;
    const end = a + frac * 2 * Math.PI - gap * Math.PI;
    a += frac * 2 * Math.PI;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => [C + rad * Math.cos(ang), C + rad * Math.sin(ang)];
    const [x1, y1] = p(start, R), [x2, y2] = p(end, R);
    const [x3, y3] = p(end, r), [x4, y4] = p(start, r);
    return { d, path: `M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4} Z` };
  });
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0">
        {arcs.map((s, i) => (
          <path key={i} d={s.path} fill={s.d.color}>
            <title>{`${s.d.label}: ${s.d.value}`}</title>
          </path>
        ))}
        <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill={INK.primary}>{centerValue}</text>
        <text x="60" y="72" textAnchor="middle" fontSize="8" fill={INK.muted} style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{centerLabel}</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{d.label}</span>
            <span className="font-mono font-medium text-slate-900">{d.value}{unit}</span>
            <span className="w-10 text-right font-mono text-xs text-slate-400">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Horizontal bars (magnitude, colored by identity) -----------------------

export function HBars({
  data,
  valueLabel,
  onBar,
}: {
  data: Slice[];
  valueLabel: (v: number) => string;
  onBar?: (label: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div
          key={d.label}
          onClick={onBar ? () => onBar(d.label) : undefined}
          className={`grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm ${onBar ? "cursor-pointer rounded-md hover:bg-slate-50" : ""}`}
        >
          <div className="truncate text-slate-600" title={d.label}>{d.label}</div>
          <div className="h-5 rounded-md bg-slate-100">
            <div
              className="h-5 rounded-md transition-all"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: d.color }}
              title={`${d.label}: ${valueLabel(d.value)}`}
            />
          </div>
          <div className="w-20 text-right font-mono font-medium text-slate-900">{valueLabel(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
      {children}
    </div>
  );
}
