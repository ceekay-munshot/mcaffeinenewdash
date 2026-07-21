import { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA,
  supplyEntities,
  competitorRows,
  COMPETITOR_CATEGORIES,
  type Entity,
  type CompetitorRow,
  type ResearchData,
  type SupplierPdf,
} from "./types";
import { fmtCrore, fmtPct, fmtInt, fmtDate, fmtDays, fmtUSD, toCrore } from "./lib/format";
import { negotiationRoom } from "./lib/health";
import { CATEGORY_COLOR } from "./lib/palette";
import { HBars, Columns, AreaLine, Card, type Slice } from "./charts";
import { DELIVERY } from "./delivery";
import {
  supplierInsights, TONE_META, type Insight,
  supDSO, supDPO, supCCC, supRoce,
} from "./lib/insights";

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
const catColor = (cat: string) => CAT_META[cat]?.color ?? "#94a3b8";

/* --------------------------------------------------------------------- shell */

type Module = "suppliers" | "competitors" | "delivery";
const MODULES: { key: Module; label: string; emoji: string }[] = [
  { key: "suppliers", label: "Suppliers", emoji: "🏭" },
  { key: "competitors", label: "Competitors", emoji: "🥊" },
  { key: "delivery", label: "Delivery", emoji: "🚚" },
];

export default function App() {
  const [module, setModule] = useState<Module>("suppliers");
  return (
    <div className="min-h-screen bg-[#f6f4ef] text-slate-800">
      <Header module={module} setModule={setModule} generatedAt={DATA.generatedAt} />
      {module === "suppliers" && <SupplierView />}
      {module === "competitors" && <CompetitorView />}
      {module === "delivery" && <DeliveryView />}
    </div>
  );
}

