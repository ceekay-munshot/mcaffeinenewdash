// Lightweight, dependency-free charts (simple + colorful, mcAFFEINE theme).
// A deliberate mix of easy-to-read forms — bars, donut, area, line, columns,
// stacked meter — so no two cards look the same. No scatter/bubble.
// Every chart has a styled hover tooltip and an entrance animation.
import { useState } from "react";
import { INK } from "./lib/palette";

export interface Slice {
  label: string;
  value: number;
  color: string;
  sub?: string;
}

const lighten = (hex: string, a = "cc") => `${hex}${a}`;

// styled hover tooltip (shows on hover of a `group` parent)
function Tip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity duration-150 group-hover:opacity-100 ${className}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Donut */

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
  const [hi, setHi] = useState(-1);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52, r = 33, C = 60;
  const gap = 0.014;
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
  const active = hi >= 0 ? data[hi] : null;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="anim-pop h-36 w-36 shrink-0">
        {arcs.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill={s.d.color}
            opacity={hi < 0 || hi === i ? 1 : 0.3}
            style={{ transition: "opacity .18s" }}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(-1)}
          />
        ))}
        <text x="60" y="57" textAnchor="middle" fontSize={active ? 15 : 21} fontWeight="800" fill={active ? active.color : INK.primary}>
          {active ? `${active.value}${unit}` : centerValue}
        </text>
        <text x="60" y="72" textAnchor="middle" fontSize="7.5" fill={INK.muted} style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
          {active ? active.label : centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(-1)}
            className={`flex cursor-default items-center gap-2 rounded-md px-1 text-sm transition ${hi === i ? "bg-slate-50" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{d.label}</span>
            <span className="font-mono font-semibold text-slate-900">{d.value}{unit}</span>
            <span className="w-9 text-right font-mono text-xs text-slate-400">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------- Horizontal bars */

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
    <div className="space-y-3">
      {data.map((d) => (
        <div
          key={d.label}
          onClick={onBar ? () => onBar(d.label) : undefined}
          className={`group relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm ${onBar ? "cursor-pointer" : ""}`}
        >
          <div className="min-w-0 group-hover:text-slate-900">
            <div className="truncate text-slate-600" title={d.label}>{d.label}</div>
            {d.sub && <div className="truncate text-[11px] text-slate-400">{d.sub}</div>}
          </div>
          <div className="h-3.5 rounded-full bg-slate-100">
            <div
              className="anim-grow-x h-3.5 rounded-full"
              style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: `linear-gradient(90deg, ${d.color}, ${lighten(d.color)})`, boxShadow: `0 1px 4px ${d.color}33` }}
            />
          </div>
          <div className="w-20 text-right font-mono font-semibold text-slate-900">{valueLabel(d.value)}</div>
          <Tip className="-top-7 left-[9.5rem]">{d.label}: {valueLabel(d.value)}</Tip>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------- Columns (time series, ± ) */

export function Columns({
  data,
  valueLabel,
  height = 150,
}: {
  data: Slice[];
  valueLabel: (v: number) => string;
  height?: number;
}) {
  const vals = data.map((d) => d.value);
  const top = Math.max(0, ...vals);
  const bottom = Math.min(0, ...vals);
  const range = top - bottom || 1;
  const zeroPct = (top / range) * 100;
  return (
    <div>
      <div className="relative" style={{ height }}>
        {bottom < 0 && <div className="absolute inset-x-0 border-t border-dashed border-slate-300" style={{ top: `${zeroPct}%` }} />}
        <div className="flex h-full items-stretch gap-1.5">
          {data.map((d) => {
            const hPct = (Math.abs(d.value) / range) * 100;
            const topPct = d.value >= 0 ? zeroPct - hPct : zeroPct;
            return (
              <div key={d.label} className="group relative flex-1">
                <div
                  className="anim-grow-y absolute inset-x-0 rounded-md transition-[filter] group-hover:brightness-95"
                  style={{ top: `${topPct}%`, height: `${Math.max(hPct, 1.5)}%`, background: `linear-gradient(180deg, ${lighten(d.color, "e6")}, ${d.color})`, transformOrigin: d.value >= 0 ? "bottom" : "top" }}
                />
                <div
                  className={`absolute inset-x-0 text-center text-[10px] font-semibold ${d.value >= 0 ? "text-slate-600" : "text-white"}`}
                  style={d.value >= 0 ? { top: `calc(${topPct}% - 14px)` } : { top: `calc(${topPct}% + 3px)` }}
                >
                  {valueLabel(d.value)}
                </div>
                <Tip className="bottom-full left-1/2 mb-1 -translate-x-1/2">{d.label}: {valueLabel(d.value)}</Tip>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d) => (<div key={d.label} className="flex-1 text-center text-[11px] text-slate-400">{d.label}</div>))}
      </div>
    </div>
  );
}

/* ------------------------------------------------ Area / line (trends) */

export function AreaLine({
  data,
  color,
  valueLabel,
  height = 175,
  area = true,
}: {
  data: Slice[];
  color: string;
  valueLabel: (v: number) => string;
  height?: number;
  area?: boolean;
}) {
  const n = data.length;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const PAD_T = 16, PAD_B = 8;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => PAD_T + (1 - (v - min) / range) * (100 - PAD_T - PAD_B);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(d.value).toFixed(2)}`).join(" ");
  const areaPath = `${line} L100 100 L0 100 Z`;
  const gid = "grad" + color.replace("#", "");
  const emphasize = new Set([0, n - 1, vals.indexOf(max)]);
  return (
    <div>
      <div className="relative" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.30" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {area && <path d={areaPath} fill={`url(#${gid})`} className="anim-fade" />}
          <path d={line} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className="anim-draw" />
        </svg>
        {data.map((d, i) => (
          <div key={i} className="group absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(i)}%`, top: `${y(d.value)}%` }}>
            <div className="h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-150" style={{ background: color }} />
            {emphasize.has(i) && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                {valueLabel(d.value)}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              {d.label}: {valueLabel(d.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between">
        {data.map((d, i) => (<span key={i} className="text-[11px] text-slate-400">{d.label}</span>))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- Stacked meter */

export function StackedMeter({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      <div className="anim-grow-x flex h-5 w-full origin-left gap-0.5 overflow-hidden rounded-full">
        {data.filter((d) => d.value > 0).map((d) => (
          <div key={d.label} className="group relative" style={{ width: `${(d.value / total) * 100}%`, background: `linear-gradient(90deg, ${d.color}, ${lighten(d.color)})` }}>
            <Tip className="-top-8 left-1/2 -translate-x-1/2">{d.label}: {d.value} ({Math.round((d.value / total) * 100)}%)</Tip>
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-slate-600">{d.label}</span>
            <span className="font-mono font-semibold text-slate-900">{d.value}</span>
            <span className="w-10 text-right font-mono text-xs text-slate-400">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------- primitives */

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

export function Card({ title, sub, children, className = "", accent }: { title: string; sub?: string; children: React.ReactNode; className?: string; accent?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 transition-shadow hover:shadow-md ${className}`}>
      <div className="mb-4 flex items-start gap-2">
        {accent && <span className="mt-1 h-3.5 w-1 shrink-0 rounded-full" style={{ background: accent }} />}
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {sub && <div className="text-xs text-slate-500">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
