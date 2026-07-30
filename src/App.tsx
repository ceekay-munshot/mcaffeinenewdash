import { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA,
  supplyEntities,
  competitorRows,
  COMPETITOR_CATEGORIES,
  type Entity,
  type CompetitorRow,
  type ResearchData,
} from "./types";
import { fmtCrore, fmtPct, fmtInt, fmtDate, fmtDays, fmtUSD, toCrore, fullName } from "./lib/format";
import { negotiationRoom } from "./lib/health";
import { CATEGORY_COLOR } from "./lib/palette";
import { HBars, Columns, AreaLine, ScoreBars, MultiLine, Card, TBL, THEAD, TDNUM, type Slice } from "./charts";
import { DELIVERY } from "./delivery";
import { RM_SUPPLY, PM_SUPPLY, suppliedItems } from "./supply";
import { newsOf, type SupplierNews, type Signal, type NewsItem } from "./news";
import { allMarket, marketOf, marketOfFolder, pmCategoryOf, CONC_META, LEV_META, type MarketEntry, type Concentration } from "./market";
import {
  supplierInsights, TONE_META, type Insight, type InsightTone,
  supDSO, supDPO, supRoce, supCurrent, supDebtEq, supIntCov,
} from "./lib/insights";
import DeepDive, { hasDeepDive, probeLevers, supplierHealth, ProbeCompare, enrichedCount } from "./DeepDive";

/* -------------------------------------------------- data accessors / helpers */

function latestYear(e: Entity) {
  const ys = e.profile?.years;
  return ys && ys.length ? ys[ys.length - 1] : null;
}

const isParentBackedProfile = (e: Entity) => {
  const prof = latestYear(e)?.revenueINR;
  if (prof == null) return false;
  const base = e.financials.revenueINR;
  if (base != null && base > 0) return prof > base * 1.5;
  return (e.profile?.subsidiaries?.length ?? 0) >= 5;
};

const profRevOf = (e: Entity) => (isParentBackedProfile(e) ? null : latestYear(e)?.revenueINR ?? null);
const revOf = (e: Entity) => {
  const b = e.financials.revenueINR;
  return b != null && b > 0 ? b : profRevOf(e);
};
const ebitdaMarginOf = (e: Entity) =>
  e.financials.ebitdaMarginPct ?? (isParentBackedProfile(e) ? null : latestYear(e)?.ebitdaMarginPct) ?? null;
const netMarginOf = (e: Entity) =>
  e.financials.netMarginPct ?? (isParentBackedProfile(e) ? null : latestYear(e)?.netMarginPct) ?? null;

function useProfileNav<T>(selected: T | null, setSelected: (v: T | null) => void) {
  const listScroll = useRef(0);
  useEffect(() => {
    if (selected == null) window.scrollTo(0, listScroll.current);
  }, [selected]);
  const open = (v: T) => { listScroll.current = window.scrollY; setSelected(v); };
  const back = () => setSelected(null);
  return { open, back };
}

const crStr = (cr: number) => `₹${cr >= 1000 ? (cr / 1000).toFixed(1) + "k" : cr.toFixed(0)} Cr`;

const CAT_META: Record<string, { emoji: string; color: string }> = {
  "RM Vendor": { emoji: "🧪", color: CATEGORY_COLOR["RM Vendor"] },
  "PM Vendor": { emoji: "📦", color: CATEGORY_COLOR["PM Vendor"] },
  Manufacturer: { emoji: "🏭", color: CATEGORY_COLOR.Manufacturer },
};
const catEmoji = (cat: string) => CAT_META[cat]?.emoji ?? "🏢";

/* --------------------------------------------------------------------- shell */

type Module = "suppliers" | "competitors" | "delivery";
const MODULES: { key: Module; label: string; emoji: string; locked?: boolean }[] = [
  { key: "suppliers", label: "Suppliers", emoji: "🏭" },
  { key: "competitors", label: "Competitors", emoji: "🥊", locked: true },
  { key: "delivery", label: "Delivery", emoji: "🚚", locked: true },
];

export default function App() {
  const [module, setModule] = useState<Module>("suppliers");
  // Competitors & Delivery are locked for now — only ever show Suppliers.
  const active = MODULES.find((m) => m.key === module)?.locked ? "suppliers" : module;
  return (
    <div className="min-h-screen overflow-x-clip bg-[#f6f4ef] text-slate-800">
      <Header module={active} setModule={setModule} generatedAt={DATA.generatedAt} />
      {active === "suppliers" && <SupplierView />}
      {active === "competitors" && <CompetitorView />}
      {active === "delivery" && <DeliveryView />}
    </div>
  );
}