function Header({ module, setModule, generatedAt }: { module: Module; setModule: (m: Module) => void; generatedAt: string }) {
  return (
    <header className="sticky top-0 z-30 bg-gradient-to-r from-[#0b3b39] via-[#0d9488] to-[#0891b2] shadow-md">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-y-3 px-4 py-3.5 sm:px-6">
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
          <nav className="flex gap-1 rounded-2xl bg-black/15 p-1 ring-1 ring-white/15">
            {MODULES.map((m) => (
              <button key={m.key} onClick={() => setModule(m.key)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition ${module === m.key ? "bg-white text-[#0b3b39] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
                <span>{m.emoji}</span>{m.label}
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

function ModuleHero({ emoji, title, subtitle, stats, tint }: {
  emoji: string; title: string; subtitle: string; tint: string; stats: { label: string; value: string }[];
}) {
  return (
    <section className={`mt-6 overflow-hidden rounded-3xl bg-gradient-to-r ${tint} p-5 text-white shadow-sm`}>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><span className="text-2xl">{emoji}</span>{title}</div>
          <div className="mt-0.5 text-sm text-white/75">{subtitle}</div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/12 px-4 py-2 ring-1 ring-white/20">
              <div className="text-[10px] font-medium uppercase tracking-wide text-white/70">{s.label}</div>
              <div className="text-lg font-bold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
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

// Toggle chip row — the mechanism that lets ONE chart show many metrics.
function Toggle<T extends string>({ options, value, onChange }: { options: { key: T; label: string; emoji: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${value === o.key ? "bg-teal-600 text-white ring-teal-600 shadow-sm" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}>
          <span>{o.emoji}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

function InsightCard({ ins, supplier, onOpen }: { ins: Insight; supplier?: string; onOpen?: () => void }) {
  const m = TONE_META[ins.tone];
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag onClick={onOpen} className={`flex w-full text-left rounded-2xl ${m.bg} p-4 ring-1 ${m.ring} transition ${onOpen ? "hover:shadow-md" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none">{ins.icon}</span>
        <div className="min-w-0">
          {supplier && <div className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-500">{supplier}</div>}
          <div className={`text-sm font-semibold ${m.text}`}>{ins.title}</div>
          <div className="mt-1 text-[13px] leading-relaxed text-slate-600">{ins.detail}</div>
        </div>
      </div>
    </Tag>
  );
}

/* ------------- interactive charts: one chart, many metrics (merged) ------- */

type TrendMetric = { key: string; label: string; emoji: string; kind: "area" | "columns"; color: string; unit: (v: number) => string; slices: Slice[] };

function MetricTrend({ metrics, height = 250 }: { metrics: TrendMetric[]; height?: number }) {
  const [k, setK] = useState(metrics[0].key);
  const m = metrics.find((x) => x.key === k) ?? metrics[0];
  return (
    <div>
      <Toggle options={metrics.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} value={k} onChange={setK} />
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
      <Toggle options={metrics.map((x) => ({ key: x.key, label: x.label, emoji: x.emoji }))} value={k} onChange={setK} />
      {m.note && <div className="-mt-2 mb-3 text-xs text-slate-500">{m.note}</div>}
      {m.rows.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No data for this metric yet.</div> : <HBars data={m.rows} valueLabel={m.unit} onBar={onBar} />}
    </div>
  );
}

// Multi-year metrics for one company, from its Tracxn profile.
function buildTrendMetrics(e: Entity): TrendMetric[] {
  const ys = e.profile?.years ? [...e.profile.years].sort((a, b) => a.fy.localeCompare(b.fy)) : [];
  if (ys.length < 2) return [];
  const s = (fy: string) => "'" + (fy.split("-")[1] ?? fy);
  const cr = (v: number | null) => Math.round((v ?? 0) / 1e7);
  const out: TrendMetric[] = [];
  out.push({ key: "revenue", label: "Revenue", emoji: "💵", kind: "area", color: "#0d9488", unit: (v) => `₹${v.toLocaleString("en-IN")} Cr`, slices: ys.map((y) => ({ label: s(y.fy), value: cr(y.revenueINR), color: "#0d9488" })) });
  if (ys.some((y) => y.netProfitINR != null)) out.push({ key: "profit", label: "Net profit", emoji: "📈", kind: "columns", color: "#1baf7a", unit: (v) => `₹${v.toLocaleString("en-IN")}`, slices: ys.map((y) => ({ label: s(y.fy), value: cr(y.netProfitINR), color: (y.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) });
  if (ys.some((y) => y.ebitdaMarginPct != null)) out.push({ key: "ebitda", label: "EBITDA margin", emoji: "💰", kind: "area", color: "#eda100", unit: (v) => `${v}%`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.ebitdaMarginPct ?? 0), color: "#eda100" })) });
  if (ys.some((y) => y.rocePct != null)) out.push({ key: "roce", label: "Return on capital", emoji: "⚙️", kind: "area", color: "#4a3aa7", unit: (v) => `${v}%`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.rocePct ?? 0), color: "#4a3aa7" })) });
  if (ys.some((y) => y.receivableDays != null)) out.push({ key: "dso", label: "Collection days", emoji: "📥", kind: "area", color: "#2a78d6", unit: (v) => `${Math.round(v)}d`, slices: ys.map((y) => ({ label: s(y.fy), value: Math.round(y.receivableDays ?? 0), color: "#2a78d6" })) });
  return out;
}

/* --------------------------------------------------------- P0 Supplier view */

type SupTab = "board" | "benchmark";
const SUP_TABS: { key: SupTab; label: string; emoji: string }[] = [
  { key: "board", label: "Supplier board", emoji: "📇" },
  { key: "benchmark", label: "Benchmark charts", emoji: "📊" },
];

function SupplierView() {
  const all = useMemo(() => supplyEntities(), []);
  const [tab, setTab] = useState<SupTab>("board");
  const [selected, setSelected] = useState<Entity | null>(null);
  const { open: openSupplier, back } = useProfileNav(selected, setSelected);

  const stats = useMemo(() => {
    const withFin = all.filter((e) => revOf(e) != null).length;
    const revCr = all.reduce((s, e) => s + (toCrore(revOf(e)) ?? 0), 0);
    const opps = all.reduce((s, e) => s + supplierInsights(e).filter((i) => i.tone === "opportunity").length, 0);
    return { tracked: all.length, withFin, revCr, opps };
  }, [all]);

  if (selected) return <CompanyPage entity={selected} onBack={back} kind="supplier" />;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
      <ModuleHero emoji="🏭" title="Supplier Intelligence"
        subtitle="Financial health, negotiation levers & risk across every RM · PM · Manufacturer vendor"
        tint="from-[#0f766e] to-[#0891b2]"
        stats={[
          { label: "Suppliers", value: String(stats.tracked) },
          { label: "With financials", value: `${stats.withFin}` },
          { label: "Spend in view", value: crStr(stats.revCr) },
          { label: "Levers found", value: String(stats.opps) },
        ]} />
      <div className="mt-5 mb-4"><SubTabs tabs={SUP_TABS} value={tab} onChange={setTab} /></div>
      {tab === "board" && <SupplierBoard all={all} onSelect={openSupplier} />}
      {tab === "benchmark" && <BenchmarkView all={all} onSelect={openSupplier} />}
    </main>
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
};

// One dense analyst table: every supplier is a row, negotiation metrics are
// columns, and the levers/risks become compact tags. Replaces the old wall of
// look-alike cards — scannable and sortable in one view.
function SupplierBoard({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"levers" | "revenue" | "ebitda" | "dso">("levers");
  const [showMore, setShowMore] = useState(false);

  const enriched = useMemo(() => all.map((e) => ({ e, ins: supplierInsights(e), levers: leverTagsOf(supplierInsights(e)) })), [all]);
  const filtered = useMemo(() => {
    let r = enriched;
    if (cat !== "All") r = r.filter((x) => x.e.category === cat);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((x) => `${x.e.brand} ${x.e.legalName ?? ""} ${x.e.cin ?? ""}`.toLowerCase().includes(q));
    return r;
  }, [enriched, cat, query]);

  // Main table = suppliers that actually have a lever to push on (so the Levers
  // column is never blank). Everyone else — metrics-but-no-lever, revenue-only,
  // or no filing — is collapsed behind a "+ Show more" button.
  const active = useMemo(() => {
    const withLever = filtered.filter((x) => x.levers.length > 0);
    return [...withLever].sort((a, b) => {
      switch (sort) {
        case "revenue": return (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1);
        case "ebitda": return (ebitdaMarginOf(b.e) ?? -1) - (ebitdaMarginOf(a.e) ?? -1);
        case "dso": return (supDSO(a.e) ?? 1e9) - (supDSO(b.e) ?? 1e9);
        default: return b.levers.length - a.levers.length || (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1);
      }
    });
  }, [filtered, sort]);
  const others = useMemo(() => filtered.filter((x) => x.levers.length === 0).sort((a, b) => (revOf(b.e) ?? -1) - (revOf(a.e) ?? -1)), [filtered]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-3 text-sm text-teal-900">
        <span className="font-semibold">{active.length} suppliers with a clear negotiation lever.</span> The <span className="font-medium">Levers</span> column shows where to push — hover a tag for the reason, or click any row for the full profile. Sorted by most levers first.
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SUP_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${cat === c ? "bg-teal-50 text-teal-700 ring-teal-300" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"}`}>
              {c === "All" ? "All" : `${catEmoji(c)} ${c}`}
              <span className="ml-1.5 text-xs text-slate-400">{c === "All" ? all.length : all.filter((e) => e.category === c).length}</span>
            </button>
          ))}
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
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <Th>Supplier</Th><Th right>Revenue</Th><Th right>EBITDA</Th><Th right>RoCE</Th><Th right>Collects</Th><Th right>Pays</Th><Th>Negotiation levers</Th>
            </tr>
          </thead>
          <tbody>
            {active.map(({ e, levers }) => (
              <tr key={e.category + e.folder} onClick={() => onSelect(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 font-medium text-slate-900"><span>{catEmoji(e.category)}</span><span className="truncate">{e.brand}</span></div>
                  <div className="truncate text-xs text-slate-400">{e.legalName ?? e.folder}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(revOf(e))}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-600">{fmtPct(ebitdaMarginOf(e))}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-600">{fmtPct(supRoce(e))}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-500">{fmtDays(supDSO(e))}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-500">{fmtDays(supDPO(e))}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {levers.map(({ short, emoji, detail }) => (
                      <span key={short} title={detail} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">{emoji} {short}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {active.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No suppliers with a negotiation lever match this filter{others.length > 0 ? " — try “Show more” below." : "."}</td></tr>}
          </tbody>
        </table>
      </div>

      {others.length > 0 && (
        <div>
          <button onClick={() => setShowMore((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:ring-slate-300">
            <span className="text-teal-600">{showMore ? "–" : "+"}</span>
            {showMore ? "Hide" : "Show"} {others.length} more supplier{others.length > 1 ? "s" : ""} with no active lever
          </button>
          {showMore && (
            <div className="mt-3 flex flex-wrap gap-2">
              {others.map(({ e }) => (
                <button key={e.category + e.folder} onClick={() => onSelect(e)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-900 hover:ring-teal-300">
                  <span>{catEmoji(e.category)}</span><span className="font-medium">{e.brand}</span>
                  {revOf(e) != null && <span className="font-mono text-slate-400">{fmtCrore(revOf(e))}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
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

type MetricKey = "revenue" | "ebitda" | "roce" | "dso" | "dpo" | "ccc";
const SUP_METRICS: { key: MetricKey; label: string; emoji: string; get: (e: Entity) => number | null; unit: (v: number) => string; note: string }[] = [
  { key: "revenue", label: "Revenue", emoji: "💵", get: (e) => toCrore(revOf(e)), unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`), note: "Bigger vendors — where most of the spend sits." },
  { key: "ebitda", label: "EBITDA margin", emoji: "💰", get: (e) => ebitdaMarginOf(e), unit: (v) => `${Math.round(v)}%`, note: "Fatter margin = more cushion in their pricing to negotiate on." },
  { key: "roce", label: "Return on capital", emoji: "⚙️", get: (e) => supRoce(e), unit: (v) => `${Math.round(v)}%`, note: "How efficiently they turn capital into profit — high = a strong, healthy vendor." },
  { key: "dso", label: "Collects in (DSO)", emoji: "📥", get: (e) => supDSO(e), unit: (v) => `${Math.round(v)} d`, note: "How fast they collect from customers. Low = healthy cash, so we can push our payment terms out." },
  { key: "dpo", label: "Pays suppliers in (DPO)", emoji: "📤", get: (e) => supDPO(e), unit: (v) => `${Math.round(v)} d`, note: "How long they take to pay their suppliers. High = they already stretch terms, so asking the same of them is credible." },
  { key: "ccc", label: "Cash cycle", emoji: "🔄", get: (e) => supCCC(e), unit: (v) => `${Math.round(v)} d`, note: "Days cash is tied up. Long = they're cash-hungry and will value an early-payment discount." },
];
const SUP_CATS = ["All", "RM Vendor", "PM Vendor", "Manufacturer"] as const;

function BenchmarkView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const m = SUP_METRICS.find((x) => x.key === metric)!;
  const pool = useMemo(() => (cat === "All" ? all : all.filter((e) => e.category === cat)), [all, cat]);
  const byName = useMemo(() => new Map(all.map((e) => [e.brand, e])), [all]);

  const bars: Slice[] = useMemo(
    () => pool.map((e) => ({ e, v: m.get(e) })).filter((x): x is { e: Entity; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v).slice(0, 16)
      .map(({ e, v }) => ({ label: e.brand, value: Math.round(v * 10) / 10, color: catColor(e.category), sub: e.category })),
    [pool, m]
  );
  const payTerms = useMemo(
    () => pool.map((e) => ({ e, dso: supDSO(e), dpo: supDPO(e) }))
      .filter((x): x is { e: Entity; dso: number; dpo: number } => x.dso != null && x.dpo != null)
      .sort((a, b) => a.dso - b.dso),
    [pool]
  );
  const payMax = Math.max(1, ...payTerms.flatMap((p) => [p.dso, p.dpo]));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SUP_METRICS.map((x) => (
            <button key={x.key} onClick={() => setMetric(x.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition ${metric === x.key ? "bg-teal-600 text-white ring-teal-600 shadow-sm" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}>
              <span>{x.emoji}</span>{x.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUP_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${cat === c ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"}`}>
              {c === "All" ? "All" : `${catEmoji(c)} ${c}`}
            </button>
          ))}
        </div>
      </div>

      <Card title={`${m.emoji} ${m.label} — every supplier ranked`} sub={m.note} accent="#0d9488">
        {bars.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No suppliers with this metric yet.</div>
          : <HBars data={bars} valueLabel={m.unit} onBar={(l) => byName.get(l) && onSelect(byName.get(l)!)} />}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {Object.keys(CAT_META).map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: catColor(c) }} />{catEmoji(c)} {c}</span>
          ))}
        </div>
      </Card>

      <Card title="💸 Payment-terms map — who we can push"
        sub="Teal = days they take to COLLECT from customers · Amber = days they take to PAY their suppliers. Short collection + long payment = they run on other people's cash, so extending our terms is realistic."
        accent="#0d9488">
        {payTerms.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No suppliers with both collection & payment days yet.</div> : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
            {payTerms.map(({ e, dso, dpo }) => (
              <button key={e.folder} onClick={() => onSelect(e)} className="group grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3 text-left">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">{e.brand}</div>
                  <div className="text-[11px] text-slate-400">{catEmoji(e.category)} {e.category}</div>
                </div>
                <div className="space-y-1">
                  <TermBar value={dso} max={payMax} color="#0d9488" label={`collects ${Math.round(dso)}d`} />
                  <TermBar value={dpo} max={payMax} color="#f59e0b" label={`pays ${Math.round(dpo)}d`} />
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-teal-600" /> Collects from customers (DSO)</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Pays its suppliers (DPO)</span>
        </div>
      </Card>
    </div>
  );
}

function TermBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="group relative flex items-center gap-2" title={label}>
      <div className="h-3 flex-1 rounded-full bg-slate-100">
        <div className="h-3 rounded-full transition-[filter] group-hover:brightness-95" style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
      </div>
      <span className="w-20 shrink-0 text-[11px] text-slate-500">{label}</span>
    </div>
  );
}

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
    <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
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
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><Th>Brand</Th><Th>Categories</Th><Th right>Revenue</Th><Th right>Funding</Th><Th>Stage</Th><Th>Latest deal / event</Th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.cin || e.brand} onClick={() => openCompetitor(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-violet-50/40">
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{e.brand}</div><div className="truncate text-xs text-slate-400">{e.parent ?? e.legalName ?? ""}</div></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{e.categories.map((c) => <span key={c} className="rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: `${CAT5_COLOR[c] ?? "#94a3b8"}18`, color: CAT5_COLOR[c] ?? "#64748b" }}>{c}</span>)}</div></td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(revOf(e))}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtUSD(e.competitor?.fundingUSD ?? null)}</td>
                    <td className="px-4 py-3 text-slate-600">{e.competitor?.stage ?? "—"}</td>
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
    { key: "traction", label: "Reviews", emoji: "🔥", unit: (v) => `${v}m`, note: "Total Nykaa reviews (millions) — a sales-velocity proxy.", rows: rank((e) => (e.shelf?.totalReviews != null ? e.shelf.totalReviews / 1e6 : null), "#2a78d6") },
    { key: "rating", label: "Rating", emoji: "⭐", unit: (v) => `${v.toFixed(1)}★`, note: "Average customer rating on Nykaa (out of 5).", rows: rank((e) => e.shelf?.avgRating ?? null, "#1baf7a") },
  ];

  const catRows: Slice[] = COMPETITOR_CATEGORIES.map((c) => ({ label: c, value: all.filter((e) => e.categories.includes(c)).length, color: CAT5_COLOR[c] ?? "#94a3b8" })).sort((a, b) => b.value - a.value);
  const fundingGroups = (["Acquired", "VC-funded", "Unfunded", "Unknown"] as const).map((k) => ({ bucket: k, brands: all.filter((e) => fundingBucket(e.competitor?.stage) === k) })).filter((g) => g.brands.length);
  const events = useMemo(() => all.filter((e) => e.competitor?.materialEvent), [all]);

  return (
    <div className="space-y-4">
      <Card title="🥊 Compare rivals" sub="One chart — switch the metric to rank every brand" accent="#6d28d9">
        <MetricRank metrics={metrics} onBar={pick} />
      </Card>

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
  const partnerEnts = useMemo(() => new Map(DATA.entities.filter((e) => e.category === "Delivery Partners").map((e) => [nm(e.brand), e])), []);
  const [selected, setSelected] = useState<Entity | null>(null);
  const { open: openPartner, back } = useProfileNav(selected, setSelected);
  const s = (fy: string) => "'" + fy.split("-")[1];

  const metrics: TrendMetric[] = [
    { key: "revenue", label: "Revenue", emoji: "💵", kind: "area", color: "#0d9488", unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`), slices: d.trend.map((t) => ({ label: s(t.fy), value: cr(t.revenueINR), color: "#0d9488" })) },
    { key: "profit", label: "Net profit", emoji: "📈", kind: "columns", color: "#1baf7a", unit: (v) => (v >= 0 ? `₹${v}` : `-₹${Math.abs(v)}`), slices: d.trend.map((t) => ({ label: s(t.fy), value: cr(t.netProfitINR), color: (t.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) },
    { key: "dso", label: "Collection days", emoji: "📥", kind: "area", color: "#2a78d6", unit: (v) => `${Math.round(v)}d`, slices: d.ratioTrend.map((t) => ({ label: s(t.fy), value: t.dso ?? 0, color: "#2a78d6" })) },
    { key: "margin", label: "EBITDA margin", emoji: "💰", kind: "columns", color: "#1baf7a", unit: (v) => `${v}%`, slices: d.ratioTrend.map((t) => ({ label: s(t.fy), value: t.ebitdaMarginPct ?? 0, color: (t.ebitdaMarginPct ?? 0) >= 0 ? "#1baf7a" : "#e34948" })) },
  ];

  if (selected) return <CompanyPage entity={selected} onBack={back} kind="delivery" />;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
      <ModuleHero emoji="🚚" title="Delivery Partners"
        subtitle="Last-mile & logistics partners — financial strength and the receivables (DSO) credit lever"
        tint="from-[#0369a1] to-[#0d9488]"
        stats={[
          { label: "Partners", value: String(partners.length) },
          { label: "Listed", value: String(partners.filter((p) => p.listed).length) },
          { label: "Delhivery rev", value: crStr(cr(d.revenueINR)) },
          { label: "Delhivery DSO", value: `${Math.round(d.dso ?? 0)} d` },
        ]} />

      <div className="mt-6 space-y-4">
        <Card title="📈 Delhivery — 12-year track record" sub="Switch the metric — revenue, profit turnaround, receivables & margin" accent="#0d9488">
          <MetricTrend metrics={metrics} height={260} />
          <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
            Turned profitable in FY {d.latestFY} (+{crStr(cr(d.netProfitINR))}) after years of losses. Latest: revenue {crStr(cr(d.revenueINR))} · EBITDA margin {d.ebitdaMarginPct ?? "—"}% · DSO {Math.round(d.dso ?? 0)}d.
          </div>
        </Card>

        <Card title="🚚 Partner roster" sub="identified legal entities — click a listed/private partner for its profile" accent="#4a3aa7">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p) => (
              <button key={p.brand} onClick={() => { const e = partnerEnts.get(nm(p.brand)); if (e) openPartner(e); }}
                className={`flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 ${partnerEnts.get(nm(p.brand))?.profile ? "cursor-pointer hover:bg-teal-50/60" : ""}`}>
                <div className="min-w-0"><div className="text-sm font-medium text-slate-800">{p.brand}</div><div className="truncate text-xs text-slate-400">{p.legalName ?? "—"}</div></div>
                {p.listed ? <Pill cls="text-emerald-700 bg-emerald-50 ring-emerald-200">Listed</Pill> : <Pill cls="text-slate-600 bg-slate-100 ring-slate-200">Private</Pill>}
              </button>
            ))}
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="🏦 The credit lever" sub="what to push on with delivery partners" accent="#0369a1">
            <div className="space-y-3">
              {[
                { icon: "📥", t: `Delhivery collects in ~${Math.round(d.dso ?? 0)} days`, d: "That's the receivables (DSO) lever — the longer they let clients pay, the more room there is for us to negotiate our own payment terms out." },
                { icon: "💹", t: "Now profitable after a decade of losses", d: `Turned positive in FY ${d.latestFY} (+${crStr(cr(d.netProfitINR))}). A financially healthier partner is a more reliable one — and less likely to hike rates abruptly.` },
                { icon: "⚖️", t: "Only 1 of 5 partners is listed", d: "Delhivery has full public filings; the other four are private, so their financials come next from Probe42 / MCA to complete the comparison." },
              ].map((x) => (
                <div key={x.t} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <span className="text-lg leading-none">{x.icon}</span>
                  <div><div className="text-sm font-semibold text-slate-800">{x.t}</div><div className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{x.d}</div></div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="💰 Delhivery — latest financials" sub={`FY ${d.latestFY} · consolidated`} accent="#0891b2" className="lg:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Revenue" value={crStr(cr(d.revenueINR))} />
              <Stat label="Net profit" value={crStr(cr(d.netProfitINR))} />
              <Stat label="EBITDA margin" value={d.ebitdaMarginPct != null ? `${d.ebitdaMarginPct}%` : "—"} />
              <Stat label="Collection days" value={`${Math.round(d.dso ?? 0)} d`} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {d.trend.slice(-4).map((t) => (
                <div key={t.fy} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">FY {t.fy}</div>
                  <div className="mt-0.5 font-mono text-sm text-slate-900">{crStr(cr(t.revenueINR))}</div>
                  <div className={`text-xs ${(t.netProfitINR ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{(t.netProfitINR ?? 0) >= 0 ? "+" : "−"}{crStr(Math.abs(cr(t.netProfitINR)))}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------- company page (single dense) */

type CompanyKind = "supplier" | "competitor" | "delivery";
type CardDesc = { key: string; title: string; sub?: string; node: React.ReactNode };

function CompanyPage({ entity: e, onBack, kind }: { entity: Entity; onBack: () => void; kind: CompanyKind }) {
  useEffect(() => { window.scrollTo(0, 0); }, [e.folder, e.category]);
  const trend = useMemo(() => buildTrendMetrics(e), [e]);
  const ins = useMemo(() => supplierInsights(e), [e]);
  const cards = useMemo(() => companyCards(e, kind), [e, kind]);
  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const cost = cardByKey.get("cost");
  const masonry = cards.filter((c) => c.key !== "cost");

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
    <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
      <button onClick={onBack} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700">
        <span className="text-base leading-none">←</span> Back to {backLabel}
      </button>

      <div className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b3b39] via-[#0d9488] to-[#0891b2] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold ring-1 ring-white/25">{kind === "supplier" ? catEmoji(e.category) : e.brand.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="text-2xl font-bold tracking-tight">{e.brand}</div>
              <div className="mt-0.5 text-sm text-white/70">{e.legalName ?? e.folder}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20">{catEmoji(e.category)} {e.category}</span>
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

      {parentGroup && <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-800 ring-1 ring-sky-200">ℹ️ {e.brand} has no standalone financials — the trends & numbers below are <span className="font-medium">{parentGroup}</span>'s consolidated group filing, not {e.brand} alone.</div>}
      {noFinancials && <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">No financial data is available for this company in Tracxn — only the registry basics below.</div>}

      <div className="mt-4 space-y-4">
        {trend.length > 0 && (
          <Card title="📈 Performance over time" sub="One chart — switch the metric" accent="#0d9488"><MetricTrend metrics={trend} /></Card>
        )}
        {ins.length > 0 && (
          <Card title="💡 Negotiation levers & risks" sub="ready-to-use angles built from this company's own numbers" accent="#eda100">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{ins.map((i, idx) => <InsightCard key={idx} ins={i} />)}</div>
          </Card>
        )}
        {cost && <Card title={cost.title} sub={cost.sub} accent="#0d9488">{cost.node}</Card>}
        {/* everything else packs into a balanced masonry — no tall charts here, so no triangle */}
        <div className="gap-4 [column-fill:balance] sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {masonry.map((c) => <Card key={c.key} title={c.title} sub={c.sub} accent="#0d9488">{c.node}</Card>)}
        </div>
      </div>
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
  const stats: React.ReactNode[] = [];
  const num2 = (v: number | null | undefined) => (v != null ? v.toFixed(2) : "—");
  stats.push(<Stat key="rev" label="Revenue" value={fmtCrore(revOf(e))} />);
  if (ebitdaMarginOf(e) != null) stats.push(<Stat key="em" label="EBITDA margin" value={fmtPct(ebitdaMarginOf(e))} />);
  if (netMarginOf(e) != null) stats.push(<Stat key="nm" label="Net margin" value={fmtPct(netMarginOf(e))} />);
  if (f.ebitdaINR != null) stats.push(<Stat key="ebitda" label="EBITDA" value={fmtCrore(f.ebitdaINR)} />);
  if (py?.rocePct != null || e.probe?.roce != null) stats.push(<Stat key="roce" label="RoCE" value={fmtPct(py?.rocePct ?? e.probe?.roce ?? null)} />);
  if (py?.roePct != null) stats.push(<Stat key="roe" label="RoE" value={fmtPct(py.roePct)} />);
  if (supDSO(e) != null) stats.push(<Stat key="dso" label="Collection days" value={fmtDays(supDSO(e))} />);
  if (supDPO(e) != null) stats.push(<Stat key="dpo" label="Payable days" value={fmtDays(supDPO(e))} />);
  if (py?.currentRatio != null) stats.push(<Stat key="cr" label="Current ratio" value={num2(py.currentRatio)} />);
  if (py?.debtToEquity != null) stats.push(<Stat key="de" label="Debt / equity" value={num2(py.debtToEquity)} />);
  if (py?.interestCoverage != null) stats.push(<Stat key="ic" label="Interest cover" value={`${py.interestCoverage.toFixed(1)}x`} />);
  if (cagr.some((v) => v != null)) stats.push(<Stat key="cagr" label="Rev CAGR 1/3/5y" value={cagr.map((v) => fmtPct(v)).join(" / ")} />);
  if (f.employeeCount != null) stats.push(<Stat key="emp" label="Employees" value={fmtInt(f.employeeCount)} />);
  if (f.paidUpCapitalINR != null) stats.push(<Stat key="paid" label="Paid-up capital" value={fmtCrore(f.paidUpCapitalINR)} />);
  if (stats.length > 1) cards.push({ key: "keynums", title: `📊 Key numbers${py ? ` · FY${py.fy}` : ""}`, node: <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{stats}</div> });

  if (py && (py.totalDebtINR != null || py.tradeReceivablesINR != null || py.cashINR != null || py.inventoryINR != null)) {
    cards.push({ key: "balance", title: `⚖️ Balance sheet · FY${py.fy}`, node: (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total debt" value={fmtCrore(py.totalDebtINR)} /><Stat label="Total equity" value={fmtCrore(py.totalEquityINR)} />
        <Stat label="Receivables" value={fmtCrore(py.tradeReceivablesINR)} /><Stat label="Payables" value={fmtCrore(py.tradePayablesINR)} />
        <Stat label="Inventory" value={fmtCrore(py.inventoryINR)} /><Stat label="Cash" value={fmtCrore(py.cashINR)} />
      </div>
    ) });
  }

  if (py && (py.cashFromOpsINR != null || py.cashFromInvestingINR != null || py.cashFromFinancingINR != null)) {
    cards.push({ key: "cashflow", title: `💵 Cash flow · FY${py.fy}`, node: (
      <div className="grid grid-cols-3 gap-3"><Stat label="Operating" value={fmtCrore(py.cashFromOpsINR)} /><Stat label="Investing" value={fmtCrore(py.cashFromInvestingINR)} /><Stat label="Financing" value={fmtCrore(py.cashFromFinancingINR)} /></div>
    ) });
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

  if (e.pdf) cards.push({ key: "health", title: "🩺 Financial health & risk", node: <HealthRiskBody pdf={e.pdf} /> });

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

  if (e.research) cards.push({ key: "research", title: "🔎 Research", node: <ResearchBody r={e.research} /> });

  return cards;
}


function HealthRiskBody({ pdf }: { pdf: SupplierPdf }) {
  const signed = (v: number | null, suffix = "%") => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}${suffix}`);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Current ratio" value={pdf.currentRatio != null ? pdf.currentRatio.toFixed(2) : "—"} />
        <Stat label="Interest coverage" value={pdf.interestCoverage != null ? `${pdf.interestCoverage.toFixed(1)}x` : "—"} />
        <Stat label="Debt / equity" value={pdf.debtToEquity != null ? pdf.debtToEquity.toFixed(2) : "—"} />
        <Stat label="Revenue YoY" value={signed(pdf.revenueChangePct)} /><Stat label="PAT 3-yr CAGR" value={signed(pdf.patCagr3yrPct)} />
        <Stat label="MSME delays" value={pdf.msme ? `${pdf.msme.count} · ₹${pdf.msme.amount}` : "None"} />
      </div>
      {pdf.riskFlags.length > 0 ? (
        <div className="mt-3"><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600">Risk flags</div><div className="flex flex-wrap gap-1.5">{pdf.riskFlags.map((f, i) => <span key={i} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-rose-200">{f}</span>)}</div></div>
      ) : <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">No risk indicators flagged in the latest filing.</div>}
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

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>;
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
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt className="shrink-0 text-slate-500">{k}</dt><dd className={`text-right text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd></div>;
}
