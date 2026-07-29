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

// Round "nice" axis ticks spanning [min,max] — gives a clean Y scale + gridlines.
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) { max = min + 1; min -= 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

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
          <div className="whitespace-nowrap pl-1 text-right font-mono font-semibold text-slate-900">{valueLabel(d.value)}</div>
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
  const [hi, setHi] = useState<number | null>(null);
  const vals = data.map((d) => d.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const lo = ticks[0], top = ticks[ticks.length - 1], range = top - lo || 1;
  const yPct = (v: number) => (1 - (v - lo) / range) * 100;
  const zeroPct = yPct(0);
  const showLbl = data.length <= 10;
  return (
    <div>
      <div className="flex" style={{ height }}>
        <div className="relative w-11 shrink-0">
          {ticks.map((t) => <span key={t} className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-slate-400" style={{ top: `${yPct(t)}%` }}>{valueLabel(t)}</span>)}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? "border-slate-300" : "border-slate-100"}`} style={{ top: `${yPct(t)}%` }} />)}
          <div className="absolute inset-0 flex items-stretch gap-1.5">
            {data.map((d, i) => {
              const hPct = (Math.abs(d.value) / range) * 100;
              const topPct = d.value >= 0 ? zeroPct - hPct : zeroPct;
              return (
                <div key={d.label} className="group relative flex-1" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
                  <div
                    className="anim-grow-y absolute inset-x-0 rounded-md transition-[filter] group-hover:brightness-95"
                    style={{ top: `${topPct}%`, height: `${Math.max(hPct, 1)}%`, background: `linear-gradient(180deg, ${lighten(d.color, "e6")}, ${d.color})`, transformOrigin: d.value >= 0 ? "bottom" : "top" }}
                  />
                  {showLbl && (
                    <div
                      className={`absolute inset-x-0 text-center text-[10px] font-semibold transition-opacity ${hi === i ? "opacity-0" : ""} ${d.value >= 0 ? "text-slate-600" : "text-white"}`}
                      style={d.value >= 0 ? { top: `calc(${topPct}% - 14px)` } : { top: `calc(${topPct}% + 3px)` }}
                    >
                      {valueLabel(d.value)}
                    </div>
                  )}
                  {hi === i && <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg">{d.label}: {valueLabel(d.value)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-11 flex gap-1.5">
        {data.map((d, i) => (<div key={d.label} className={`flex-1 truncate text-center text-[10px] ${hi === i ? "font-semibold text-slate-600" : "text-slate-400"}`}>{d.label}</div>))}
      </div>
    </div>
  );
}

/* ------------------------------------------------ Area / line (trends) */

// Shared line/area engine: real Y-axis (nice ticks + gridlines), X-axis labels,
// and a crosshair hover — moving the mouse anywhere over the plot snaps to the
// nearest point and shows a vertical guide + a tooltip listing every series'
// value at that year. Big hit target, so hovering always works.
function LineBase({ xLabels, series, valueLabel, height, area }: {
  xLabels: string[];
  series: { name: string; color: string; points: (number | null)[] }[];
  valueLabel: (v: number) => string;
  height: number;
  area?: boolean;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const n = xLabels.length;
  const allVals = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  if (!allVals.length) return <div className="py-10 text-center text-sm text-slate-400">No data for this metric.</div>;
  const ticks = niceTicks(Math.min(...allVals), Math.max(...allVals), 4);
  const lo = ticks[0], hiV = ticks[ticks.length - 1], range = hiV - lo || 1;
  const PAD = 5;
  const yPct = (v: number) => PAD + (1 - (v - lo) / range) * (100 - 2 * PAD);
  const xPct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const pathFor = (pts: (number | null)[]) => {
    let d = "", started = false;
    pts.forEach((v, i) => { if (v == null) return; d += `${started ? "L" : "M"}${xPct(i).toFixed(2)} ${yPct(v).toFixed(2)} `; started = true; });
    return d.trim();
  };
  const single = series.length === 1;
  const gid = "ag" + series[0].color.replace("#", "");
  const nonNull = series[0].points.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  const firstI = nonNull[0] ?? 0, lastI = nonNull[nonNull.length - 1] ?? n - 1;
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHi(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const leftAnchor = hi != null && hi < n / 2;
  return (
    <div>
      <div className="flex" style={{ height }}>
        <div className="relative w-11 shrink-0">
          {ticks.map((t) => <span key={t} className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-slate-400" style={{ top: `${yPct(t)}%` }}>{valueLabel(t)}</span>)}
        </div>
        <div className="relative flex-1" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${yPct(t)}%` }} />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {single && <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={series[0].color} stopOpacity="0.28" /><stop offset="100%" stopColor={series[0].color} stopOpacity="0.02" /></linearGradient></defs>}
            {area && single && <path d={`${pathFor(series[0].points)} L${xPct(lastI).toFixed(2)} 100 L${xPct(firstI).toFixed(2)} 100 Z`} fill={`url(#${gid})`} className="anim-fade" />}
            {series.map((s, si) => <path key={si} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className="anim-fade" />)}
          </svg>
          {hi != null && <div className="pointer-events-none absolute inset-y-0 w-px bg-slate-300" style={{ left: `${xPct(hi)}%` }} />}
          {hi != null && series.map((s, si) => { const v = s.points[hi]; return v == null ? null : <div key={si} className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${xPct(hi)}%`, top: `${yPct(v)}%`, background: s.color }} />; })}
          {hi != null && (
            <div className="pointer-events-none absolute top-1 z-30 rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-[11px] shadow-lg" style={leftAnchor ? { left: `${xPct(hi)}%`, marginLeft: 8 } : { right: `${100 - xPct(hi)}%`, marginRight: 8 }}>
              <div className="mb-0.5 font-semibold text-white">{xLabels[hi]}</div>
              {series.map((s, si) => { const v = s.points[hi]; return v == null ? null : (
                <div key={si} className="flex items-center gap-1.5 whitespace-nowrap">
                  {!single && <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />}
                  {!single && <span className="text-slate-300">{s.name}</span>}
                  <span className={`font-mono font-semibold text-white ${single ? "" : "ml-auto pl-2"}`}>{valueLabel(v)}</span>
                </div>
              ); })}
            </div>
          )}
        </div>
      </div>
      <div className="ml-11 flex">
        {xLabels.map((l, i) => <span key={i} className={`flex-1 truncate text-center text-[10px] ${hi === i ? "font-semibold text-slate-600" : "text-slate-400"}`}>{l}</span>)}
      </div>
      {!single && (
        <div className="ml-11 mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          {series.map((s) => <span key={s.name} className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
    </div>
  );
}

export function AreaLine({ data, color, valueLabel, height = 175, area = true }: {
  data: Slice[]; color: string; valueLabel: (v: number) => string; height?: number; area?: boolean;
}) {
  return <LineBase xLabels={data.map((d) => d.label)} series={[{ name: "", color, points: data.map((d) => d.value) }]} valueLabel={valueLabel} height={height} area={area} />;
}

/* ------------------------------------------ Multi-series line (compare) */
// Several entities overlaid on one time axis — the comparison-trend chart.
export function MultiLine({ xLabels, series, valueLabel, height = 300 }: {
  xLabels: string[];
  series: { name: string; color: string; points: (number | null)[] }[];
  valueLabel: (v: number) => string;
  height?: number;
}) {
  return <LineBase xLabels={xLabels} series={series} valueLabel={valueLabel} height={height} area={false} />;
}

/* ------------------------------------------------------------- Radar */
// Overlay several entities on the same 0–100 axes — the go-to "who's stronger
// where" comparison visual. Each series is a translucent polygon + outline.
export function Radar({ axes, series, size = 300 }: {
  axes: string[];
  series: { name: string; color: string; values: number[] }[];
  size?: number;
}) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 58;
  const N = axes.length || 1;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const pt = (i: number, r: number) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r] as const;
  const clamp = (v: number) => Math.max(0, Math.min(1, v / 100));
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, clamp(v)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} className="anim-pop mx-auto block h-auto w-full" style={{ maxWidth: size, overflow: "visible" }}>
        {rings.map((r, ri) => (
          <polygon key={ri} points={axes.map((_, i) => pt(i, r).join(",")).join(" ")} fill={ri === rings.length - 1 ? "#f8fafc" : "none"} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 1);
          const [lx, ly] = pt(i, 1.17);
          const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="9" fontWeight="600" fill="#64748b">{a}</text>
            </g>
          );
        })}
        {series.map((s, si) => (
          <polygon key={si} points={poly(s.values)} fill={`${s.color}22`} stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
        ))}
        {series.map((s, si) => s.values.map((v, i) => {
          const [x, y] = pt(i, clamp(v));
          return <circle key={`${si}-${i}`} cx={x} cy={y} r="2.6" fill={s.color} stroke="#fff" strokeWidth="1" />;
        }))}
      </svg>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------ Score bars (0–100 fitness) */
// Normalised "how healthy is this?" bars — each dimension scored 0–100 and
// coloured green/amber/red, with the real value shown. Turns a table of ratios
// into a shape you can read at a glance.
export function ScoreBars({ data }: { data: { label: string; score: number; value: string; hint?: string }[] }) {
  const color = (s: number) => (s >= 60 ? "#1baf7a" : s >= 40 ? "#eda100" : "#e34948");
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="group grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm" title={d.hint}>
          <div className="truncate text-slate-600">{d.label}</div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div className="anim-grow-x h-2.5 rounded-full" style={{ width: `${Math.max(3, Math.min(100, d.score))}%`, background: color(d.score) }} />
          </div>
          <div className="w-16 text-right font-mono text-xs font-semibold text-slate-700">{d.value}</div>
        </div>
      ))}
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