function Header({ module, setModule, generatedAt }: { module: Module; setModule: (m: Module) => void; generatedAt: string }) {
  return (
    <header className="sticky top-0 z-30 bg-gradient-to-r from-[#0b3b39] via-[#0d9488] to-[#0891b2] shadow-md">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-y-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-xl ring-1 ring-white/25">☕</div>
          <div>
            <div className="flex items-baseline">
              <span className="text-xl font-extrabold lowercase tracking-tight text-white">mc</span>
              <span className="text-xl font-extrabold uppercase tracking-tight text-white">AFFEINE</span>
              <span className="ml-1 self-start text-[10px] font-bold text-teal-100">®</span>
            </div>
            <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-teal-100/90">Supplier Intelligence</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex flex-wrap justify-end gap-1 rounded-2xl bg-black/15 p-1 ring-1 ring-white/15">
            {MODULES.map((m) => m.locked ? (
              <button key={m.key} type="button" aria-disabled="true"
                aria-label={`${m.label} — coming soon, locked while we focus on Suppliers`}
                title="Coming soon — locked while we focus on Suppliers"
                onClick={(e) => e.preventDefault()}
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-white/40 sm:px-3.5">
                <span className="opacity-60" aria-hidden="true">{m.emoji}</span>{m.label}<span className="text-[11px]" aria-hidden="true">🔒</span>
              </button>
            ) : (
              <button key={m.key} onClick={() => setModule(m.key)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold transition sm:px-3.5 ${module === m.key ? "bg-white text-[#0b3b39] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
                <span aria-hidden="true">{m.emoji}</span>{m.label}
              </button>
            ))}
          </nav>
          <div className="hidden text-right text-[11px] leading-tight text-teal-100/80 sm:block">
            <div className="uppercase tracking-wide">Data snapshot</div>
            <div className="font-mono text-white/90">{fmtDate(generatedAt)}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------ reusable UI pieces */

// Slim hero: title + one-line subtitle, and the headline figures inlined as a
// single muted stat row instead of a wall of boxed KPI tiles.
function ModuleHero({ emoji, title, subtitle, stats, tint }: {
  emoji: string; title: string; subtitle: string; tint: string; stats: { label: string; value: string }[];
}) {
  return (
    <section className={`mt-6 overflow-hidden rounded-3xl bg-gradient-to-r ${tint} px-5 py-4 text-white shadow-sm`}>
      <div className="flex items-center gap-2 text-lg font-bold"><span className="text-2xl">{emoji}</span>{title}</div>
      <div className="mt-0.5 text-sm text-white/75">{subtitle}</div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
        {stats.map((s) => (
          <span key={s.label} className="inline-flex items-baseline gap-1.5">
            <span className="text-lg font-bold tabular-nums leading-none">{s.value}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/65">{s.label}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; emoji: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${value === t.key ? "bg-white text-teal-700 shadow-sm ring-1 ring-teal-200" : "text-slate-500 hover:text-slate-800"}`}>
          <span>{t.emoji}</span>{t.label}
        </button>
      ))}
    </div>
  );
}

// A labelled dropdown — replaces rows of toggle chips so the chart controls stay compact.
function Dropdown<T extends string>({ value, onChange, options, label }: { value: T; onChange: (t: T) => void; options: { key: T; label: string; emoji?: string }[]; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      {label && <span className="text-slate-500">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400">
        {options.map((o) => <option key={o.key} value={o.key}>{o.emoji ? `${o.emoji} ` : ""}{o.label}</option>)}
      </select>
    </label>
  );
}

// Progressive disclosure — collapses a block of reference cards behind one toggle
// so a dense page opens focused but loses nothing. Closed, it names what's inside.
function Expander({ count, hint, children }: { count: number; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-300">
        <span className="min-w-0">
          <span className="text-sm font-semibold text-slate-700">{open ? "Hide" : "Show"} full company detail</span>
          <span className="text-sm text-slate-400"> · {count} sections</span>
          {!open && hint && <span className="mt-0.5 line-clamp-1 text-xs text-slate-400">{hint}</span>}
        </span>
        <span className="shrink-0 text-teal-600" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}


// Compact, visual take on the levers — tone-grouped chips instead of a wall of
// sentence cards. The full one-liner lives in the hover title, so the page stays
// scannable but the detail is one hover away.
function LeverStrip({ ins }: { ins: Insight[] }) {
  const groups = (["opportunity", "risk", "watch"] as InsightTone[])
    .map((t) => ({ t, items: ins.filter((i) => i.tone === t) }))
    .filter((g) => g.items.length);
  return (
    <div className="space-y-3">
      {groups.map(({ t, items }) => {
        const m = TONE_META[t];
        return (
          <div key={t}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span className={`h-2 w-2 rounded-full ${m.dot}`} />{m.emoji} {m.label}<span className="text-slate-400">· {items.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((i, idx) => (
                <span key={idx} title={i.detail} className={`inline-flex cursor-default items-center gap-1.5 rounded-lg ${m.bg} px-2.5 py-1.5 text-sm font-medium ${m.text} ring-1 ${m.ring}`}>
                  <span className="text-base leading-none">{i.icon}</span>{i.title}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------- interactive charts: one chart, many metrics (merged) ------- */

type TrendMetric = { key: string; label: string; emoji: string; kind: "area" | "columns"; color: string; unit: (v: number) => string; slices: Slice[] };

type TrendMetric2 = TrendMetric & { unitWord?: string };

function MetricTrend({ metrics, height = 250 }: { metrics: TrendMetric2[]; height?: number }) {
  const [k, setK] = useState(metrics[0].key);
  const m = metrics.find((x) => x.key === k) ?? metrics[0];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Dropdown label="Show" value={k} onChange={setK} options={metrics.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} />
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">by fiscal year{m.unitWord ? ` · ${m.unitWord}` : ""} · hover a point for the value</span>
      </div>
      {m.kind === "area"
        ? <AreaLine data={m.slices} color={m.color} valueLabel={m.unit} height={height} />
        : <Columns data={m.slices} valueLabel={m.unit} height={height} />}
    </div>
  );
}

type RankMetric = { key: string; label: string; emoji: string; unit: (v: number) => string; note?: string; rows: Slice[] };

function MetricRank({ metrics, onBar }: { metrics: RankMetric[]; onBar?: (l: string) => void }) {
  const [k, setK] = useState(metrics[0].key);
  const m = metrics.find((x) => x.key === k) ?? metrics[0];
  return (
    <div>
      <div className="mb-3"><Dropdown label="Rank by" value={k} onChange={setK} options={metrics.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} /></div>
      {m.note && <div className="mb-3 text-xs text-slate-500">{m.note}</div>}
      {m.rows.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No data for this metric yet.</div> : <HBars data={m.rows} valueLabel={m.unit} onBar={onBar} />}
    </div>
  );
}

// Peer comparison — this vendor against everyone else in its own category, on a
// chosen metric. Answers a negotiator's question: "is this vendor richer / leaner /
// slower-collecting than the pack?" Uses the real financials we hold, not just names.
const PEER_METRICS: { key: string; label: string; emoji: string; get: (e: Entity) => number | null; unit: (v: number) => string; higherBetter: boolean; note: string }[] = [
  { key: "revenue", label: "Revenue", emoji: "💵", get: (e) => toCrore(revOf(e)), unit: crStr, higherBetter: true, note: "Latest disclosed revenue, ₹ crore — where this vendor sits on scale." },
  { key: "ebitda", label: "EBITDA margin", emoji: "💰", get: ebitdaMarginOf, unit: (v) => `${Math.round(v)}%`, higherBetter: true, note: "Profitability — a fatter margin than peers means more pricing cushion to negotiate." },
  { key: "net", label: "Net margin", emoji: "📊", get: netMarginOf, unit: (v) => `${Math.round(v)}%`, higherBetter: true, note: "Bottom-line margin vs the category." },
  { key: "roce", label: "RoCE", emoji: "⚙️", get: supRoce, unit: (v) => `${Math.round(v)}%`, higherBetter: true, note: "Return on capital employed vs peers." },
  { key: "dso", label: "Collection days", emoji: "⏱️", get: supDSO, unit: (v) => `${Math.round(v)} d`, higherBetter: false, note: "Days to collect from customers — fewer than peers means a healthier cash position." },
];

function PeerCompareCard({ e }: { e: Entity }) {
  const avail = useMemo(
    () => PEER_METRICS.filter((mm) => mm.get(e) != null && DATA.entities.filter((p) => p.category === e.category && mm.get(p) != null).length >= 3),
    [e],
  );
  const [k, setK] = useState(avail[0]?.key ?? "revenue");
  if (avail.length === 0) return null;
  const m = avail.find((x) => x.key === k) ?? avail[0];

  const withVal = DATA.entities
    .filter((p) => p.category === e.category && m.get(p) != null)
    .map((p) => ({ p, v: m.get(p)! }))
    .sort((a, b) => (m.higherBetter ? b.v - a.v : a.v - b.v));

  const rankIdx = withVal.findIndex((x) => x.p.folder === e.folder);
  const total = withVal.length;
  const sortedVals = withVal.map((x) => x.v).sort((a, b) => a - b);
  const median = sortedVals[Math.floor((sortedVals.length - 1) / 2)];
  const selfVal = m.get(e)!;

  // Show the leaders, but always keep this vendor visible even if it ranks low.
  const TOP = 7;
  let shown = withVal.slice(0, TOP);
  if (rankIdx >= TOP) shown = [...withVal.slice(0, TOP - 1), withVal[rankIdx]];
  const bars: Slice[] = shown.map(({ p, v }) => ({
    label: p.brand,
    value: v,
    color: p.folder === e.folder ? "#0d9488" : "#cbd5e1",
    sub: p.folder === e.folder ? "this vendor" : undefined,
  }));

  const better = m.higherBetter ? selfVal >= median : selfVal <= median;
  const cmpWord = m.higherBetter ? (better ? "above" : "below") : better ? "better than" : "worse than";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Dropdown label="Compare on" value={k} onChange={setK} options={avail.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} />
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">vs {e.category} peers</span>
      </div>
      <div className="mb-3 text-xs text-slate-500">{m.note}</div>
      <div className={`mb-4 rounded-xl px-3 py-2 text-sm ring-1 ${better ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
        <span className="font-semibold">{e.brand}</span> ranks <span className="font-semibold">#{rankIdx + 1} of {total}</span> in {e.category} on {m.label.toLowerCase()} — {m.unit(selfVal)}, {cmpWord} the category median of {m.unit(median)}.
      </div>
      <HBars data={bars} valueLabel={m.unit} />
    </div>
  );
}

// Multi-year metrics for one company, from its Tracxn profile.
function buildTrendMetrics(e: Entity): TrendMetric[] {
  const ys = e.profile?.years ? [...e.profile.years].sort((a, b) => a.fy.localeCompare(b.fy)) : [];
  if (ys.length < 2) return [];
  const s = (fy: string) => "'" + (fy.split("-")[1] ?? fy);
  const cr = (v: number | null) => Math.round((v ?? 0) / 1e7);
  const out: TrendMetric2[] = [];
  out.push({ key: "revenue", label: "Revenue", emoji: "💵", kind: "area", color: "#0d9488", unitWord: "₹ crore", unit: (v) => `₹${v.toLocaleString("en-IN")} Cr`, slices: ys.map((y) => ({ label: s(y.fy), value: cr(y.revenueINR), color: "#0d9488" })) });
  if (ys.some((y) => y.netProfitINR != null)) out.push({ key: "profit", label: "Net profit", emoji: "📈", kind: "columns", color: "#1baf7a", unitWord: "₹ crore", unit: (v) => `₹${v.toLocaleString("en-IN")} Cr`, slices: ys.map((y) => ({ label: s(y.fy), value: cr(y.netProfitINR), color: (y.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) });
  if (ys.some((y) => y.ebitdaMarginPct != null)) out.push({ key: "ebitda", label: "EBITDA margin", emoji: "💰", kind: "area", color: "#eda100", unitWord: "% of revenue", unit: (v) => `${v}%`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.ebitdaMarginPct ?? 0), color: "#eda100" })) });
  if (ys.some((y) => y.rocePct != null)) out.push({ key: "roce", label: "Return on capital", emoji: "⚙️", kind: "area", color: "#4a3aa7", unitWord: "%", unit: (v) => `${v}%`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.rocePct ?? 0), color: "#4a3aa7" })) });
  if (ys.some((y) => y.receivableDays != null)) out.push({ key: "dso", label: "Collection days", emoji: "📥", kind: "area", color: "#2a78d6", unitWord: "days to collect", unit: (v) => `${Math.round(v)} days`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.receivableDays ?? 0), color: "#2a78d6" })) });
  return out;
}

/* --------------------------------------------------------- P0 Supplier view */

type SupTab = "board" | "market" | "supply" | "rates" | "news";
const SUP_TABS: { key: SupTab; label: string; emoji: string }[] = [
  { key: "board", label: "Suppliers", emoji: "🏭" },
  { key: "market", label: "Ingredients", emoji: "🧪" },
  { key: "supply", label: "Supply chain", emoji: "🧬" },
  { key: "rates", label: "Rate benchmark", emoji: "💰" },
  { key: "news", label: "Newsroom", emoji: "📰" },
];

/* ---- L3 · mcAFFEINE's own rates vs the market band + the supplier's room ----
   The buyer types one number per line they buy — nothing else. Each rate is
   checked against (a) the open-market band we hold for that material and (b) the
   supplier's own financial room, so the output is both "you're overpaying" and
   "here's the leverage to fix it". Ships pre-filled for the demo. */
type L3Line = { item: string; supplier: string; rate: number; qtyKg: number };
const L3_LINES: L3Line[] = [
  { item: "Uvinul MC 80", supplier: "ValueTree", rate: 780, qtyKg: 4000 },
  { item: "Cetiol C5", supplier: "Northern Aromatics", rate: 1650, qtyKg: 5000 },
  { item: "Tinosorb A2B", supplier: "Yasham", rate: 3400, qtyKg: 800 },
  { item: "Cosroma EAA", supplier: "Ark Chemicals", rate: 17500, qtyKg: 400 },
  { item: "Repoly 100", supplier: "Caldic", rate: 300, qtyKg: 12000 },
  { item: "Niacinamide", supplier: "nirmaancosmetic", rate: 950, qtyKg: 3000 },
];
function l3Band(s?: string): { min: number; max: number; mid: number } | null {
  if (!s || /not found/i.test(s)) return null;
  const nums = (s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  return { min, max, mid: Math.round((min + max) / 2) };
}
const l3Norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const l3Money = (rs: number) => (rs >= 1e7 ? `₹${(rs / 1e7).toFixed(2)} Cr` : `₹${(rs / 1e5).toFixed(1)} L`);

// The steps the progress panel walks through. Purely presentational, but each
// line names something the engine genuinely does, so the wait explains itself.
const L3_STEPS = [
  "Reading your rate card…",
  "Matching each material to its open-market band…",
  "Pulling each supplier's latest filed financials…",
  "Scoring the room in their margins, cash and terms…",
  "Costing the gap against your annual volume…",
];

function L3RateBench({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [lines, setLines] = useState<L3Line[]>(L3_LINES);
  const [phase, setPhase] = useState<"input" | "running" | "done">("input");
  const [step, setStep] = useState(0);
  const [leversFor, setLeversFor] = useState<Entity | null>(null);
  const items = useMemo(() => allMarket(), []);

  // Walk the progress steps, then reveal. Cleaned up on unmount so a mid-run
  // navigation can't leave timers firing into a dead component.
  useEffect(() => {
    if (phase !== "running") return;
    const per = 1200;
    const timers = L3_STEPS.map((_, i) => window.setTimeout(() => setStep(i), i * per));
    const done = window.setTimeout(() => setPhase("done"), L3_STEPS.length * per + 600);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [phase]);

  const setRate = (i: number, v: number) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, rate: Math.max(0, Math.round(v)) } : l)));

  const rows = useMemo(() => lines.map((l) => {
    const mk = marketOf(l.item)
      || items.find((m) => l3Norm(m.item) === l3Norm(l.item))
      || items.find((m) => l.item && (l3Norm(m.item).includes(l3Norm(l.item)) || l3Norm(l.item).includes(l3Norm(m.item))));
    const band = l3Band(mk?.priceINRPerKg);
    const ent = all.find((e) => l3Norm(e.brand) === l3Norm(l.supplier) || (e.folder || "").toLowerCase() === l.supplier.toLowerCase())
      || all.find((e) => l3Norm(e.brand).includes(l3Norm(l.supplier)) || l3Norm(l.supplier).includes(l3Norm(e.brand)) || (!!e.legalName && l3Norm(e.legalName).includes(l3Norm(l.supplier))));
    const health = ent ? supplierHealth(ent.cin) : null;
    const gap = band ? l.rate - band.mid : null;         // +ve = above the market midpoint
    const savingRs = gap != null && gap > 0 ? gap * l.qtyKg : 0;
    return { ...l, band, ent, health, gap, savingRs };
  }), [lines, all, items]);

  const totalRs = rows.reduce((s, r) => s + r.savingRs, 0);
  const priced = rows.filter((r) => r.band);
  const overCount = priced.filter((r) => (r.gap ?? 0) > 0).length;
  const month = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const hdot = (h: number) => (h >= 65 ? "bg-emerald-100 text-emerald-700" : h >= 50 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700");

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-gradient-to-br from-[#0b3b39] via-[#0d9488] to-[#0891b2] p-5 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xl font-bold">💰 Rate benchmark</div>
            <div className="mt-1 max-w-2xl text-sm text-white/80">Enter what you pay per kg. We check it against the open market <em>and</em> that supplier's own financials.</div>
          </div>
          {phase === "done" && (
            <div className="shrink-0 rounded-2xl bg-white/12 px-5 py-3 text-right ring-1 ring-white/25">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-50">Potential annual saving</div>
              <div className="text-3xl font-bold tabular-nums">{l3Money(totalRs)}</div>
              <div className="text-xs text-white/75">{overCount} of {priced.length} lines above market · as of {month}</div>
            </div>
          )}
        </div>
      </div>

      {/* ---- rate card: one row per material, a stepper on each ---- */}
      <Card title="Your rate card" sub="tap − / + to adjust by ₹10, or type the rate directly" accent="#0891b2">
        <div className="grid gap-2.5 md:grid-cols-2">
          {lines.map((l, i) => (
            <div key={l.item} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-slate-900" title={l.item}>{l.item}</div>
                <div className="truncate text-xs text-slate-500">{l.supplier} · {l.qtyKg.toLocaleString("en-IN")} kg/yr</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button onClick={() => setRate(i, l.rate - 10)} aria-label={`Reduce ${l.item} by 10`}
                  className="h-9 w-9 rounded-lg bg-white text-lg font-bold text-slate-600 ring-1 ring-slate-300 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-300">−</button>
                <div className="flex items-center rounded-lg bg-white px-2 ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-teal-400">
                  <span className="text-sm text-slate-400">₹</span>
                  <input type="number" value={l.rate} onChange={(e) => setRate(i, Number(e.target.value))}
                    className="w-20 bg-transparent py-1.5 text-right text-[15px] font-bold tabular-nums text-slate-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="pl-1 text-xs text-slate-400">/kg</span>
                </div>
                <button onClick={() => setRate(i, l.rate + 10)} aria-label={`Increase ${l.item} by 10`}
                  className="h-9 w-9 rounded-lg bg-white text-lg font-bold text-slate-600 ring-1 ring-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600 hover:ring-emerald-300">+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => { setStep(0); setPhase("running"); }} disabled={phase === "running"}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-[15px] font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60">
            {phase === "running" ? "Calculating…" : phase === "done" ? "↻ Recalculate" : "Calculate savings →"}
          </button>
          {phase === "done" && <span className="text-sm text-slate-500">Change any rate above and recalculate.</span>}
        </div>
      </Card>

      {/* ---- progress: names a real step of the engine at each tick ---- */}
      {phase === "running" && (
        <Card title="Benchmarking your rates" sub="checking each line against the market and the supplier's filings" accent="#0d9488">
          <div className="py-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all duration-700 ease-out"
                style={{ width: `${((step + 1) / L3_STEPS.length) * 100}%` }} />
            </div>
            <ul className="mt-4 space-y-2">
              {L3_STEPS.map((t, i) => (
                <li key={t} className={`flex items-center gap-2.5 text-sm transition-colors ${i < step ? "text-slate-400" : i === step ? "font-semibold text-slate-800" : "text-slate-300"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${i < step ? "bg-emerald-100 text-emerald-600" : i === step ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* ---- results ---- */}
      {phase === "done" && (
        <Card title="Where you stand" sub="your rate vs the market midpoint · green = at or under market · red = overpaying" accent="#0d9488">
          <div className="overflow-x-auto">
            <table className={`${TBL} min-w-[900px]`}>
              <thead><tr className={THEAD}>
                <Th>Ingredient</Th><Th>Supplier</Th><Th right>Your ₹/kg</Th><Th right>Market band</Th><Th right>Gap</Th><Th right>Saving/yr</Th><Th center>Their room</Th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOver = (r.gap ?? 0) > 0;
                  return (
                    <tr key={r.item} className="border-t border-slate-100 align-middle hover:bg-slate-50/60">
                      <td className="px-4 py-3.5">
                        <div className="font-bold leading-snug text-slate-900">{r.item}</div>
                        {!r.band && <div className="text-xs font-medium text-amber-600">no market band on file</div>}
                      </td>
                      <td className="px-4 py-3.5">
                        {r.ent ? (
                          <button onClick={() => onSelect(r.ent!)} className="inline-flex items-start gap-1.5 text-left font-semibold text-teal-700 hover:underline">
                            <span className="mt-0.5 shrink-0">{catEmoji(r.ent.category)}</span>
                            <span className="leading-snug">{fullName(r.ent.legalName, r.ent.brand)}
                              {r.health != null && <span className={`ml-1 rounded px-1.5 align-middle text-[11px] font-extrabold ${hdot(r.health)}`}>{r.health}</span>}
                            </span>
                          </button>
                        ) : <span className="text-slate-500">{r.supplier}</span>}
                      </td>
                      <td className={`${TDNUM} font-bold text-slate-900`}>₹{r.rate.toLocaleString("en-IN")}</td>
                      <td className={`${TDNUM} text-slate-500`}>{r.band ? (r.band.min === r.band.max ? `₹${r.band.min}` : `₹${r.band.min}–${r.band.max}`) : "—"}</td>
                      <td className={`${TDNUM} font-bold ${r.gap == null ? "text-slate-400" : isOver ? "text-rose-600" : "text-emerald-600"}`}>{r.gap == null ? "—" : `${isOver ? "+" : ""}₹${Math.round(r.gap).toLocaleString("en-IN")}`}</td>
                      <td className={`${TDNUM} font-bold ${r.savingRs > 0 ? "text-rose-600" : "text-slate-400"}`}>{r.savingRs > 0 ? l3Money(r.savingRs) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center"><LeverCell e={r.ent} onOpen={setLeversFor} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-xs text-slate-400">Saving/yr = (your rate − market midpoint) × yearly kg.</p>
        </Card>
      )}

      {leversFor && <LeversModal e={leversFor} onClose={() => setLeversFor(null)} onOpenProfile={() => { const t = leversFor; setLeversFor(null); onSelect(t); }} />}
    </div>
  );
}

/* ---- Consolidated newsroom — every tracked supplier's news in one front page.
   Signals that move a negotiation (ownership changes, capex) lead; dated press
   follows newest-first; softer market-position notes sit at the bottom. Each name
   opens its deep-dive, each headline links out. Reads the same news.json the
   per-supplier News tab uses — one source of truth. */
const NEWS_LEAD = new Set(["Ownership change", "Capex / expansion"]);
const NEWS_SIG: Record<string, { emoji: string; border: string; chip: string }> = {
  "Ownership change": { emoji: "🔀", border: "border-indigo-400", chip: "bg-indigo-100 text-indigo-700" },
  "Capex / expansion": { emoji: "🏗️", border: "border-emerald-400", chip: "bg-emerald-100 text-emerald-700" },
  "Market position": { emoji: "📊", border: "border-slate-300", chip: "bg-slate-100 text-slate-600" },
};
function SupplierNewsroom({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const { leads, notes, items, covered } = useMemo(() => {
    const leads: { e: Entity; s: Signal }[] = [];
    const notes: { e: Entity; s: Signal }[] = [];
    const items: { e: Entity; it: NewsItem }[] = [];
    const seen = new Set<string>();
    for (const e of all) {
      const n = newsOf(e.folder);
      if (!n) continue;
      seen.add(e.folder);
      for (const s of n.signals) (NEWS_LEAD.has(s.type) ? leads : notes).push({ e, s });
      for (const it of n.news) items.push({ e, it });
    }
    items.sort((a, b) => b.it.date.localeCompare(a.it.date));
    leads.sort((a, b) => (a.s.type === "Ownership change" ? 0 : 1) - (b.s.type === "Ownership change" ? 0 : 1));
    return { leads, notes, items, covered: seen.size };
  }, [all]);
  const month = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const total = leads.length + notes.length + items.length;
  const NameBtn = ({ e }: { e: Entity }) => (
    <button onClick={() => onSelect(e)} className="inline-flex items-start gap-1 text-left text-sm font-semibold leading-snug text-teal-700 hover:underline"><span className="shrink-0">{catEmoji(e.category)}</span>{fullName(e.legalName, e.brand)}</button>
  );
  const Src = ({ url, source }: { url?: string; source?: string }) => !source ? null : url
    ? <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-slate-400 hover:text-teal-600">{source} ↗</a>
    : <span className="text-[11px] font-medium text-slate-400">{source}</span>;
  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-gradient-to-br from-[#0b3b39] via-[#0d9488] to-[#0891b2] p-5 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-bold">📰 Supplier newsroom — everything, in one place</div>
            <div className="mt-1 max-w-2xl text-sm text-white/80">Ownership moves, expansions and press across every tracked supplier — newest first. Each headline links to its source; each name opens its deep-dive.</div>
          </div>
          <div className="shrink-0 rounded-2xl bg-white/12 px-4 py-2.5 text-right ring-1 ring-white/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-teal-50">Stories on file</div>
            <div className="text-2xl font-bold tabular-nums">{total}</div>
            <div className="text-[11px] text-white/70">across {covered} suppliers · as of {month}</div>
          </div>
        </div>
      </div>
      {leads.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-sm font-bold text-slate-700">🔔 Moves that change your leverage</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {leads.map(({ e, s }, i) => {
              const st = NEWS_SIG[s.type] ?? NEWS_SIG["Market position"];
              return (
                <div key={i} className={`rounded-2xl border-l-4 ${st.border} bg-white p-4 shadow-sm ring-1 ring-slate-200/70`}>
                  <div className="flex items-center justify-between gap-2">
                    <NameBtn e={e} />
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.chip}`}>{st.emoji} {s.type}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.oneLine}</p>
                  <div className="mt-2"><Src url={s.url} source={s.source} /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <Card title="🗞 Latest headlines" sub="dated press across all suppliers · newest first" accent="#0891b2">
          <div className="grid gap-x-8 lg:grid-cols-2">
            {items.map(({ e, it }, i) => (
              <div key={i} className="border-b border-slate-100 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500">{it.date}</span>
                  <NameBtn e={e} />
                </div>
                {it.url
                  ? <a href={it.url} target="_blank" rel="noreferrer" className="text-sm font-bold leading-snug text-slate-900 hover:text-teal-700 hover:underline">{it.title}</a>
                  : <span className="text-sm font-bold leading-snug text-slate-900">{it.title}</span>}
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{it.oneLine}</p>
                <div className="mt-1"><Src url={it.url} source={it.source} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {notes.length > 0 && (
        <Card title="📊 Where they sit in the market" sub="positioning notes for the quieter suppliers — no hard press, but useful context" accent="#64748b">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {notes.map(({ e, s }, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                <NameBtn e={e} />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{s.oneLine}</p>
                <div className="mt-1"><Src url={s.url} source={s.source} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {total === 0 && <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400 ring-1 ring-slate-200">No supplier news on file yet.</div>}
      <p className="px-1 text-[11px] text-slate-400">Gathered from the open web. Suppliers with no public footprint don't appear here — their leverage lives in the financials.</p>
    </div>
  );
}

function SupplierView() {
  const all = useMemo(() => supplyEntities(), []);
  const [tab, setTab] = useState<SupTab>("board");
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);
  const { open: openSupplier, back } = useProfileNav(selected, setSelected);

  const stats = useMemo(() => {
    const revCr = all.reduce((s, e) => s + (toCrore(revOf(e)) ?? 0), 0);
    // Count levers from the same engine the board and the modal use, so the three
    // never disagree (this headline used to run on the older insight pass alone).
    const opps = all.reduce((s, e) => {
      const p = probeLevers(e.cin);
      return s + (p.length ? p.filter((l) => l.tone === "opportunity").length : supplierInsights(e).filter((i) => i.tone === "opportunity").length);
    }, 0);
    return { tracked: all.length, deep: enrichedCount(all), revCr, opps };
  }, [all]);

  // One view, not three: a supplier we hold a Probe42 report for opens straight
  // into the full tabbed deep-dive (no separate "open deep-dive" / "show full
  // detail" hops). Thin suppliers still get the lighter profile.
  if (selected) return hasDeepDive(selected.cin)
    ? <DeepDive entity={selected} onClose={back} supplies={suppliedItems(selected.folder)} />
    : <CompanyPage entity={selected} onBack={back} kind="supplier" />;

  return (
    <main className="mx-auto max-w-[1680px] px-4 pb-16 sm:px-6">
      <ModuleHero emoji="🏭" title="Supplier Intelligence"
        subtitle="Financial health, negotiation levers & risk across every RM · PM · Manufacturer vendor"
        tint="from-[#0f766e] to-[#0891b2]"
        stats={[
          { label: "Suppliers", value: String(stats.tracked) },
          { label: "Full reports pulled", value: `${stats.deep} of ${stats.tracked}` },
          { label: "Spend in view", value: crStr(stats.revCr) },
          { label: "Levers found", value: String(stats.opps) },
        ]} />
      {compareMode ? (
        <div className="mt-6"><CompareView all={all} onSelect={openSupplier} onClose={() => setCompareMode(false)} /></div>
      ) : (
        <>
          <div className="mt-5 mb-4 flex flex-wrap items-center justify-between gap-3">
            <SubTabs tabs={SUP_TABS} value={tab} onChange={setTab} />
            <button onClick={() => setCompareMode(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">🆚 Compare suppliers</button>
          </div>
          {tab === "board" && <BoardTab all={all} onSelect={openSupplier} />}
          {tab === "market" && <MarketStructureView all={all} onSelect={openSupplier} />}
          {tab === "supply" && <SupplyChainView all={all} onSelect={openSupplier} />}
          {tab === "rates" && <L3RateBench all={all} onSelect={openSupplier} />}
          {tab === "news" && <SupplierNewsroom all={all} onSelect={openSupplier} />}
        </>
      )}
    </main>
  );
}

// Our supply chain, honestly: the three things mcAFFEINE sources — raw materials
// (+ vendors), the manufacturers who make the products, and packaging (+ vendors),
// each with financials & levers. No invented per-product chains (we don't hold the
// real product→components mapping); market depth per item is the Ingredients tab.
function SupplyChainView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const byFolder = useMemo(() => new Map(all.map((e) => [e.folder, e])), [all]);
  const rmVendorCount = useMemo(() => all.filter((e) => e.category === "RM Vendor").length, [all]);
  const pmVendorCount = useMemo(() => all.filter((e) => e.category === "PM Vendor").length, [all]);
  const [leversFor, setLeversFor] = useState<Entity | null>(null);

  const Section = ({ title, emoji, accent, itemHead, rows, poolNote }: {
    title: string; emoji: string; accent: string; itemHead?: string;
    rows: { item?: string; folder: string }[]; poolNote: string;
  }) => (
    <Card title={`${emoji} ${title}`} sub={poolNote} accent={accent}>
      <div className="overflow-x-auto">
        <table className={`${TBL} min-w-[820px]`}>
          <thead>
            <tr className={THEAD}>
              {itemHead && <Th>{itemHead}</Th>}<Th>{itemHead ? "Current vendor" : "Company"}</Th><Th right>Revenue</Th><Th right>EBITDA</Th><Th right>RoCE</Th><Th center>Levers</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, folder }) => {
              const e = byFolder.get(folder);
              return (
                <tr key={item ?? folder} onClick={() => e && onSelect(e)} className={`border-t border-slate-100 transition ${e ? "cursor-pointer hover:bg-teal-50/50" : ""}`}>
                  {itemHead && <td className="max-w-[280px] px-4 py-3.5"><div className="truncate font-semibold text-slate-900" title={item}>{item}</div></td>}
                  <td className="min-w-[240px] px-4 py-3.5">{e ? <span className="flex items-start gap-1.5 font-semibold text-slate-900"><span className="shrink-0 leading-relaxed">{catEmoji(e.category)}</span><span className="leading-snug">{fullName(e.legalName, e.brand)}</span></span> : <span className="text-slate-400">not mapped</span>}</td>
                  <td className={`${TDNUM} font-semibold text-slate-900`}>{e ? fmtCrore(revOf(e)) : "—"}</td>
                  <td className={`${TDNUM} text-slate-600`}>{e ? fmtPct(ebitdaMarginOf(e)) : "—"}</td>
                  <td className={`${TDNUM} text-slate-600`}>{e ? fmtPct(supRoce(e)) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-center"><LeverCell e={e} onOpen={setLeversFor} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const mfRows = useMemo(() => all.filter((e) => e.category === "Manufacturer").sort((a, b) => (revOf(b) ?? -1) - (revOf(a) ?? -1)).map((e) => ({ folder: e.folder })), [all]);

  return (
    <div className="space-y-4">
      <Section title="Raw materials" emoji="🧪" accent="#0d9488" itemHead="Raw material"
        rows={RM_SUPPLY} poolNote={`${RM_SUPPLY.length} key ingredients · ${rmVendorCount} RM vendors tracked`} />
      <Section title="Manufacturers — who make our products" emoji="🏭" accent="#7c3aed"
        rows={mfRows} poolNote={`${mfRows.length} contract manufacturers tracked`} />
      <Section title="Packaging" emoji="📦" accent="#2a78d6" itemHead="Packaging item"
        rows={PM_SUPPLY} poolNote={`${PM_SUPPLY.length} key packaging items · ${pmVendorCount} PM vendors tracked`} />
      {leversFor && <LeversModal e={leversFor} onClose={() => setLeversFor(null)} onOpenProfile={() => { const t = leversFor; setLeversFor(null); onSelect(t); }} />}
    </div>
  );
}

// Product / material taxonomy for the "By product" view. Each tag matches the
// supplier's free-text industry + research.products + overview, so we can group
// vendors that offer the same thing — a ready shortlist of sourcing alternatives.
type ProductGroup = "Finished product" | "Raw material" | "Packaging";
const PRODUCT_TAGS: { key: string; label: string; emoji: string; group: ProductGroup; re: RegExp }[] = [
  { key: "facewash", label: "Face wash / cleanser", emoji: "🧼", group: "Finished product", re: /face ?wash|facial cleanser|cleanser/ },
  { key: "bodywash", label: "Body wash / shower gel", emoji: "🚿", group: "Finished product", re: /body ?wash|shower gel|bathing/ },
  { key: "haircare", label: "Shampoo / conditioner", emoji: "🧴", group: "Finished product", re: /shampoo|conditioner/ },
  { key: "hairoil", label: "Hair oil", emoji: "🛢️", group: "Finished product", re: /hair oil/ },
  { key: "serum", label: "Serums", emoji: "💧", group: "Finished product", re: /\bserum/ },
  { key: "cream", label: "Creams / lotions / moisturisers", emoji: "🧴", group: "Finished product", re: /\bcream|lotion|moisturi[sz]er/ },
  { key: "sunscreen", label: "Sunscreen", emoji: "☀️", group: "Finished product", re: /sunscreen|sun care|\bspf\b/ },
  { key: "mask", label: "Sheet masks / patches", emoji: "🎭", group: "Finished product", re: /sheet mask|face mask|hydrogel|\bpatch|nose strip|wax strip/ },
  { key: "scrub", label: "Scrubs / exfoliants", emoji: "🧽", group: "Finished product", re: /scrub|exfoliat/ },
  { key: "soap", label: "Soaps / bars", emoji: "🧼", group: "Finished product", re: /\bsoap/ },
  { key: "lip", label: "Lip care", emoji: "💄", group: "Finished product", re: /lip balm|lip care|lipstick|\blip\b/ },
  { key: "wipes", label: "Wipes", emoji: "🧻", group: "Finished product", re: /\bwipes?\b/ },
  { key: "surfactant", label: "Surfactants", emoji: "🫧", group: "Raw material", re: /surfactant/ },
  { key: "preservative", label: "Preservatives", emoji: "🧪", group: "Raw material", re: /preservative/ },
  { key: "fragrance", label: "Fragrances / essential oils", emoji: "🌸", group: "Raw material", re: /fragrance|essential oil|\baroma|perfum/ },
  { key: "actives", label: "Actives / botanical extracts", emoji: "🌿", group: "Raw material", re: /\bactives?\b|\bextract|botanical/ },
  { key: "emulsifier", label: "Emulsifiers", emoji: "🧫", group: "Raw material", re: /emulsifier/ },
  { key: "specialtychem", label: "Specialty chemicals / ingredients", emoji: "⚗️", group: "Raw material", re: /specialty chemical|fine chemical|specialty ingredient|cosmetic ingredient|chemical distribut/ },
  { key: "tube", label: "Tubes", emoji: "📏", group: "Packaging", re: /\btubes?\b/ },
  { key: "jar", label: "Jars", emoji: "🫙", group: "Packaging", re: /\bjars?\b/ },
  { key: "bottle", label: "Bottles", emoji: "🍾", group: "Packaging", re: /\bbottles?\b/ },
  { key: "closure", label: "Caps / pumps / closures", emoji: "🔩", group: "Packaging", re: /\bcaps?\b|closure|\bpumps?\b|dispenser/ },
  { key: "printed", label: "Cartons / boxes / labels", emoji: "📦", group: "Packaging", re: /carton|\bboxes?\b|\blabels?\b|printing|printed pack/ },
  { key: "pouch", label: "Pouches / sachets / films", emoji: "🥡", group: "Packaging", re: /pouch|sachet|\bfilms?\b|laminat/ },
];

function productTagsOf(e: Entity): string[] {
  const r = e.research;
  const blob = [e.industry ?? "", ...(r?.products ?? []), r?.overview ?? ""].join(" · ").toLowerCase();
  if (!blob.trim()) return [];
  return PRODUCT_TAGS.filter((t) => t.re.test(blob)).map((t) => t.key);
}

/* ---------------------------------------------------------- L2 Market structure */
// The "India Trade" / monopoly check: for each thing we buy, how many credible
// suppliers exist — and does that hand the leverage to us (a crowded commodity)
// or to them (a sole-source proprietary molecule)? Laid out as a leverage map so
// you see at a glance which buys we control vs which control us.
const CONF_DOT: Record<string, string> = { high: "bg-emerald-400", medium: "bg-amber-400", low: "bg-slate-300" };

// Click a raw material → this page: every supplier that sells it (our current
// vendor + the IndiaMART/TradeIndia alternatives) with price context and their
// financials side by side, then the negotiation levers our vendor hands us.
function IngredientDetail({ entry, currentVendor, all, onBack, onSelectVendor, backLabel = "all ingredients" }: {
  entry: MarketEntry; currentVendor: Entity | undefined; all: Entity[]; onBack: () => void; onSelectVendor: (e: Entity) => void; backLabel?: string;
}) {
  const byFolder = useMemo(() => new Map(all.map((e) => [e.folder, e])), [all]);
  const [deep, setDeep] = useState(false);
  const lev = LEV_META[entry.leverage];
  const conc = CONC_META[entry.concentration];
  const alts = entry.alternatives ?? [];
  const ins = currentVendor ? supplierInsights(currentVendor) : [];
  const trend = useMemo(() => (currentVendor ? buildTrendMetrics(currentVendor) : []), [currentVendor]);
  const canDeep = hasDeepDive(currentVendor?.cin);
  const pLev = probeLevers(currentVendor?.cin);
  const hasPrice = !!entry.priceINRPerKg && !entry.priceINRPerKg.includes("not found");
  const chip = "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1";
  const loc = (e: Entity) => [(e.city ?? ""), (e.state ?? "").replace(/\s*\(implied\)\s*/i, "").trim()].filter(Boolean).join(", ") || "—";
  const STEPS: [string, string][] = [["①", "Suppliers"], ["②", "Price"], ["③", "Financials"], ["④", "Levers"]];
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700"><span className="text-base leading-none">←</span> Back to {backLabel}</button>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-bold text-slate-900">🧪 {entry.item}</div>
            {entry.inci && <div className="mt-0.5 text-sm text-slate-500">{entry.inci}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPrice && <span className={`${chip} bg-orange-50 text-orange-700 ring-orange-200`}>💰 {entry.priceINRPerKg}</span>}
            <span className={`${chip} bg-slate-50 text-slate-700 ring-slate-200`}>{lev.emoji} {lev.label}</span>
            <span className={`${chip} bg-slate-50 text-slate-700 ring-slate-200`}>🇮🇳 {entry.indiaBand} sellers in India</span>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{entry.implication}</p>
        {entry.priceNote && <p className="mt-1.5 text-xs text-slate-400">Price: {entry.priceNote}{entry.priceSource ? ` · ${entry.priceSource}` : ""}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-slate-100 pt-3">
          {STEPS.map(([n, l], i) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-100">{n} {l}</span>
              {i < STEPS.length - 1 && <span className="text-slate-300">→</span>}
            </span>
          ))}
        </div>
      </div>

      <Card title={`① Suppliers who sell ${entry.item}  ·  ② the price each offers`} sub={alts.length ? `Our current vendor vs ${alts.length} alternatives found on IndiaMART / TradeIndia — click a vendor for its full profile` : "Our current vendor for this item"} accent="#0d9488">
        <div className="overflow-x-auto">
          <table className={`${TBL} min-w-[880px]`}>
            <thead>
              <tr className={THEAD}>
                <Th>Supplier</Th><Th>Role</Th><Th>Location</Th><Th right>Market ₹/kg</Th><Th right>Revenue</Th><Th right>EBITDA</Th><Th right>RoCE</Th><Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {currentVendor && (
                <tr onClick={() => onSelectVendor(currentVendor)} className="cursor-pointer border-t border-slate-100 bg-teal-50/40 transition hover:bg-teal-50">
                  <td className="px-4 py-3 font-semibold leading-snug text-slate-900">⭐ {fullName(currentVendor.legalName, currentVendor.brand)}</td>
                  <td className="px-4 py-3"><span className="inline-flex rounded-md bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-800">Our vendor</span></td>
                  <td className="px-4 py-3 text-slate-500">{loc(currentVendor)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-orange-700">{hasPrice ? entry.priceINRPerKg : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">{fmtCrore(revOf(currentVendor))}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{fmtPct(ebitdaMarginOf(currentVendor))}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{fmtPct(supRoce(currentVendor))}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">click for full profile →</td>
                </tr>
              )}
              {alts.map((a) => {
                const e = a.folder ? byFolder.get(a.folder) : undefined;
                return (
                  <tr key={a.name} onClick={e ? () => onSelectVendor(e) : undefined} className={`border-t border-slate-100 ${e ? "cursor-pointer hover:bg-teal-50/50" : ""}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                    <td className="px-4 py-3"><span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Alternative</span></td>
                    <td className="px-4 py-3 text-slate-500">{a.location || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-orange-600">{hasPrice ? entry.priceINRPerKg : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">{a.revenueCr != null ? crStr(a.revenueCr) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{a.ebitdaPct != null ? `${a.ebitdaPct}%` : a.cin ? <span className="text-amber-600" title="Private company — pull via Tracxn/Probe using the CIN in the Note column">Tracxn</span> : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{a.rocePct != null ? `${a.rocePct}%` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{[a.note, a.cin].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 px-1 text-[11px] text-slate-400">Market ₹/kg is the open-market band for this material, not a per-seller quote.</p>
      </Card>

      {currentVendor && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title={`③ ${currentVendor.brand} — financials & the trend behind the price`} sub="the numbers that create (or kill) our leverage · switch the metric to see its trend" accent="#0891b2">
              {canDeep && (
                <button onClick={() => setDeep(true)} className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110">📊 Open full financial deep-dive →</button>
              )}
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {(([["Revenue", fmtCrore(revOf(currentVendor))], ["EBITDA margin", fmtPct(ebitdaMarginOf(currentVendor))], ["RoCE", fmtPct(supRoce(currentVendor))], ["Collects in", fmtDays(supDSO(currentVendor))], ["Pays in", fmtDays(supDPO(currentVendor))]]) as [string, string][]).map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{l}</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900">{v}</div>
                  </div>
                ))}
              </div>
              {trend.length > 0
                ? <MetricTrend metrics={trend} height={220} />
                : <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">The year-by-year trend unlocks once we pull this vendor's filings (Probe42). The figures above are the latest on file.</div>}
            </Card>
          </div>
          <div>
            <Card title="④ Negotiation levers" sub={pLev.length ? `auto-generated from ${currentVendor.brand}'s full Probe42 filings` : `what ${currentVendor.brand}'s own numbers hand us`} accent="#eda100">
              {pLev.length > 0 ? (
                <div className="space-y-2">
                  {pLev.slice(0, 6).map((lv, i) => {
                    const t = lv.tone === "opportunity" ? "border-emerald-300 bg-emerald-50" : lv.tone === "risk" ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50";
                    return (
                      <div key={i} className={`rounded-lg border-l-4 ${t} px-2.5 py-1.5`}>
                        <div className="text-xs font-semibold text-slate-800">{lv.title}</div>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{lv.detail}</p>
                      </div>
                    );
                  })}
                  {pLev.length > 6 && <p className="text-[11px] text-slate-400">+{pLev.length - 6} more — open the deep-dive above.</p>}
                </div>
              ) : ins.length > 0
                ? <LeverStrip ins={ins} />
                : <p className="text-sm text-slate-400">No standout lever — this reads as a healthy, fairly-priced vendor.</p>}
              <div className={`mt-4 rounded-xl ${conc.bg} p-3 text-xs ring-1 ${conc.ring}`}>
                <div className={`font-semibold ${conc.text}`}>{conc.emoji} {conc.label}</div>
                <div className="mt-0.5 leading-relaxed text-slate-600">{conc.blurb} · {entry.indiaBand} credible sellers in India{hasPrice ? ` · going rate ${entry.priceINRPerKg}` : ""}.</div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {deep && canDeep && currentVendor && <DeepDive entity={currentVendor} onClose={() => setDeep(false)} />}
    </div>
  );
}

function MarketStructureView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [openItem, setOpenItem] = useState<string | null>(null);
  const byFolder = useMemo(() => new Map(all.map((e) => [e.folder, e])), [all]);
  const [side, setSide] = useState<"rm" | "pm">("rm");
  const entries = useMemo(() => allMarket().filter((m) => m.side === side), [side]);

  // Which vendor(s) supply this market item today, and the clickable entity.
  const vendorFor = (m: MarketEntry): { label: string; e?: Entity } => {
    if (m.side === "rm") {
      const row = RM_SUPPLY.find((s) => s.item === m.item && s.folder);
      const e = row ? byFolder.get(row.folder) : undefined;
      return { label: e ? fullName(e.legalName, e.brand) : (row?.brand ?? "—"), e };
    }
    const rows = PM_SUPPLY.filter((s) => pmCategoryOf(s.item) === m.item && s.folder);
    const names = [...new Set(rows.map((s) => { const en = byFolder.get(s.folder); return en ? fullName(en.legalName, en.brand) : s.brand; }))];
    return { label: names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") : "—", e: rows[0] ? byFolder.get(rows[0].folder) : undefined };
  };

  const counts = useMemo(() => {
    const c: Record<Concentration, number> = { sole: 0, concentrated: 0, competitive: 0 };
    entries.forEach((m) => c[m.concentration]++);
    return c;
  }, [entries]);
  const cols: Concentration[] = ["sole", "concentrated", "competitive"];

  // Drilled into one ingredient → show its suppliers / prices / levers page.
  if (openItem) {
    const entry = allMarket().find((m) => m.item === openItem);
    if (entry) return <IngredientDetail entry={entry} currentVendor={vendorFor(entry).e} all={all} onBack={() => setOpenItem(null)} onSelectVendor={onSelect} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Dropdown label="Show" value={side} onChange={(v) => setSide(v as "rm" | "pm")}
          options={[{ key: "rm", label: `Raw materials (${allMarket().filter((m) => m.side === "rm").length})`, emoji: "🧪" }, { key: "pm", label: `Packaging (${allMarket().filter((m) => m.side === "pm").length})`, emoji: "📦" }]} />
        <span className="text-sm text-slate-500">Who holds the pricing power on each {side === "rm" ? "ingredient" : "packaging category"} we buy</span>
      </div>

      {/* headline: how our buys split across the leverage spectrum */}
      <Card title="🌐 Where the leverage sits" sub={`${entries.length} ${side === "rm" ? "key ingredients" : "packaging categories"} · left = they set the price, right = we do`} accent="#0d9488">
        <div className="flex h-6 w-full overflow-hidden rounded-lg ring-1 ring-slate-200">
          {cols.map((c) => counts[c] > 0 && (
            <div key={c} title={`${counts[c]} ${CONC_META[c].label}`} className="flex items-center justify-center text-xs font-semibold text-white" style={{ width: `${(counts[c] / entries.length) * 100}%`, background: CONC_META[c].color }}>
              {counts[c]}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {cols.map((c) => (
            <span key={c} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONC_META[c].color }} />{CONC_META[c].emoji} {CONC_META[c].label} — {CONC_META[c].blurb}</span>
          ))}
        </div>
      </Card>

      {/* leverage map: compact cards grouped by concentration, each group spanning
          the full width so the sparse groups don't leave a tall empty column. The
          per-item analysis lives one click deeper (drill-down), keeping this a
          fast, scannable board rather than a wall of prose. */}
      {cols.map((c) => {
        const meta = CONC_META[c];
        const items = entries.filter((m) => m.concentration === c);
        if (items.length === 0) return null;
        return (
          <div key={c}>
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <span className={`text-sm font-bold ${meta.text}`}>{meta.emoji} {meta.label}</span>
              <span className={`rounded-full ${meta.bg} px-2 py-0.5 text-xs font-semibold ${meta.text} ring-1 ${meta.ring}`}>{items.length}</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((m) => {
                const v = vendorFor(m);
                const lev = LEV_META[m.leverage];
                return (
                  <div key={m.item} onClick={() => setOpenItem(m.item)} className="cursor-pointer rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-teal-300" style={{ borderLeft: `3px solid ${meta.color}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900" title={m.item}>{m.item}</div>
                        {m.inci && <div className="truncate text-[11px] text-slate-500" title={m.inci}>{m.inci}</div>}
                      </div>
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${CONF_DOT[m.confidence] ?? CONF_DOT.low}`} title={`${m.confidence} confidence`} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${meta.bg} ${meta.text} ring-1 ${meta.ring}`}>{lev.emoji} {lev.label}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600" title={`${m.indiaBand} sellers in India · ${m.indiaSuppliers.join(" · ")}`}>🇮🇳 {m.indiaBand}</span>
                      {m.priceINRPerKg && !m.priceINRPerKg.includes("not found") && <span title={[m.priceNote, m.priceSource].filter(Boolean).join(" · ")} className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-orange-200">💰 {m.priceINRPerKg}</span>}
                    </div>
                    {/* the teal dot marks a vendor we hold a full Probe42 report
                        for, so it's obvious at a glance which names are analysable
                        and which are open-market traders with no filings. */}
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400" title={v.e && hasDeepDive(v.e.cin) ? `${v.label} — full financials on file` : v.label}>
                      <span className="shrink-0">{m.side === "rm" ? "Vendor" : "We buy from"}:</span>
                      <span className="truncate text-slate-600">{v.label}</span>
                      {v.e && hasDeepDive(v.e.cin) && <span className="shrink-0 text-teal-500" title="full financials on file">●</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-slate-400">Open-web research, not a census · <span className="text-teal-500">●</span> = full financials on file · click any card for the full analysis.</p>
    </div>
  );
}

/* ------------------------------------------------ Compare & analyse suppliers */

const CMP_COLORS = ["#0d9488", "#e34948", "#2a78d6", "#eda100", "#7c3aed", "#0891b2"];
const CMP_MAX = 5;
const RENEG_WEIGHT: Record<string, number> = {
  "Fat margins — push on price": 3, "Margins are widening": 2, "Room to extend our payment terms": 2, "Input-cost pass-through": 2,
  "Collects faster than its peers": 1.5, "They already stretch their suppliers": 1.5, "Offer early payment for a discount": 1.5, "Carrying heavy stock": 1.5,
};
// A fiscal-year row from a supplier profile — source of every trend metric.
type PYear = NonNullable<Entity["profile"]>["years"][number];
const sFy = (fy: string) => { const p = fy.split(/[-\s/]/).filter(Boolean); return "'" + (p[p.length - 1] ?? fy).slice(-2); };
const CMP_TREND: { key: string; label: string; emoji: string; unit: (v: number) => string; get: (y: PYear) => number | null }[] = [
  { key: "revenue", label: "Revenue", emoji: "💵", unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`), get: (y) => (y.revenueINR != null ? Math.round(y.revenueINR / 1e7) : null) },
  { key: "netprofit", label: "Net profit", emoji: "📈", unit: (v) => (v >= 0 ? `₹${Math.round(v)} Cr` : `−₹${Math.round(Math.abs(v))} Cr`), get: (y) => (y.netProfitINR != null ? Math.round(y.netProfitINR / 1e7) : null) },
  { key: "ebitda", label: "EBITDA margin", emoji: "💰", unit: (v) => `${Math.round(v)}%`, get: (y) => y.ebitdaMarginPct ?? null },
  { key: "netmargin", label: "Net margin", emoji: "📊", unit: (v) => `${Math.round(v)}%`, get: (y) => y.netMarginPct ?? null },
  { key: "roce", label: "RoCE", emoji: "⚙️", unit: (v) => `${Math.round(v)}%`, get: (y) => y.rocePct ?? null },
  { key: "roe", label: "RoE", emoji: "🏦", unit: (v) => `${Math.round(v)}%`, get: (y) => y.roePct ?? null },
  { key: "dso", label: "Collection days", emoji: "⏱️", unit: (v) => `${Math.round(v)} d`, get: (y) => y.receivableDays ?? null },
  { key: "dpo", label: "Payment days", emoji: "📤", unit: (v) => `${Math.round(v)} d`, get: (y) => y.payableDays ?? null },
  { key: "current", label: "Current ratio", emoji: "💧", unit: (v) => v.toFixed(2), get: (y) => y.currentRatio ?? null },
  { key: "de", label: "Debt / equity", emoji: "⚖️", unit: (v) => v.toFixed(2), get: (y) => y.debtToEquity ?? null },
  { key: "icov", label: "Interest cover", emoji: "🛡️", unit: (v) => `${v.toFixed(1)}x`, get: (y) => y.interestCoverage ?? null },
];

// The comparison chart: one metric (from a dropdown) plotted as a multi-year
// line per selected supplier, all on the same axes — trend-first, not one year.
function TrendCompare({ selected }: { selected: Entity[] }) {
  const [mk, setMk] = useState(CMP_TREND[0].key);
  const m = CMP_TREND.find((x) => x.key === mk) ?? CMP_TREND[0];
  const fyShort = new Map<string, string>();
  selected.forEach((e) => (e.profile?.years ?? []).forEach((y) => fyShort.set(y.fy, sFy(y.fy))));
  const rawFys = [...fyShort.keys()].sort((a, b) => a.localeCompare(b));
  const xLabels = rawFys.map((f) => fyShort.get(f)!);
  const series = selected.map((e, i) => {
    const byFy = new Map((e.profile?.years ?? []).map((y) => [y.fy, m.get(y)]));
    return { name: e.brand, color: CMP_COLORS[i % CMP_COLORS.length], points: rawFys.map((f) => (byFy.has(f) ? byFy.get(f) ?? null : null)) };
  });
  const anyData = series.some((s) => s.points.some((v) => v != null));
  return (
    <div>
      <div className="mb-3"><Dropdown label="Metric" value={mk} onChange={setMk} options={CMP_TREND.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} /></div>
      {anyData
        ? <MultiLine xLabels={xLabels} series={series} valueLabel={m.unit} height={300} />
        : <div className="py-10 text-center text-sm text-slate-400">None of the selected suppliers have multi-year data for this metric.</div>}
    </div>
  );
}

// Pick any suppliers (optionally narrowed by product / type) then Analyse them
// head-to-head — a visual scorecard for "who do I renegotiate with / go with".
function CompareView({ all, onSelect, onClose }: { all: Entity[]; onSelect: (e: Entity) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [prod, setProd] = useState("any");
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const [query, setQuery] = useState("");
  const [ingredient, setIngredient] = useState<MarketEntry | null>(null);

  const avail = useMemo(() => {
    const counts = new Map<string, number>();
    PRODUCT_TAGS.forEach((t) => counts.set(t.key, 0));
    all.forEach((e) => productTagsOf(e).forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
    return PRODUCT_TAGS.filter((t) => (counts.get(t.key) ?? 0) > 0);
  }, [all]);

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (cat !== "All" && e.category !== cat) return false;
      if (prod !== "any" && !productTagsOf(e).includes(prod)) return false;
      if (q && !`${e.brand} ${e.legalName ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (revOf(b) ?? -1) - (revOf(a) ?? -1));
  }, [all, cat, prod, query]);

  const byFolder = useMemo(() => new Map(all.map((e) => [e.folder, e])), [all]);
  const enriched = useMemo(() => all.filter((e) => hasDeepDive(e.cin)), [all]);
  const selected = picked.map((f) => byFolder.get(f)).filter((e): e is Entity => !!e);
  const full = picked.length >= CMP_MAX;
  const toggle = (f: string) => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : p.length >= CMP_MAX ? p : [...p, f]));
  const launch = (list: Entity[]) => { setPicked(list.slice(0, CMP_MAX).map((e) => e.folder)); setAnalysing(true); };
  const topCat = (c: (typeof SUP_CATS)[number]) => all.filter((e) => e.category === c && revOf(e) != null).sort((a, b) => (revOf(b) ?? 0) - (revOf(a) ?? 0)).slice(0, CMP_MAX);
  const presetCls = "inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-teal-50 hover:text-teal-700 hover:ring-teal-300";

  const vendorForIngredient = (entry: MarketEntry): Entity | undefined => {
    if (entry.side === "rm") { const row = RM_SUPPLY.find((s) => s.item === entry.item && s.folder); return row ? byFolder.get(row.folder) : undefined; }
    const row = PM_SUPPLY.find((s) => pmCategoryOf(s.item) === entry.item && s.folder);
    return row ? byFolder.get(row.folder) : undefined;
  };

  if (ingredient) return <IngredientDetail entry={ingredient} currentVendor={vendorForIngredient(ingredient)} all={all} onBack={() => setIngredient(null)} onSelectVendor={onSelect} backLabel="compare" />;
  if (analysing && selected.length >= 2) return <CompareAnalysis selected={selected} onBack={() => setAnalysing(false)} onSelect={onSelect} />;

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700"><span className="text-base leading-none">←</span> Back to suppliers</button>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="text-base font-semibold text-slate-900">🆚 Compare suppliers</div>
        <div className="mt-0.5 text-sm text-slate-500">Tick up to {CMP_MAX} suppliers below, or start from a quick view.</div>

        {/* default views / presets */}
        <div className="mt-3 flex flex-wrap gap-2">
          {enriched.length >= 2 && <button onClick={() => launch(enriched)} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110">✨ Our {enriched.length} deep-dive suppliers</button>}
          {(["Manufacturer", "RM Vendor", "PM Vendor"] as const).map((c) => topCat(c).length >= 2 ? <button key={c} onClick={() => launch(topCat(c))} className={presetCls}>{catEmoji(c)} Top {c}s</button> : null)}
        </div>

        {/* ingredient sellers — every seller of one ingredient (incl. IndiaMART alternatives) with price */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-sm font-medium text-slate-600">🧪 Or see one ingredient's sellers &amp; prices:</span>
          <select value="" onChange={(e) => { const entry = allMarket().find((m) => m.item === e.target.value); if (entry) setIngredient(entry); }}
            className="min-w-[16rem] rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400">
            <option value="">Pick an ingredient…</option>
            <optgroup label="Raw materials">{allMarket().filter((m) => m.side === "rm").map((m) => <option key={m.item} value={m.item}>{m.item}</option>)}</optgroup>
            <optgroup label="Packaging">{allMarket().filter((m) => m.side === "pm").map((m) => <option key={m.item} value={m.item}>{m.item}</option>)}</optgroup>
          </select>
        </div>

        {/* filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Dropdown label="Product" value={prod} onChange={setProd} options={[{ key: "any", label: "Any product" }, ...avail.map((t) => ({ key: t.key, label: t.label, emoji: t.emoji }))]} />
          <Dropdown label="Type" value={cat} onChange={setCat} options={SUP_CATS.map((c) => ({ key: c, label: c }))} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search suppliers…" className="w-52 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-teal-400" />
          <span className={`ml-auto text-sm ${full ? "font-semibold text-teal-700" : "text-slate-400"}`}>{picked.length}/{CMP_MAX} picked</span>
        </div>

        {/* checkbox grid */}
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {pool.map((e) => {
              const on = picked.includes(e.folder);
              const disabled = !on && full;
              return (
                <label key={e.folder} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${on ? "bg-teal-50 ring-1 ring-teal-200" : disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white"}`}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(e.folder)} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400" />
                  <span className="shrink-0">{catEmoji(e.category)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={fullName(e.legalName, e.brand)}>{e.brand}{hasDeepDive(e.cin) && <span className="ml-1 text-[10px] text-teal-600" title="full Probe42 report on file">●</span>}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-400">{fmtCrore(revOf(e))}</span>
                </label>
              );
            })}
            {pool.length === 0 && <div className="col-span-full py-6 text-center text-sm text-slate-400">No suppliers match.</div>}
          </div>
        </div>

        {/* selected + compare */}
        {selected.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {selected.map((e, i) => (
              <span key={e.folder} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }}>
                {e.brand}<button onClick={() => toggle(e.folder)} className="opacity-80 transition hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button disabled={selected.length < 2} onClick={() => setAnalysing(true)} className={`rounded-lg px-5 py-2 text-sm font-semibold text-white transition ${selected.length >= 2 ? "bg-teal-600 hover:bg-teal-700" : "cursor-not-allowed bg-slate-300"}`}>Compare {selected.length >= 2 ? `${selected.length} ` : ""}→</button>
          {selected.length > 0 && <button onClick={() => setPicked([])} className="text-sm text-slate-500 transition hover:text-slate-800">Clear</button>}
          {selected.length < 2 && <span className="text-sm text-slate-400">Pick at least 2</span>}
        </div>
      </div>
    </div>
  );
}

function VerdictCard({ emoji, title, e, color, note, onSelect }: { emoji: string; title: string; e?: Entity | null; color?: string; note?: string | null; onSelect: (e: Entity) => void }) {
  return (
    <button onClick={e ? () => onSelect(e) : undefined} disabled={!e} className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md disabled:cursor-default disabled:opacity-70">
      <span className="text-2xl leading-none">{emoji}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        <div className="flex items-center gap-2 text-lg font-bold leading-snug text-slate-900">{color && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />}{e ? fullName(e.legalName, e.brand) : "—"}</div>
        {note && <div className="text-xs text-slate-500">{note}</div>}
      </div>
    </button>
  );
}

function CompareAnalysis({ selected, onBack, onSelect }: { selected: Entity[]; onBack: () => void; onSelect: (e: Entity) => void }) {
  const colorOf = (e: Entity) => CMP_COLORS[selected.indexOf(e) % CMP_COLORS.length];

  // A weakening supplier can carry both an opportunity lever and a "protect the
  // relationship" watch — don't let it win "most room to renegotiate". Protection
  // overrides the aggressive-negotiation score.
  const reneg = selected.map((e) => {
    const ins = supplierInsights(e);
    const protect = ins.some((i) => i.title === "Protect the relationship");
    const s = protect ? 0 : ins.filter((i) => i.tone === "opportunity").reduce((a, i) => a + (RENEG_WEIGHT[i.title] ?? 1), 0);
    return { e, s };
  }).sort((a, b) => b.s - a.s);
  const fit = selected.map((e) => { const ax = fitnessAxes(e); return { e, s: ax.length ? ax.reduce((a, x) => a + x.score, 0) / ax.length : 0 }; }).sort((a, b) => b.s - a.s);
  const bestReneg = reneg[0] && reneg[0].s > 0 ? reneg[0] : null;
  const bestFit = fit[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700"><span className="text-base leading-none">←</span> Change selection</button>
        <div className="flex flex-wrap gap-1.5">{selected.map((e, i) => <span key={e.folder} className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }}>{e.brand}</span>)}</div>
      </div>

      {selected.some((e) => suppliedItems(e.folder).length > 0) && (
        <Card title="🏷️ What they supply us & the market price" sub="the ingredient(s) each one provides to mcAFFEINE and its going open-market rate — IndiaMART band, not a per-vendor quote" accent="#eda100">
          <div className="overflow-x-auto">
            <table className={`${TBL} min-w-[620px]`}>
              <thead><tr className={THEAD}><Th>Supplier</Th><Th>Supplies to us</Th><Th right>Market ₹/kg</Th><Th>Who holds the pricing power</Th></tr></thead>
              <tbody>
                {selected.flatMap((e, i) => {
                  const items = suppliedItems(e.folder);
                  if (!items.length) return [<tr key={e.folder} className="border-t border-slate-100"><td className="px-4 py-2 font-semibold leading-snug text-slate-900"><span className="inline-flex items-start gap-1.5"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }} />{fullName(e.legalName, e.brand)}</span></td><td className="px-4 py-2 text-slate-400" colSpan={3}>Not mapped to a tracked ingredient</td></tr>];
                  return items.map((it, j) => {
                    const mk = marketOf(it);
                    const lev = mk ? LEV_META[mk.leverage] : null;
                    const hasP = !!mk?.priceINRPerKg && !mk.priceINRPerKg.includes("not found");
                    return (
                      <tr key={e.folder + it} className="border-t border-slate-100">
                        {j === 0 && <td rowSpan={items.length} className="px-4 py-2 align-top font-semibold leading-snug text-slate-900"><span className="inline-flex items-start gap-1.5"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }} />{fullName(e.legalName, e.brand)}</span></td>}
                        <td className="px-4 py-2 text-slate-700">{it}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-orange-700">{hasP ? mk!.priceINRPerKg : "—"}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{lev ? `${lev.emoji} ${lev.label}` : "—"}</td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {enrichedCount(selected) >= 2 ? (
        // Rich Probe42 comparison — full financials, head-to-head trend, lever engine.
        <ProbeCompare entities={selected} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <VerdictCard emoji="🤝" title="Most room to renegotiate" e={bestReneg?.e} color={bestReneg ? colorOf(bestReneg.e) : undefined} note={bestReneg ? supplierInsights(bestReneg.e).find((i) => i.tone === "opportunity")?.title : "No clear lever among these"} onSelect={onSelect} />
            <VerdictCard emoji="🛡️" title="Most reliable to commit to" e={bestFit.e} color={colorOf(bestFit.e)} note={`Financial fitness ${Math.round(bestFit.s)}/100`} onSelect={onSelect} />
          </div>
          <Card title="📈 Trend comparison" sub="pick a metric — every selected supplier's multi-year trend on one chart" accent="#0d9488">
            <TrendCompare selected={selected} />
          </Card>
          <Card title="🎯 Negotiation angles per supplier" sub="the levers each one hands you" accent="#eda100">
            <div className="space-y-2.5">
              {selected.map((e, i) => {
                const lv = leverTagsOf(supplierInsights(e));
                return (
                  <div key={e.folder} className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex min-w-[10rem] items-center gap-1.5 text-sm font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CMP_COLORS[i % CMP_COLORS.length] }} />{e.brand}</span>
                    {lv.length ? lv.map(({ short, emoji, detail }) => <span key={short} title={detail} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">{emoji} {short}</span>) : <span className="text-xs text-slate-400">No clear lever — healthy vendor</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// Short tag for each opportunity lever, so it fits in a table cell (full sentence
// stays on hover + on the company page).
const LEVER_TAG: Record<string, { emoji: string; short: string }> = {
  "Room to extend our payment terms": { emoji: "💸", short: "Extend terms" },
  "Collects faster than its peers": { emoji: "💸", short: "Extend terms" },
  "They already stretch their suppliers": { emoji: "⏳", short: "They stretch" },
  "Fat margins — push on price": { emoji: "💰", short: "Push price" },
  "Margins are widening": { emoji: "📈", short: "Reprice" },
  "Offer early payment for a discount": { emoji: "🤝", short: "Early-pay" },
  "Input-cost pass-through": { emoji: "🧪", short: "Cost pass-through" },
  "Carrying heavy stock": { emoji: "📦", short: "Stock lever" },
};

// The supplier board holds two views of the same vendor set — a scannable table
// and the benchmark charts — behind one compact toggle, so it's one tab, not two.
function BoardTab({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  return <SupplierBoard all={all} onSelect={onSelect} />;
}

/* ---- Levers modal ---------------------------------------------------------
   The board used to inline a few lever chips per row, which (a) made the table a
   wall of text and (b) drew on the older light-weight insight pass, so the rich
   Probe42 lever engine never showed up there. Now the row carries one button and
   the full set opens centred, grouped by tone, with the evidence behind each. */
// The ONE way a lever count is rendered in any table. Every list — the board,
// the supply chain, an ingredient's vendors — uses this, so the counts can never
// drift apart again and none of them can fall back to the older insight pass.
// When a supplier has no analysable data it says *why*, instead of a bare dash.
export function LeverCell({ e, onOpen }: { e: Entity | undefined; onOpen: (e: Entity) => void }) {
  if (!e) return <span className="text-sm text-slate-300">—</span>;
  const deep = probeLevers(e.cin);
  const n = deep.length || supplierInsights(e).length;
  if (n === 0) {
    return <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
      title={e.cin ? "We hold a CIN for this vendor but haven't pulled its Probe42 report yet" : "Open-market trader with no company registration — no filings exist to analyse"}>
      {e.cin ? "report not pulled" : "no filings"}
    </span>;
  }
  const opps = (deep.length ? deep.filter((l) => l.tone === "opportunity") : supplierInsights(e).filter((i) => i.tone === "opportunity")).length;
  return (
    <button onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
      title={deep.length ? `${n} levers from the full Probe42 filings` : `${n} headline reads — no full report yet`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-teal-700 ring-1 ring-teal-200 transition hover:bg-teal-50 hover:ring-teal-300">
      💡 Check levers
      <span className={`rounded px-1.5 text-[11px] font-extrabold ${opps ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{n}</span>
    </button>
  );
}

const LEV_TONE_ORDER = ["opportunity", "watch", "risk"] as const;
const LEV_TONE_PLURAL: Record<InsightTone, string> = { opportunity: "opportunities", watch: "to watch", risk: "risks" };
function LeversModal({ e, onClose, onOpenProfile }: { e: Entity; onClose: () => void; onOpenProfile: () => void }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const probe = probeLevers(e.cin);
  // Suppliers without a paid Probe report still get the lighter insight pass, so
  // the button never opens an empty box.
  const levers = probe.length
    ? probe.map((l) => ({ tone: l.tone as InsightTone, strength: l.strength, title: l.title, detail: l.detail, evidence: l.evidence ?? [] }))
    : supplierInsights(e).map((i) => ({ tone: i.tone, strength: 2, title: i.title, detail: i.detail, evidence: [] as { label: string; value: string }[] }));
  const health = supplierHealth(e.cin);
  const counts = LEV_TONE_ORDER.map((t) => ({ t, n: levers.filter((l) => l.tone === t).length }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="my-auto w-full max-w-3xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold leading-tight text-slate-900">{fullName(e.legalName, e.brand)}</h2>
              {health != null && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${health >= 65 ? "bg-emerald-100 text-emerald-700" : health >= 50 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{health}/100</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {counts.filter((c) => c.n).map(({ t, n }) => (
                <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1 ${TONE_META[t].bg} ${TONE_META[t].text} ${TONE_META[t].ring}`}>{TONE_META[t].emoji} {n} {n === 1 ? TONE_META[t].label.toLowerCase() : LEV_TONE_PLURAL[t]}</span>
              ))}
              {!probe.length && <span className="text-slate-400">no full Probe42 report yet — headline read only</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4">
          {levers.length === 0 && <p className="py-10 text-center text-sm text-slate-400">No standout lever — this reads as a healthy, fairly-priced vendor.</p>}
          {LEV_TONE_ORDER.map((tone) => {
            const group = levers.filter((l) => l.tone === tone).sort((a, b) => b.strength - a.strength);
            if (!group.length) return null;
            const m = TONE_META[tone];
            return (
              <div key={tone}>
                <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${m.text}`}>{m.emoji} {m.label}</h3>
                <div className="space-y-2">
                  {group.map((l, i) => (
                    <div key={i} className={`rounded-xl p-3.5 ring-1 ${m.bg} ${m.ring}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-bold leading-snug text-slate-900">{l.title}</div>
                        <span className="mt-1 flex shrink-0 gap-0.5" title={`strength ${l.strength}/3`}>
                          {[1, 2, 3].map((s) => <span key={s} className={`h-1.5 w-1.5 rounded-full ${s <= l.strength ? m.dot : "bg-slate-300"}`} />)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{l.detail}</p>
                      {l.evidence.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {l.evidence.map((ev, j) => (
                            <span key={j} className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-0.5 text-[11px] ring-1 ring-slate-200">
                              <span className="text-slate-500">{ev.label}</span><span className="font-mono font-semibold text-slate-800">{ev.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
          <span className="text-[11px] text-slate-400">Generated from this supplier's own filings — every lever traces to a number above.</span>
          <button onClick={onOpenProfile} className="shrink-0 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">Open full deep-dive →</button>
        </div>
      </div>
    </div>
  );
}

// One dense analyst table: every supplier is a row, negotiation metrics are
// columns, and the levers/risks become compact tags. Replaces the old wall of
// look-alike cards — scannable and sortable in one view.
function SupplierBoard({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"levers" | "revenue" | "ebitda" | "dso">("levers");
  const [showLimited, setShowLimited] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const TOP = 10;

  const [leversFor, setLeversFor] = useState<Entity | null>(null);
  // Lever count comes from the full Probe42 engine where we hold a report, and
  // falls back to the lighter insight pass otherwise — so the board's count and
  // the modal always agree.
  const enriched = useMemo(() => all.map((e) => {
    const p = probeLevers(e.cin);
    const n = p.length ? p.length : supplierInsights(e).length;
    const opps = p.length ? p.filter((l) => l.tone === "opportunity").length : supplierInsights(e).filter((i) => i.tone === "opportunity").length;
    return { e, n, opps, deep: p.length > 0 };
  }), [all]);
  const filtered = useMemo(() => {
    let r = enriched;
    if (cat !== "All") r = r.filter((x) => x.e.category === cat);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((x) => `${x.e.brand} ${x.e.legalName ?? ""} ${x.e.cin ?? ""}`.toLowerCase().includes(q));
    return r;
  }, [enriched, cat, query]);

  // Main table = suppliers we can actually analyse — those with financial depth
  // (margins / returns / payment days), whether or not they have a lever. Levered
  // suppliers sort to the top. Only the data-thin ones (revenue-only or no filing)
  // collapse behind "+ Show more".
  const active = useMemo(() => {
    const withData = filtered.filter((x) => hasDepth(x.e));
    return [...withData].sort((a, b) => {
      switch (sort) {
        case "revenue": return (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1);
        case "ebitda": return (ebitdaMarginOf(b.e) ?? -1) - (ebitdaMarginOf(a.e) ?? -1);
        case "dso": return (supDSO(a.e) ?? 1e9) - (supDSO(b.e) ?? 1e9);
        default: return b.n - a.n || (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1);
      }
    });
  }, [filtered, sort]);
  const others = useMemo(() => filtered.filter((x) => !hasDepth(x.e)).sort((a, b) => (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1)), [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <Dropdown label="Category" value={cat} onChange={setCat}
            options={SUP_CATS.map((c) => ({ key: c, label: c === "All" ? `All (${all.length})` : `${c} (${all.filter((e) => e.category === c).length})`, emoji: c === "All" ? undefined : catEmoji(c) }))} />
          {others.length > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-slate-600">
              <input type="checkbox" checked={showLimited} onChange={(e) => setShowLimited(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400" />
              Include {others.length} limited-data vendor{others.length > 1 ? "s" : ""}
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
            className="w-48 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-teal-400" />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400">
            {[["levers", "Most levers"], ["revenue", "Revenue"], ["ebitda", "EBITDA margin"], ["dso", "Collects fastest"]].map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className={`${TBL} min-w-[880px]`}>
          <thead>
            <tr className={THEAD}>
              <Th>Supplier</Th><Th right>Revenue</Th><Th right>EBITDA</Th><Th right>RoCE</Th><Th right>Collects</Th><Th right>Pays</Th><Th center>Levers</Th>
            </tr>
          </thead>
          <tbody>
            {[...(showAll ? active : active.slice(0, TOP)), ...(showLimited ? others : [])].map(({ e }) => (
              <tr key={e.category + e.folder} onClick={() => onSelect(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                <td className="min-w-[240px] px-4 py-3.5">
                  <div className="flex items-start gap-2 font-semibold leading-snug text-slate-900"><span className="shrink-0 leading-relaxed">{catEmoji(e.category)}</span><span>{fullName(e.legalName, e.brand)}</span></div>
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-medium text-slate-900">{fmtCrore(revOf(e))}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-medium text-slate-600">{fmtPct(ebitdaMarginOf(e))}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-medium text-slate-600">{fmtPct(supRoce(e))}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-medium text-slate-500">{fmtDays(supDSO(e))}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-medium text-slate-500">{fmtDays(supDPO(e))}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-center"><LeverCell e={e} onOpen={setLeversFor} /></td>
              </tr>
            ))}
            {active.length === 0 && !showLimited && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No suppliers match this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      {active.length > TOP && (
        <button onClick={() => setShowAll((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:ring-slate-300">
          <span className="text-teal-600">{showAll ? "–" : "+"}</span>
          {showAll ? `Show top ${TOP} only` : `Show ${active.length - TOP} more suppliers`}
        </button>
      )}

      {leversFor && <LeversModal e={leversFor} onClose={() => setLeversFor(null)} onOpenProfile={() => { const t = leversFor; setLeversFor(null); onSelect(t); }} />}
    </div>
  );
}

// A supplier we can actually analyse — has more than just a revenue figure
// (a margin, return, or payment-days signal). Thin/revenue-only vendors collapse.
function hasDepth(e: Entity) {
  return ebitdaMarginOf(e) != null || netMarginOf(e) != null || supRoce(e) != null || supDSO(e) != null || supDPO(e) != null;
}

// Deduped opportunity-lever tags for one supplier's insight list.
function leverTagsOf(ins: Insight[]) {
  const seen = new Set<string>();
  return ins
    .filter((i) => i.tone === "opportunity")
    .map((i) => ({ ...LEVER_TAG[i.title], detail: i.detail }))
    .filter((t) => t.short && !seen.has(t.short) && seen.add(t.short));
}

/* -------- Suppliers · Benchmark tab -------- */

const SUP_CATS = ["All", "RM Vendor", "PM Vendor", "Manufacturer"] as const;

/* ------------------------------------------------------ P2 Competitor view */

type CompCat = "All" | (typeof COMPETITOR_CATEGORIES)[number];
const CAT5_COLOR: Record<string, string> = {
  Sunscreen: "#eb6834", "Face Serums": "#4a3aa7", Bodywash: "#2a78d6", "Body Scrub": "#e34948", "Body Lotion": "#1baf7a",
};

function CompetitorView() {
  const all = useMemo(() => competitorRows(), []);
  const [cat, setCat] = useState<CompCat>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CompetitorRow | null>(null);
  const [view, setView] = useState<"overview" | "table">("overview");
  const { open: openCompetitor, back } = useProfileNav(selected, setSelected);

  const rows = useMemo(() => {
    let r = all;
    if (cat !== "All") r = r.filter((e) => e.categories.includes(cat));
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((e) => `${e.brand} ${e.legalName ?? ""} ${e.parent ?? ""}`.toLowerCase().includes(q));
    return [...r].sort((a, b) => (revOf(b) ?? -1) - (revOf(a) ?? -1));
  }, [all, cat, query]);
  const revCr = all.reduce((s, e) => s + (toCrore(revOf(e)) ?? 0), 0);

  if (selected) return <CompanyPage entity={selected} onBack={back} kind="competitor" />;

  return (
    <main className="mx-auto max-w-[1680px] px-4 pb-16 sm:px-6">
      <ModuleHero emoji="🥊" title="Competitor Benchmarking"
        subtitle="How rival BPC brands stack up on revenue, funding, pricing & the digital shelf"
        tint="from-[#6d28d9] to-[#db2777]"
        stats={[
          { label: "Brands", value: String(all.length) },
          { label: "Categories", value: String(COMPETITOR_CATEGORIES.length) },
          { label: "Revenue in view", value: crStr(revCr) },
          { label: "With deals", value: String(all.filter((e) => e.competitor?.materialEvent).length) },
        ]} />
      <div className="mt-5 mb-4"><SubTabs tabs={[{ key: "overview", label: "Overview", emoji: "📊" }, { key: "table", label: "Directory", emoji: "📇" }]} value={view} onChange={(v) => setView(v as typeof view)} /></div>

      {view === "overview" && <CompetitorOverview all={all} onSelect={openCompetitor} />}

      {view === "table" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(["All", ...COMPETITOR_CATEGORIES] as CompCat[]).map((c) => (
                <button key={c} onClick={() => setCat(c)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${cat === c ? "bg-violet-50 text-violet-700 ring-violet-300" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"}`}>
                  {c}<span className="ml-1.5 text-xs text-slate-400">{c === "All" ? all.length : all.filter((e) => e.categories.includes(c)).length}</span>
                </button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="w-56 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-violet-400" />
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className={`${TBL} min-w-[980px]`}>
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><Th>Brand</Th><Th>Categories</Th><Th right>Revenue</Th><Th right>Funding</Th><Th>Stage</Th><Th>Latest deal / event</Th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.cin || e.brand} onClick={() => openCompetitor(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-violet-50/40">
                    <td className="px-4 py-3"><div className="font-medium leading-snug text-slate-900">{fullName(e.legalName, e.brand)}</div>{e.parent && <div className="truncate text-xs text-slate-400">↳ {e.parent}</div>}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{e.categories.map((c) => <span key={c} className="rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: `${CAT5_COLOR[c] ?? "#94a3b8"}18`, color: CAT5_COLOR[c] ?? "#64748b" }}>{c}</span>)}</div></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">{fmtCrore(revOf(e))}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{fmtUSD(e.competitor?.fundingUSD ?? null)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{e.competitor?.stage ?? "—"}</td>
                    <td className="max-w-[260px] px-4 py-3 text-slate-600"><span className="line-clamp-1">{e.competitor?.materialEvent ?? "—"}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <EmptyRow cols={6} />}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function fundingBucket(stage: string | null | undefined): "Acquired" | "VC-funded" | "Unfunded" | "Unknown" {
  const s = (stage ?? "").toLowerCase();
  if (s.includes("acquired")) return "Acquired";
  if (s.includes("unfunded") || s.includes("subsidiary")) return "Unfunded";
  if (/series|seed|funding raised|funded/.test(s)) return "VC-funded";
  return "Unknown";
}
const BUCKET_COLOR = { Acquired: "#1baf7a", "VC-funded": "#2a78d6", Unfunded: "#eda100", Unknown: "#cbd5e1" } as const;

function CompetitorOverview({ all, onSelect }: { all: CompetitorRow[]; onSelect: (e: CompetitorRow) => void }) {
  const byName = useMemo(() => new Map(all.map((e) => [e.brand, e])), [all]);
  const pick = (l: string) => byName.get(l) && onSelect(byName.get(l)!);
  const rank = (get: (e: CompetitorRow) => number | null, color: string, n = 10): Slice[] =>
    all.map((e) => ({ e, v: get(e) })).filter((x): x is { e: CompetitorRow; v: number } => x.v != null && x.v > 0)
      .sort((a, b) => b.v - a.v).slice(0, n).map(({ e, v }) => ({ label: e.brand, value: Math.round(v * 10) / 10, color }));

  const metrics: RankMetric[] = [
    { key: "revenue", label: "Revenue", emoji: "💵", unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${v} Cr`), note: "Latest disclosed revenue, ₹ crore.", rows: rank((e) => toCrore(revOf(e)), "#6d28d9") },
    { key: "discount", label: "Discounting", emoji: "🏷️", unit: (v) => `${v}%`, note: "Avg % off MRP on their live Nykaa shelf — high = liquidation or heavy marketing.", rows: rank((e) => e.shelf?.avgDiscountPct ?? null, "#eb6834") },
    { key: "traction", label: "Reviews", emoji: "🔥", unit: (v) => `${v}M reviews`, note: "Total Nykaa reviews (millions) — a sales-velocity proxy.", rows: rank((e) => (e.shelf?.totalReviews != null ? e.shelf.totalReviews / 1e6 : null), "#2a78d6") },
    { key: "rating", label: "Rating", emoji: "⭐", unit: (v) => `${v.toFixed(1)}★`, note: "Average customer rating on Nykaa (out of 5).", rows: rank((e) => e.shelf?.avgRating ?? null, "#1baf7a") },
  ];

  // Profitability — the D2C reality is that many rivals burn cash. A diverging column
  // per brand (green = profitable, red = loss-making) tells that story at a glance.
  const marginCols: Slice[] = all
    .map((e) => ({ e, v: ebitdaMarginOf(e) }))
    .filter((x): x is { e: CompetitorRow; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v)
    .map(({ e, v }) => ({ label: e.brand, value: Math.round(v * 10) / 10, color: v >= 0 ? "#1baf7a" : "#e34948" }));
  const profitable = marginCols.filter((d) => d.value >= 0).length;

  const catRows: Slice[] = COMPETITOR_CATEGORIES.map((c) => ({ label: c, value: all.filter((e) => e.categories.includes(c)).length, color: CAT5_COLOR[c] ?? "#94a3b8" })).sort((a, b) => b.value - a.value);
  const fundingGroups = (["Acquired", "VC-funded", "Unfunded", "Unknown"] as const).map((k) => ({ bucket: k, brands: all.filter((e) => fundingBucket(e.competitor?.stage) === k) })).filter((g) => g.brands.length);
  const events = useMemo(() => all.filter((e) => e.competitor?.materialEvent), [all]);

  return (
    <div className="space-y-4">
      <Card title="🥊 Compare rivals" sub="One chart — switch the metric to rank every brand" accent="#6d28d9">
        <MetricRank metrics={metrics} onBar={pick} />
      </Card>

      {marginCols.length > 0 && (
        <Card title="💹 Who actually makes money?" sub={`EBITDA margin per brand · green = profitable, red = burning cash · ${profitable} of ${marginCols.length} in the black · hover for the number`} accent="#1baf7a">
          <div className="overflow-x-auto pb-1">
            <div style={{ minWidth: Math.max(640, marginCols.length * 54) }}>
              <Columns data={marginCols} valueLabel={(v) => `${v}%`} height={200} />
            </div>
          </div>
        </Card>
      )}

      <Card title="📚 Category presence" sub="how many rivals we track per BPC category" accent="#e34948">
        <HBars data={catRows} valueLabel={(v) => `${v} brand${v === 1 ? "" : "s"}`} />
      </Card>

      <Card title="💰 Funding status" sub="which rivals are funded, acquired, or bootstrapped — click a brand" accent="#4a3aa7">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {fundingGroups.map(({ bucket, brands }) => (
            <div key={bucket}>
              <div className="mb-1.5 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLOR[bucket] }} /><span className="text-sm font-semibold text-slate-700">{bucket}</span><span className="text-xs text-slate-400">{brands.length}</span></div>
              <div className="flex flex-wrap gap-1.5">
                {brands.map((e) => <button key={e.cin || e.brand} onClick={() => onSelect(e)} title={e.competitor?.materialEvent ?? undefined} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-900">{e.brand}</button>)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="📰 Recent deals & events" sub="fundraises & acquisitions across the category" accent="#db2777">
        {events.length === 0 ? <div className="text-sm text-slate-400">No material events tracked.</div> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {events.map((e) => (
              <button key={e.cin || e.brand} onClick={() => onSelect(e)} className="rounded-xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 transition hover:bg-slate-100">
                <div className="text-sm font-medium text-slate-800">{e.brand}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{e.competitor?.materialEvent}</div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------- P3 Delivery partners view */

function DeliveryView() {
  const { partners, delhivery: d } = DELIVERY;
  const cr = (inr: number | null) => (inr == null ? 0 : Math.round(inr / 1e7));
  const nm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const listedMap = useMemo(() => new Map(partners.map((p) => [nm(p.brand), p.listed])), [partners]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [trendKey, setTrendKey] = useState("");
  const { open: openPartner, back } = useProfileNav(selected, setSelected);
  const s = (fy: string) => "'" + fy.split("-")[1];

  // Every delivery partner now carries a full multi-year profile — build a real
  // 5-way comparison from the latest year of each.
  const rows = useMemo(() => {
    return DATA.entities.filter((e) => e.category === "Delivery Partners" && e.profile?.years?.length)
      .map((e) => {
        const y = e.profile!.years[e.profile!.years.length - 1];
        return { e, fy: y.fy, rev: cr(y.revenueINR), net: cr(y.netProfitINR), margin: y.ebitdaMarginPct, dso: y.receivableDays, listed: !!listedMap.get(nm(e.brand)) };
      })
      .sort((a, b) => b.rev - a.rev);
  }, [listedMap]);

  const profitable = rows.filter((r) => r.net >= 0).length;
  const marginBars: Slice[] = rows.map((r) => ({ label: r.e.brand, value: Math.round(r.margin ?? 0), color: (r.margin ?? 0) >= 0 ? "#1baf7a" : "#e34948" }));
  const revBars: Slice[] = rows.map((r) => ({ label: r.e.brand, value: r.rev, color: "#0369a1" }));

  const delhiveryMetrics: TrendMetric2[] = [
    { key: "revenue", label: "Revenue", emoji: "💵", kind: "area", color: "#0d9488", unitWord: "₹ crore", unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${v} Cr`), slices: d.trend.map((t) => ({ label: s(t.fy), value: cr(t.revenueINR), color: "#0d9488" })) },
    { key: "profit", label: "Net profit", emoji: "📈", kind: "columns", color: "#1baf7a", unitWord: "₹ crore", unit: (v) => (v >= 0 ? `₹${v} Cr` : `-₹${Math.abs(v)} Cr`), slices: d.trend.map((t) => ({ label: s(t.fy), value: cr(t.netProfitINR), color: (t.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) },
    { key: "dso", label: "Collection days", emoji: "📥", kind: "area", color: "#2a78d6", unitWord: "days to collect", unit: (v) => `${Math.round(v)} days`, slices: d.ratioTrend.map((t) => ({ label: s(t.fy), value: t.dso ?? 0, color: "#2a78d6" })) },
    { key: "margin", label: "EBITDA margin", emoji: "💰", kind: "columns", color: "#1baf7a", unitWord: "%", unit: (v) => `${v}%`, slices: d.ratioTrend.map((t) => ({ label: s(t.fy), value: t.ebitdaMarginPct ?? 0, color: (t.ebitdaMarginPct ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) },
  ];

  if (selected) return <CompanyPage entity={selected} onBack={back} kind="delivery" />;

  return (
    <main className="mx-auto max-w-[1680px] px-4 pb-16 sm:px-6">
      <ModuleHero emoji="🚚" title="Delivery Partners"
        subtitle="Last-mile & logistics partners — financial strength and the receivables (DSO) credit lever"
        tint="from-[#0369a1] to-[#0d9488]"
        stats={[
          { label: "Partners", value: String(rows.length) },
          { label: "Profitable", value: `${profitable} of ${rows.length}` },
          { label: "Biggest", value: rows[0] ? crStr(rows[0].rev) : "—" },
          { label: "Listed", value: String(rows.filter((r) => r.listed).length) },
        ]} />

      <div className="mt-6 space-y-4">
        <Card title="💹 Who's financially healthy?" sub={`EBITDA margin by partner, latest year (FY${rows[0]?.fy ?? ""}) — green = profitable, red = burning cash. A healthier partner is more reliable and less likely to hike rates.`} accent="#1baf7a">
          <Columns data={marginBars} valueLabel={(v) => `${v}%`} height={190} />
        </Card>

        <Card title="🏁 Partner scorecard" sub="latest-year financials · click a partner for its full 5-year profile" accent="#0369a1">
          <div className="overflow-x-auto">
            <table className={`${TBL} min-w-[720px]`}>
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <Th>Partner</Th><Th>Status</Th><Th right>Revenue</Th><Th right>Net profit</Th><Th right>EBITDA %</Th><Th right>Collects</Th><Th>Health</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.e.folder} onClick={() => openPartner(r.e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                    <td className="px-4 py-3"><div className="font-medium leading-snug text-slate-900">{fullName(r.e.legalName, r.e.brand)}</div></td>
                    <td className="px-4 py-3">{r.listed ? <Pill cls="text-emerald-700 bg-emerald-50 ring-emerald-200">Listed</Pill> : <Pill cls="text-slate-600 bg-slate-100 ring-slate-200">Private</Pill>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">{crStr(r.rev)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${r.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{r.net >= 0 ? "+" : "−"}{crStr(Math.abs(r.net))}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{r.margin != null ? `${Math.round(r.margin)}%` : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-500">{r.dso != null ? `${Math.round(r.dso)} d` : "—"}</td>
                    <td className="px-4 py-3">{r.net >= 0
                      ? <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Profitable</span>
                      : <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200">Loss-making</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="📊 Revenue & scale" sub="latest-year revenue, ₹ crore — Delhivery is ~3–4× its nearest rival" accent="#0d9488">
          <HBars data={revBars} valueLabel={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${v} Cr`)} onBar={(l) => { const r = rows.find((x) => x.e.brand === l); if (r) openPartner(r.e); }} />
        </Card>

        {(() => {
          const trendRow = rows.find((r) => r.e.folder === trendKey) ?? rows[0];
          const isDelhivery = !!trendRow && /delhivery/i.test(trendRow.e.brand);
          const trendMetrics: TrendMetric2[] = isDelhivery ? delhiveryMetrics : buildTrendMetrics(trendRow.e);
          return (
            <Card title="📈 Partner track record" sub="pick any partner to see its multi-year performance — switch the metric for revenue, profit, receivables & margin" accent="#0d9488">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Dropdown label="Partner" value={trendRow?.e.folder ?? ""} onChange={setTrendKey} options={rows.map((r) => ({ key: r.e.folder, label: r.e.brand, emoji: r.listed ? "📈" : "🚚" }))} />
                {trendRow && <button onClick={() => openPartner(trendRow.e)} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200">Open full profile →</button>}
              </div>
              {trendMetrics.length > 0
                ? <MetricTrend key={trendRow?.e.folder} metrics={trendMetrics} height={260} />
                : <div className="py-10 text-center text-sm text-slate-400">Only one year of data for this partner — open its full profile for the details.</div>}
              {isDelhivery && (
                <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
                  Delhivery turned profitable in FY {d.latestFY} (+{crStr(cr(d.netProfitINR))}) after years of losses. It's the only listed partner and by far the largest.
                </div>
              )}
            </Card>
          );
        })()}

        <Card title="🏦 The credit lever" sub="what this means for mcAFFEINE" accent="#0369a1">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: "📥", t: "Collection days = your terms lever", d: `Partners collect from their clients in ${Math.min(...rows.map((r) => Math.round(r.dso ?? 999)))}–${Math.max(...rows.map((r) => Math.round(r.dso ?? 0)))} days. The longer they let clients pay, the more room to negotiate our own terms out.` },
              { icon: "⚠️", t: `${rows.length - profitable} of ${rows.length} partners are loss-making`, d: "Cash-burning partners can hike rates or cut service under pressure — lean on the profitable, well-capitalised ones for critical lanes." },
              { icon: "🏆", t: "Delhivery is the safe anchor", d: "Only listed partner, largest by revenue, and now profitable — the most reliable base to route volume through while negotiating the rest." },
            ].map((x) => (
              <div key={x.t} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <span className="text-lg leading-none">{x.icon}</span>
                <div><div className="text-sm font-semibold text-slate-800">{x.t}</div><div className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{x.d}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}

/* ------------------------------------------- company page (single dense) */

type CompanyKind = "supplier" | "competitor" | "delivery";
type CardDesc = { key: string; title: string; sub?: string; node: React.ReactNode };

function CompanyPage({ entity: e, onBack, kind }: { entity: Entity; onBack: () => void; kind: CompanyKind }) {
  useEffect(() => { window.scrollTo(0, 0); }, [e.folder, e.category]);
  const [deep, setDeep] = useState(false);
  const canDeepDive = hasDeepDive(e.cin);
  const trend = useMemo(() => buildTrendMetrics(e), [e]);
  const ins = useMemo(() => supplierInsights(e), [e]);
  const cards = useMemo(() => companyCards(e, kind), [e, kind]);
  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const cost = cardByKey.get("cost");
  // The page opens on the negotiation spine (fitness/risk, balance sheet, market
  // leverage); the registry & reference cards fold behind one expander so nothing
  // is lost but the first screen stays focused.
  const SPINE_KEYS = new Set(["health", "balance", "market"]);
  const spine = cards.filter((c) => c.key !== "cost" && SPINE_KEYS.has(c.key));
  const rest = cards.filter((c) => c.key !== "cost" && !SPINE_KEYS.has(c.key));
  const restHint = rest.map((c) => c.title.replace(/^[^A-Za-z]+/, "").split(" · ")[0]).join(" · ");

  const py = latestYear(e);
  const room = negotiationRoom(e);
  const flags = e.pdf?.riskFlags ?? [];
  const roce = py?.rocePct ?? e.probe?.roce ?? null;
  const backLabel = kind === "competitor" ? "competitors" : kind === "delivery" ? "delivery" : "suppliers";
  const parentGroup = isParentBackedProfile(e) ? e.profile?.parent ?? "its parent group" : null;

  const f = e.financials;
  const hasReported = revOf(e) != null || f.ebitdaINR != null || f.netProfitINR != null || f.employeeCount != null || f.paidUpCapitalINR != null || f.authorizedCapitalINR != null || f.revenueCAGR1yrPct != null || f.revenueCAGR3yrPct != null || f.revenueCAGR5yrPct != null;
  const hasFiling = !!(e.profile?.years?.length || e.pdf || e.probe);
  const noFinancials = !hasFiling && !hasReported;

  const metrics: { label: string; value: string; tint: string }[] =
    kind === "competitor"
      ? [
          { label: "Revenue", value: fmtCrore(revOf(e)), tint: "text-teal-200" },
          { label: "Funding", value: fmtUSD(e.competitor?.fundingUSD ?? null), tint: "text-amber-200" },
          { label: "Rating", value: e.shelf?.avgRating != null ? `${e.shelf.avgRating}★` : "—", tint: "text-emerald-200" },
          { label: "Discount", value: fmtPct(e.shelf?.avgDiscountPct ?? null), tint: "text-rose-200" },
        ]
      : [
          { label: "Revenue", value: fmtCrore(revOf(e)), tint: "text-teal-200" },
          { label: "EBITDA", value: fmtPct(ebitdaMarginOf(e)), tint: "text-amber-200" },
          { label: "RoCE", value: fmtPct(roce), tint: "text-emerald-200" },
          { label: "Collects", value: fmtDays(py?.receivableDays ?? e.probe?.receivableDays ?? null), tint: "text-sky-200" },
        ];

  return (
    <main className="mx-auto max-w-[1680px] px-4 pb-16 sm:px-6">
      <button onClick={onBack} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700">
        <span className="text-base leading-none">←</span> Back to {backLabel}
      </button>

      <div className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b3b39] via-[#0d9488] to-[#0891b2] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold ring-1 ring-white/25">{kind === "supplier" ? catEmoji(e.category) : e.brand.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="text-2xl font-bold leading-tight tracking-tight">{fullName(e.legalName, e.brand)}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20">{catEmoji(e.category)} {e.category}</span>
                {suppliedItems(e.folder).length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-teal-400/25 px-2 py-0.5 text-xs font-medium text-teal-50 ring-1 ring-teal-200/40" title={`Supplies mcAFFEINE: ${suppliedItems(e.folder).join(", ")}`}>🧬 Supplies: {suppliedItems(e.folder).slice(0, 2).join(", ")}{suppliedItems(e.folder).length > 2 ? ` +${suppliedItems(e.folder).length - 2}` : ""}</span>}
                {kind !== "competitor" && room !== "Unknown" && <span className="rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20">Negotiation room: {room}</span>}
                {e.pdf && (flags.length ? <span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-xs font-medium text-rose-100 ring-1 ring-rose-300/30">🚩 {flags.length} risk flag{flags.length > 1 ? "s" : ""}</span> : <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-xs font-medium text-emerald-100 ring-1 ring-emerald-300/30">✓ No risk flags</span>)}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-3 text-xs">
                {e.website && <a href={/^https?:/.test(e.website) ? e.website : `https://${e.website}`} target="_blank" rel="noreferrer" className="text-teal-100 hover:underline">🌐 {e.website.replace(/^https?:\/\//, "")}</a>}
                {e.tracxnUrl && <a href={e.tracxnUrl} target="_blank" rel="noreferrer" className="text-white/70 hover:text-teal-100 hover:underline">🔗 Tracxn record</a>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {metrics.map((k) => (
              <div key={k.label} className="rounded-2xl bg-white/10 px-4 py-2.5 ring-1 ring-white/20">
                <div className={`text-[10px] font-medium uppercase tracking-wide ${k.tint}`}>{k.label}</div>
                <div className="text-lg font-bold tabular-nums">{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {canDeepDive && (
        <button onClick={() => setDeep(true)} className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-3.5 text-left text-white shadow-sm transition hover:brightness-110">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">📊 Open the financial deep-dive</span>
            <span className="block text-xs text-teal-50">Full MCA accounts, peer comparison, payment behaviour &amp; risk flags — all from one Probe42 report.</span>
          </span>
          <span className="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium ring-1 ring-white/30">View →</span>
        </button>
      )}

      {parentGroup && <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-800 ring-1 ring-sky-200">ℹ️ {e.brand} has no standalone financials — the trends & numbers below are <span className="font-medium">{parentGroup}</span>'s consolidated group filing, not {e.brand} alone.</div>}
      {noFinancials && <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">No financial data is available for this company in Tracxn — only the registry basics below.</div>}

      <div className="mt-4 space-y-4">
        {trend.length > 0 && (
          <Card title="📈 Performance over time" sub="One chart — switch the metric" accent="#0d9488"><MetricTrend metrics={trend} /></Card>
        )}
        {ins.length > 0 && (
          <Card title="💡 Negotiation levers & risks" sub="from this company's own numbers · hover a tag for detail" accent="#eda100">
            <LeverStrip ins={ins} />
          </Card>
        )}
        {cost && <Card title={cost.title} sub={cost.sub} accent="#0d9488">{cost.node}</Card>}
        {kind === "supplier" && (
          <Card title="🏁 How it stacks up against peers" sub="ranked against the same-category vendors we track" accent="#6d28d9"><PeerCompareCard e={e} /></Card>
        )}
        {/* negotiation spine: fitness/risk, balance sheet, market leverage */}
        {spine.length > 0 && (
          <div className="gap-4 [column-fill:balance] sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {spine.map((c) => <Card key={c.key} title={c.title} sub={c.sub} accent="#0d9488">{c.node}</Card>)}
          </div>
        )}
        {/* registry & reference detail — one screen away, nothing dropped */}
        {rest.length > 0 && (
          <Expander count={rest.length} hint={restHint}>
            <div className="gap-4 [column-fill:balance] sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {rest.map((c) => <Card key={c.key} title={c.title} sub={c.sub} accent="#0d9488">{c.node}</Card>)}
            </div>
          </Expander>
        )}
      </div>

      {deep && canDeepDive && <DeepDive entity={e} onClose={() => setDeep(false)} />}
    </main>
  );
}

// Build the non-trend cards for a company (trends are handled by MetricTrend).
function companyCards(e: Entity, kind: CompanyKind): CardDesc[] {
  const c = e.competitor;
  const cards: CardDesc[] = [];

  const details = kind === "competitor" ? (
    <dl className="space-y-2 text-sm">
      <Row k="Legal entity" v={e.legalName ?? "—"} /><Row k="CIN" v={e.cin ?? "—"} mono />
      <Row k="HQ" v={c?.hqCity ?? "—"} /><Row k="Founders" v={c?.founders?.length ? c.founders.join(", ") : "—"} />
      <Row k="Latest round" v={c?.latestRound?.name ? `${c.latestRound.name}${c.latestRound.date ? " · " + c.latestRound.date : ""}` : "—"} />
      <Row k="Sells in" v={c?.geoServed?.length ? c.geoServed.slice(0, 6).join(", ") : "—"} /><Row k="Website" v={e.website ?? "—"} />
    </dl>
  ) : (
    <dl className="space-y-2 text-sm">
      <Row k="Category" v={e.category} /><Row k="CIN" v={e.cin ?? "—"} mono /><Row k="PAN" v={e.pan ?? "—"} mono />
      <Row k="Entity type" v={e.entityType ?? "—"} /><Row k="Incorporated" v={fmtDate(e.incorporationDate)} /><Row k="Registrar status" v={e.statusAtRegistrar ?? "—"} />
      <Row k="Location" v={[(e.state ?? "").replace(/\s*\(implied\)\s*/i, "").trim() || null, e.city].filter(Boolean).join(" · ") || "—"} />
      <Row k="Industry" v={e.industry ?? "—"} /><Row k="Auditor" v={e.auditor ?? "—"} /><Row k="LEI" v={e.lei ?? "—"} mono /><Row k="Parent" v={e.parent ?? "—"} />
    </dl>
  );
  cards.push({ key: "details", title: "🏢 Company details", node: details });

  // key numbers card — a wide, well-filled stat grid (latest year + registry base)
  const py = latestYear(e);
  const f = e.financials;
  const cagr = [f.revenueCAGR1yrPct, f.revenueCAGR3yrPct, f.revenueCAGR5yrPct];
  // Only the scalar facts NOT already shown in the hero, trend, fitness bars or
  // balance-sheet chart — the ratio story is now visual, so this stays short.
  const stats: { label: string; value: string }[] = [];
  if (f.ebitdaINR != null) stats.push({ label: "EBITDA", value: fmtCrore(f.ebitdaINR) });
  if (py?.roePct != null) stats.push({ label: "RoE", value: fmtPct(py.roePct) });
  if (cagr.some((v) => v != null)) stats.push({ label: "Rev CAGR 1/3/5y", value: cagr.map((v) => fmtPct(v)).join(" / ") });
  if (supDPO(e) != null) stats.push({ label: "Pays suppliers in", value: fmtDays(supDPO(e)) });
  if (f.employeeCount != null) stats.push({ label: "Employees", value: fmtInt(f.employeeCount) });
  if (f.paidUpCapitalINR != null) stats.push({ label: "Paid-up capital", value: fmtCrore(f.paidUpCapitalINR) });
  if (stats.length > 0) cards.push({ key: "keynums", title: `📊 Other key numbers${py ? ` · FY${py.fy}` : ""}`, node: <StatTable rows={stats} /> });

  // Balance sheet — all positive ₹Cr magnitudes, so a ranked bar reads better than a tile wall.
  if (py && (py.totalDebtINR != null || py.tradeReceivablesINR != null || py.cashINR != null || py.inventoryINR != null)) {
    const bsBars = [
      { label: "Total equity", value: toCrore(py.totalEquityINR), color: "#0d9488" },
      { label: "Total debt", value: toCrore(py.totalDebtINR), color: "#e34948" },
      { label: "Cash", value: toCrore(py.cashINR), color: "#2a78d6" },
      { label: "Receivables", value: toCrore(py.tradeReceivablesINR), color: "#eda100" },
      { label: "Payables", value: toCrore(py.tradePayablesINR), color: "#eb6834" },
      { label: "Inventory", value: toCrore(py.inventoryINR), color: "#4a3aa7" },
    ].filter((d): d is Slice => d.value != null && d.value > 0);
    if (bsBars.length) cards.push({ key: "balance", title: `⚖️ Balance sheet · FY${py.fy}`, sub: "₹ crore", node: <HBars data={bsBars} valueLabel={crStr} /> });
  }

  // Cash flow — signed by nature (investing/financing usually negative), so ± columns show the direction.
  if (py && (py.cashFromOpsINR != null || py.cashFromInvestingINR != null || py.cashFromFinancingINR != null)) {
    const cfCols = [
      { label: "Operating", value: toCrore(py.cashFromOpsINR), color: "#0d9488" },
      { label: "Investing", value: toCrore(py.cashFromInvestingINR), color: "#2a78d6" },
      { label: "Financing", value: toCrore(py.cashFromFinancingINR), color: "#eda100" },
    ].filter((d): d is Slice => d.value != null);
    if (cfCols.length) cards.push({ key: "cashflow", title: `💵 Cash flow · FY${py.fy}`, sub: "₹ crore · a bar below the line means cash went out", node: <Columns data={cfCols} valueLabel={crStr} height={150} /> });
  }

  // cost structure (full-width chart in the page, pulled out of the masonry)
  if (e.profile) {
    const cs = e.profile.costStructure;
    const cr = (v: number | null) => Math.round((v ?? 0) / 1e7);
    const costBars = [
      { label: "Materials", value: cr(cs.materialsINR), color: "#0d9488" }, { label: "Employee", value: cr(cs.employeeINR), color: "#4a3aa7" },
      { label: "Marketing", value: cr(cs.marketingINR), color: "#eda100" }, { label: "Freight", value: cr(cs.freightINR), color: "#2a78d6" },
      { label: "Finance", value: cr(cs.financeINR), color: "#e34948" }, { label: "Depreciation", value: cr(cs.depreciationINR), color: "#eb6834" },
    ].filter((d) => d.value > 0);
    if (costBars.length) cards.push({ key: "cost", title: `🧾 Cost structure${cs.fy ? ` · FY${cs.fy}` : ""}`, node: <HBars data={costBars} valueLabel={(v) => `₹${v.toLocaleString("en-IN")} Cr`} /> });
  }

  const fit = fitnessAxes(e);
  if (fit.length >= 2 || e.pdf) cards.push({ key: "health", title: "🩺 Financial fitness & risk", sub: fit.length >= 2 ? "each bar scored 0–100 · green = strong, red = weak · hover for how it's scored" : undefined, node: <HealthRiskBody e={e} fit={fit} /> });

  if (e.shelf) {
    cards.push({ key: "shelf", title: `🛒 Live shelf · ${e.shelf.channels.join(", ")}`, sub: e.shelf.scrapedAt ? `scraped ${fmtDate(e.shelf.scrapedAt)}` : undefined, node: (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Products" value={String(e.shelf.skuCount)} /><Stat label="Avg rating" value={e.shelf.avgRating != null ? `${e.shelf.avgRating} ★` : "—"} />
          <Stat label="Avg discount" value={fmtPct(e.shelf.avgDiscountPct)} /><Stat label="Reviews" value={fmtInt(e.shelf.totalReviews)} />
        </div>
        {e.shelf.topSku?.name && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-medium text-slate-500">Hero SKU (most-reviewed)</div>
            <div className="mt-0.5 text-slate-800">{e.shelf.topSku.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">{e.shelf.topSku.rating != null ? `${e.shelf.topSku.rating}★ · ` : ""}{fmtInt(e.shelf.topSku.reviewCount)} reviews{e.shelf.topSku.priceINR != null ? ` · ₹${e.shelf.topSku.priceINR}` : ""}</div>
          </div>
        )}
      </>
    ) });
  }

  if (e.profile) {
    const p = e.profile;
    if (p.parent || p.subsidiaries.length || p.capTable.founders.length || p.capTable.promoterPct != null) {
      cards.push({ key: "ownership", title: "🏛️ Ownership & structure", node: (
        <>
          <dl className="space-y-2 text-sm">
            {p.parent && <Row k="Parent / group" v={p.parent} />}
            {p.capTable.promoterPct != null && <Row k="Promoter / public" v={`${p.capTable.promoterPct}% / ${p.capTable.publicPct ?? "—"}%`} />}
            {p.capTable.founders.length > 0 && <Row k="Founders" v={p.capTable.founders.join(", ")} />}
          </dl>
          {p.subsidiaries.length > 0 && <div className="mt-2"><div className="mb-1 text-xs text-slate-500">Subsidiaries</div><div className="flex flex-wrap gap-1.5">{p.subsidiaries.map((s) => <span key={s} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">{s}</span>)}</div></div>}
        </>
      ) });
    }
    if (p.acquisitions.length) cards.push({ key: "ma", title: "🤝 M&A", node: (
      <div className="space-y-1">{p.acquisitions.map((a, i) => <div key={i} className="rounded-lg bg-violet-50 p-2.5 text-sm ring-1 ring-violet-200"><span className="font-medium text-violet-900">{a.role === "acquired" ? "Acquired by" : "Acquired"} {a.counterparty ?? "—"}</span><span className="text-violet-700"> {[a.stake, a.amountINR ? fmtCrore(a.amountINR) : null, a.date].filter(Boolean).join(" · ")}</span></div>)}</div>
    ) });
    if (p.directors.length) cards.push({ key: "board", title: "👔 Board", node: (
      <div className="space-y-1">{p.directors.map((d, i) => <div key={i} className="flex justify-between gap-4 text-sm"><span className="text-slate-800">{d.name}</span><span className="text-right text-slate-400">{d.designation ?? ""}</span></div>)}</div>
    ) });
    if (p.loans.length) cards.push({ key: "loans", title: "🏦 Loans & charges", node: (
      <div className="space-y-1">{p.loans.map((l, i) => <div key={i} className="flex justify-between gap-4 text-sm"><span className="truncate text-slate-800">{l.lender}</span><span className="shrink-0 font-mono text-slate-500">{l.amountINR ? fmtCrore(l.amountINR) : "—"}{l.status ? ` · ${l.status}` : ""}</span></div>)}</div>
    ) });
    if (p.competitors.length) cards.push({ key: "peers", title: "🥊 Comparable companies", node: (
      <div className="flex flex-wrap gap-1.5">{p.competitors.map((cn) => <span key={cn} className="rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800 ring-1 ring-teal-100">{cn}</span>)}</div>
    ) });
  }

  if (c?.investors?.length) cards.push({ key: "investors", title: "🤝 Investors", node: (
    <div className="flex flex-wrap gap-1.5">{c.investors.map((inv) => <span key={inv} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{inv}</span>)}</div>
  ) });

  if (c?.materialEvent) cards.push({ key: "event", title: "📰 Latest material event", node: <p className="text-sm leading-relaxed text-slate-700">{c.materialEvent}</p> });

  const news = newsOf(e.folder);
  if (news) cards.push({ key: "news", title: "📰 News & signals", sub: "notable developments sourced from the open web · see each item's date", node: <NewsBody n={news} /> });

  const market = marketOfFolder(e.folder);
  if (market.length) cards.push({ key: "market", title: "🌐 Market structure", sub: "how many credible suppliers exist for what they sell us — who holds the pricing power (L2)", node: <MarketBody entries={market} /> });

  if (e.research) cards.push({ key: "research", title: "🔎 Research", node: <ResearchBody r={e.research} /> });

  return cards;
}

function MarketBody({ entries }: { entries: MarketEntry[] }) {
  return (
    <div className="space-y-2.5">
      {entries.map((m) => {
        const meta = CONC_META[m.concentration];
        const lev = LEV_META[m.leverage];
        return (
          <div key={m.item} className={`rounded-xl ${meta.bg} p-3 ring-1 ${meta.ring}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900" title={m.item}>{m.item}</div>
                {m.inci && <div className="truncate text-[11px] text-slate-500" title={m.inci}>{m.inci}</div>}
              </div>
              <span className={`shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold ${meta.text}`} title={meta.blurb}>{meta.emoji} {meta.label}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium ${meta.text}`}>{lev.emoji} {lev.label}</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] text-slate-600" title={m.indiaSuppliers.join(" · ")}>🇮🇳 {m.indiaBand} in India</span>
              {m.priceINRPerKg && !m.priceINRPerKg.includes("not found") && <span title={[m.priceNote, m.priceSource].filter(Boolean).join(" · ")} className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-orange-200">💰 {m.priceINRPerKg}</span>}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{m.implication}</p>
            {m.sources.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{m.sources.slice(0, 3).map((s, i) => <a key={i} href={s} target="_blank" rel="noreferrer" className="text-[10px] text-slate-400 underline decoration-slate-300 hover:text-teal-600">src{i + 1}</a>)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function NewsBody({ n }: { n: SupplierNews }) {
  const sigTone: Record<string, string> = {
    legal: "bg-rose-50 text-rose-700 ring-rose-200",
    distress: "bg-rose-50 text-rose-700 ring-rose-200",
    regulatory: "bg-amber-50 text-amber-700 ring-amber-200",
    other: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <div className="space-y-3">
      {n.summary && <p className="text-sm leading-relaxed text-slate-600">{n.summary}</p>}
      {n.signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {n.signals.map((s, i) => (
            <a key={i} href={s.url || undefined} target="_blank" rel="noreferrer" title={s.oneLine} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ${sigTone[s.type] ?? sigTone.other}`}>
              ⚠️ {s.oneLine}
            </a>
          ))}
        </div>
      )}
      {n.news.length > 0 && (
        <ul className="space-y-2.5">
          {n.news.map((it, i) => (
            <li key={i} className="border-l-2 border-slate-200 pl-3">
              <a href={it.url || undefined} target="_blank" rel="noreferrer" className="text-sm font-medium text-slate-800 hover:text-teal-700 hover:underline">{it.title}</a>
              <div className="mt-0.5 text-xs text-slate-500">{it.oneLine}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{[it.date, it.source].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


type FitAxis = { label: string; score: number; value: string; hint: string };
// Normalise a company's ratios into 0–100 "fitness" scores so the health card
// can be read as a shape (green/amber/red bars) instead of a table of numbers.
function fitnessAxes(e: Entity): FitAxis[] {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const out: FitAxis[] = [];
  const em = ebitdaMarginOf(e);
  if (em != null) out.push({ label: "EBITDA margin", score: clamp((em / 25) * 100), value: `${Math.round(em)}%`, hint: "Operating profitability, scored against a 25% ‘excellent’ bar." });
  const nm = netMarginOf(e);
  if (nm != null) out.push({ label: "Net margin", score: clamp((nm / 15) * 100), value: `${Math.round(nm)}%`, hint: "Bottom-line margin, scored against a 15% bar." });
  const rc = supRoce(e);
  if (rc != null) out.push({ label: "RoCE", score: clamp((rc / 30) * 100), value: `${Math.round(rc)}%`, hint: "Return on capital employed — 30%+ scores full." });
  const cur = supCurrent(e);
  if (cur != null) out.push({ label: "Liquidity", score: clamp((cur / 2) * 100), value: cur.toFixed(2), hint: "Current ratio — 2+ is comfortable, below 1 is tight." });
  const de = supDebtEq(e);
  if (de != null) out.push({ label: "Low leverage", score: clamp(((2 - de) / 2) * 100), value: de.toFixed(2), hint: "Debt-to-equity — 0 scores full, 2+ scores zero." });
  const ic = supIntCov(e);
  if (ic != null) out.push({ label: "Interest cover", score: clamp((ic / 5) * 100), value: `${ic.toFixed(1)}x`, hint: "Times interest earned — 5x+ is healthy." });
  const dso = supDSO(e);
  if (dso != null) out.push({ label: "Fast collection", score: clamp(((90 - dso) / 90) * 100), value: `${Math.round(dso)} d`, hint: "Days to collect from customers — fewer is better." });
  return out;
}

function HealthRiskBody({ e, fit }: { e: Entity; fit: FitAxis[] }) {
  const pdf = e.pdf;
  return (
    <>
      {fit.length > 0 && <ScoreBars data={fit} />}
      {pdf && (
        <div className={fit.length > 0 ? "mt-4" : ""}>
          {pdf.msme && (
            <div className="mb-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200" title="MSME = Micro, Small & Medium enterprises. Indian law requires companies to pay MSME suppliers within 45 days; disclosed delays are a cash-stress signal.">
              <div className="text-xs text-amber-700">🚩 Late payments to small (MSME) vendors</div>
              <div className="mt-0.5 font-mono text-sm text-amber-900">{pdf.msme.count} late · ₹{pdf.msme.amount}</div>
            </div>
          )}
          {pdf.riskFlags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">{pdf.riskFlags.map((f, i) => <span key={i} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-rose-200">🚩 {f}</span>)}</div>
          ) : <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">✓ No risk indicators flagged in the latest filing.</div>}
        </div>
      )}
    </>
  );
}

function ResearchBody({ r }: { r: ResearchData }) {
  const List = ({ items }: { items: string[] }) => <ul className="space-y-1.5 text-sm text-slate-700">{items.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400" />{s}</li>)}</ul>;
  return (
    <div className="space-y-4">
      {r.overview && <p className="text-sm leading-relaxed text-slate-600">{r.overview}</p>}
      {r.products.length > 0 && (<div><div className="mb-1 text-xs font-medium text-slate-500">Products &amp; capabilities</div><List items={r.products.slice(0, 6)} /></div>)}
      {r.leadership.length > 0 && (<div><div className="mb-1 text-xs font-medium text-slate-500">Leadership</div><List items={r.leadership.slice(0, 5)} /></div>)}
      {r.ownership && (<div><div className="mb-1 text-xs font-medium text-slate-500">Ownership &amp; financials</div><p className="text-sm leading-relaxed text-slate-600">{r.ownership}</p></div>)}
      {r.clients.length > 0 && (<div><div className="mb-1 text-xs font-medium text-slate-500">Notable clients</div><div className="flex flex-wrap gap-1.5">{r.clients.slice(0, 10).map((c, i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c}</span>)}</div></div>)}
      {r.news.length > 0 && (<div><div className="mb-1 text-xs font-medium text-slate-500">Recent news</div><List items={r.news.slice(0, 5)} /></div>)}
    </div>
  );
}

/* -------------------------------------------------------- small primitives */

function Th({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return <th className={`px-4 py-3 ${center ? "text-center" : right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Pill({ children, cls, dot }: { children: React.ReactNode; cls: string; dot?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{children}</span>;
}
function EmptyRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} className="px-4 py-10 text-center text-slate-400">Nothing matches this filter.</td></tr>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="text-xs text-slate-500">{label}</div><div className="mt-0.5 font-mono text-sm text-slate-900">{value}</div></div>;
}
// A dense two-column fact sheet — reads like a filing extract, not a wall of KPI tiles.
function StatTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5">
          <span className="text-sm text-slate-500">{r.label}</span>
          <span className="font-mono text-sm font-medium text-slate-900">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt className="shrink-0 text-slate-500">{k}</dt><dd className={`text-right text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd></div>;
}
