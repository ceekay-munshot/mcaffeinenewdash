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
  type SupplierProfile,
} from "./types";
import { fmtCrore, fmtPct, fmtInt, fmtDate, fmtDays, fmtUSD, toCrore } from "./lib/format";
import { negotiationRoom, ROOM_META, type Room } from "./lib/health";
import { CATEGORY_COLOR } from "./lib/palette";
import { HBars, Columns, AreaLine, Card, type Slice } from "./charts";
import { DELIVERY } from "./delivery";
import {
  supplierInsights, TONE_META, type Insight, type InsightTone,
  supDSO, supDPO, supCCC, supRoce,
} from "./lib/insights";

/* -------------------------------------------------- data accessors / helpers */

function latestYear(e: Entity) {
  const ys = e.profile?.years;
  return ys && ys.length ? ys[ys.length - 1] : null;
}

// Some brands' attached Tracxn PDF is actually their PARENT GROUP's consolidated
// filing, not the brand's own (Dove/Vaseline → HUL, The Derma Co → Honasa). A
// profile that substantially exceeds the brand's own base revenue is a parent.
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

// Open a full-page profile while remembering the list scroll offset, so Back
// returns the user to the exact row they clicked.
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

// category identity — emoji + colour, used everywhere a supplier category shows up.
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
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-y-3 px-4 py-3.5 sm:px-6">
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
              <button
                key={m.key}
                onClick={() => setModule(m.key)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition ${
                  module === m.key ? "bg-white text-[#0b3b39] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{m.emoji}</span>
                {m.label}
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
  emoji: string; title: string; subtitle: string; tint: string;
  stats: { label: string; value: string }[];
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

function SubTabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; emoji: string }[]; value: T; onChange: (t: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
            value === t.key ? "bg-white text-teal-700 shadow-sm ring-1 ring-teal-200" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{t.emoji}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CatChip({ cat }: { cat: string }) {
  const c = catColor(cat);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1"
      style={{ background: `${c}14`, color: c, borderColor: `${c}33`, boxShadow: `inset 0 0 0 1px ${c}22` }}>
      <span>{catEmoji(cat)}</span>{cat}
    </span>
  );
}

function InsightCard({ ins, supplier, onOpen }: { ins: Insight; supplier?: string; onOpen?: () => void }) {
  const m = TONE_META[ins.tone];
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag onClick={onOpen} className={`w-full text-left rounded-2xl ${m.bg} p-4 ring-1 ${m.ring} transition ${onOpen ? "hover:shadow-md" : ""}`}>
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

/* --------------------------------------------------------- P0 Supplier view */

type SupTab = "insights" | "benchmark" | "directory";
const SUP_TABS: { key: SupTab; label: string; emoji: string }[] = [
  { key: "insights", label: "Insights", emoji: "💡" },
  { key: "benchmark", label: "Benchmark", emoji: "📊" },
  { key: "directory", label: "Directory", emoji: "📇" },
];

function SupplierView() {
  const all = useMemo(() => supplyEntities(), []);
  const [tab, setTab] = useState<SupTab>("insights");
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
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <ModuleHero
        emoji="🏭"
        title="Supplier Intelligence"
        subtitle="Financial health, negotiation levers & risk across every RM · PM · Manufacturer vendor"
        tint="from-[#0f766e] to-[#0891b2]"
        stats={[
          { label: "Suppliers", value: String(stats.tracked) },
          { label: "With financials", value: `${stats.withFin}` },
          { label: "Spend in view", value: crStr(stats.revCr) },
          { label: "Levers found", value: String(stats.opps) },
        ]}
      />

      <div className="mt-5 mb-4"><SubTabs tabs={SUP_TABS} value={tab} onChange={setTab} /></div>

      {tab === "insights" && <SupplierInsightsView all={all} onSelect={openSupplier} />}
      {tab === "benchmark" && <BenchmarkView all={all} onSelect={openSupplier} />}
      {tab === "directory" && <DirectoryView all={all} onSelect={openSupplier} />}
    </main>
  );
}

/* -------- Suppliers · Insights tab (the negotiation / analysis hub) -------- */

function SupplierInsightsView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const rows = useMemo(
    () => all.map((e) => ({ e, ins: supplierInsights(e) })).filter((x) => x.ins.length),
    [all]
  );
  const byTone = (tone: InsightTone) =>
    rows
      .flatMap(({ e, ins }) => ins.filter((i) => i.tone === tone).map((i) => ({ e, i })))
      .sort((a, b) => (revOf(b.e) ?? 0) - (revOf(a.e) ?? 0));

  const opp = byTone("opportunity");
  const risk = byTone("risk");
  const watch = byTone("watch");

  const columns: { tone: InsightTone; title: string; emoji: string; items: { e: Entity; i: Insight }[] }[] = [
    { tone: "opportunity", title: "Where you can push", emoji: "💸", items: opp },
    { tone: "risk", title: "Risk watchlist", emoji: "🚩", items: risk },
    { tone: "watch", title: "Keep an eye on", emoji: "👀", items: watch },
  ];

  return (
    <div className="space-y-4">
      {/* explainer callout — the core idea, in plain english */}
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🧠</span>
          <div className="text-sm leading-relaxed text-teal-900">
            <span className="font-semibold">How to read this:</span> each card is a ready-to-use negotiation angle or risk, built from a supplier's own numbers.
            For example — if a supplier <span className="font-semibold">collects cash from its customers in ~20 days</span> but we pay it in 10, we're paying faster than it needs, so there's room to push our terms out.
            Fat margins mean room on price; a tight cash cycle means they'll take an early-payment discount. Click any card to open the full profile.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {columns.map((col) => {
          const m = TONE_META[col.tone];
          return (
            <div key={col.tone} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg">{col.emoji}</span>
                <h3 className="text-sm font-bold text-slate-800">{col.title}</h3>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${m.bg} ${m.text}`}>{col.items.length}</span>
              </div>
              <div className="space-y-2.5">
                {col.items.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">Nothing here — a good sign.</div>
                ) : (
                  col.items.map(({ e, i }, idx) => (
                    <InsightCard key={e.folder + idx} ins={i} supplier={`${catEmoji(e.category)} ${e.brand}`} onOpen={() => onSelect(e)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------- Suppliers · Benchmark tab (compare across the portfolio) -------- */

type MetricKey = "revenue" | "ebitda" | "roce" | "dso" | "dpo" | "ccc";
const SUP_METRICS: { key: MetricKey; label: string; emoji: string; get: (e: Entity) => number | null; unit: (v: number) => string; note: string }[] = [
  { key: "revenue", label: "Revenue", emoji: "💵", get: (e) => toCrore(revOf(e)), unit: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`), note: "Bigger vendors — where most of the spend sits." },
  { key: "ebitda", label: "EBITDA margin", emoji: "💰", get: (e) => ebitdaMarginOf(e), unit: (v) => `${Math.round(v)}%`, note: "Fatter margin = more cushion in their pricing to negotiate on." },
  { key: "roce", label: "Return on capital", emoji: "⚙️", get: (e) => supRoce(e), unit: (v) => `${Math.round(v)}%`, note: "How efficiently they turn capital into profit — high = a strong, healthy vendor." },
  { key: "dso", label: "Collects in (DSO)", emoji: "📥", get: (e) => supDSO(e), unit: (v) => `${Math.round(v)} d`, note: "How fast they collect from their own customers. Low = healthy cash, so we can push our payment terms out." },
  { key: "dpo", label: "Pays suppliers in (DPO)", emoji: "📤", get: (e) => supDPO(e), unit: (v) => `${Math.round(v)} d`, note: "How long they take to pay their own suppliers. High = they already stretch terms, so asking the same of them is credible." },
  { key: "ccc", label: "Cash cycle", emoji: "🔄", get: (e) => supCCC(e), unit: (v) => `${Math.round(v)} d`, note: "Days cash is tied up. Long = they're cash-hungry and will value an early-payment discount." },
];
const SUP_CATS = ["All", "RM Vendor", "PM Vendor", "Manufacturer"] as const;

function BenchmarkView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const m = SUP_METRICS.find((x) => x.key === metric)!;

  const pool = useMemo(() => (cat === "All" ? all : all.filter((e) => e.category === cat)), [all, cat]);

  const bars: Slice[] = useMemo(
    () =>
      pool
        .map((e) => ({ e, v: m.get(e) }))
        .filter((x): x is { e: Entity; v: number } => x.v != null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 14)
        .map(({ e, v }) => ({ label: e.brand, value: Math.round(v * 10) / 10, color: catColor(e.category), sub: e.category })),
    [pool, m]
  );
  const byName = useMemo(() => new Map(all.map((e) => [e.brand, e])), [all]);

  // Payment-terms map — the headline lever: collects (DSO) vs pays (DPO).
  const payTerms = useMemo(
    () =>
      pool
        .map((e) => ({ e, dso: supDSO(e), dpo: supDPO(e) }))
        .filter((x): x is { e: Entity; dso: number; dpo: number } => x.dso != null && x.dpo != null)
        .sort((a, b) => a.dso - b.dso)
        .slice(0, 12),
    [pool]
  );
  const payMax = Math.max(1, ...payTerms.flatMap((p) => [p.dso, p.dpo]));

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SUP_METRICS.map((x) => (
            <button
              key={x.key}
              onClick={() => setMetric(x.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition ${
                metric === x.key ? "bg-teal-600 text-white ring-teal-600 shadow-sm" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"
              }`}
            >
              <span>{x.emoji}</span>
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUP_CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
                cat === c ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"
              }`}
            >
              {c === "All" ? "All" : `${catEmoji(c)} ${c}`}
            </button>
          ))}
        </div>
      </div>

      <Card title={`${m.emoji} ${m.label} — ranked`} sub={m.note} accent={catColor(cat === "All" ? "RM Vendor" : cat)}>
        {bars.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No suppliers with this metric yet.</div>
        ) : (
          <HBars data={bars} valueLabel={m.unit} onBar={(l) => byName.get(l) && onSelect(byName.get(l)!)} />
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {Object.keys(CAT_META).map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: catColor(c) }} />{catEmoji(c)} {c}
            </span>
          ))}
        </div>
      </Card>

      {/* signature payment-terms map */}
      <Card
        title="💸 Payment-terms map — who we can push"
        sub="Teal = days they take to COLLECT from customers · Amber = days they take to PAY their suppliers. Short collection + long payment = they run on other people's cash, so extending our terms is realistic."
        accent="#0d9488"
      >
        {payTerms.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No suppliers with both collection & payment days yet.</div>
        ) : (
          <div className="space-y-3">
            {payTerms.map(({ e, dso, dpo }) => (
              <button key={e.folder} onClick={() => onSelect(e)} className="group grid w-full grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-left">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">{e.brand}</div>
                  <div className="text-[11px] text-slate-400">{catEmoji(e.category)} {e.category}</div>
                </div>
                <div className="space-y-1">
                  <TermBar value={dso} max={payMax} color="#0d9488" label={`collects in ${Math.round(dso)}d`} />
                  <TermBar value={dpo} max={payMax} color="#f59e0b" label={`pays in ${Math.round(dpo)}d`} />
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
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 rounded-full bg-slate-100">
        <div className="h-3 rounded-full" style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
      </div>
      <span className="w-28 shrink-0 text-[11px] text-slate-500">{label}</span>
    </div>
  );
}

/* -------- Suppliers · Directory tab (the table) -------- */

function DirectoryView({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const [cat, setCat] = useState<(typeof SUP_CATS)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"revenue" | "ebitda" | "room" | "name">("revenue");

  const rows = useMemo(() => {
    let r = all;
    if (cat !== "All") r = r.filter((e) => e.category === cat);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((e) => `${e.brand} ${e.legalName ?? ""} ${e.cin ?? ""}`.toLowerCase().includes(q));
    const roomRank: Record<Room, number> = { High: 3, Medium: 2, Low: 1, Unknown: 0 };
    return [...r].sort((a, b) => {
      switch (sort) {
        case "name": return a.brand.localeCompare(b.brand);
        case "ebitda": return (ebitdaMarginOf(b) ?? -1) - (ebitdaMarginOf(a) ?? -1);
        case "room": return roomRank[negotiationRoom(b)] - roomRank[negotiationRoom(a)];
        default: return (revOf(b) ?? -1) - (revOf(a) ?? -1);
      }
    });
  }, [all, cat, query, sort]);

  const withData = useMemo(() => rows.filter((e) => revOf(e) != null), [rows]);
  const noData = useMemo(() => rows.filter((e) => revOf(e) == null), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SUP_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
                cat === c ? "bg-teal-50 text-teal-700 ring-teal-300" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"
              }`}>
              {c === "All" ? "All" : `${catEmoji(c)} ${c}`}
              <span className="ml-1.5 text-xs text-slate-400">{c === "All" ? all.length : all.filter((e) => e.category === c).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
            className="w-52 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-teal-400" />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400">
            {[["revenue", "Revenue"], ["ebitda", "EBITDA margin"], ["room", "Negotiation room"], ["name", "Name"]].map(([v, l]) => (
              <option key={v} value={v}>Sort: {l}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <Th>Company</Th><Th>Category</Th><Th right>Revenue</Th><Th right>EBITDA %</Th>
              <Th right>Net %</Th><Th right>RoCE</Th><Th right>Collects</Th><Th right>Pays</Th><Th>Negotiation room</Th><Th>Risk</Th>
            </tr>
          </thead>
          <tbody>
            {withData.map((e) => {
              const room = negotiationRoom(e);
              return (
                <tr key={e.category + e.folder} onClick={() => onSelect(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                  <td className="px-4 py-3"><div className="font-medium text-slate-900">{e.brand}</div>
                    <div className="truncate text-xs text-slate-400">{e.legalName ?? e.folder}</div></td>
                  <td className="px-4 py-3"><CatChip cat={e.category} /></td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(revOf(e))}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(ebitdaMarginOf(e))}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(netMarginOf(e))}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(supRoce(e))}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{fmtDays(supDSO(e))}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{fmtDays(supDPO(e))}</td>
                  <td className="px-4 py-3"><Pill cls={ROOM_META[room].cls} dot={ROOM_META[room].dot}>{ROOM_META[room].label}</Pill></td>
                  <td className="px-4 py-3"><RiskCell e={e} /></td>
                </tr>
              );
            })}
            {withData.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                {noData.length > 0 ? "No suppliers with parsed financials match — see limited public data below." : "Nothing matches this filter."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {noData.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Limited public data</h3>
            <span className="text-xs text-slate-400">{noData.length} vendor{noData.length > 1 ? "s" : ""} · no financial filing in Tracxn</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {noData.map((e) => (
              <button key={e.category + e.folder} onClick={() => onSelect(e)} className="rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-teal-300">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{e.brand}</div>
                    <div className="truncate text-xs text-slate-400">{e.legalName ?? e.folder}</div>
                  </div>
                  <CatChip cat={e.category} />
                </div>
                <div className="mt-1.5 text-xs text-slate-400">{e.city ? `${e.city} · ` : ""}Registry basics only — click to view</div>
              </button>
            ))}
          </div>
        </div>
      )}
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
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <ModuleHero
        emoji="🥊"
        title="Competitor Benchmarking"
        subtitle="How rival BPC brands stack up on revenue, funding, pricing & the digital shelf"
        tint="from-[#6d28d9] to-[#db2777]"
        stats={[
          { label: "Brands", value: String(all.length) },
          { label: "Categories", value: String(COMPETITOR_CATEGORIES.length) },
          { label: "Revenue in view", value: crStr(revCr) },
          { label: "With deals", value: String(all.filter((e) => e.competitor?.materialEvent).length) },
        ]}
      />

      <div className="mt-5 mb-4"><SubTabs tabs={[{ key: "overview", label: "Overview", emoji: "📊" }, { key: "table", label: "Directory", emoji: "📇" }]} value={view} onChange={(v) => setView(v as typeof view)} /></div>

      {view === "overview" && <CompetitorOverview all={all} onSelect={openCompetitor} />}

      {view === "table" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(["All", ...COMPETITOR_CATEGORIES] as CompCat[]).map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${cat === c ? "bg-violet-50 text-violet-700 ring-violet-300" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"}`}>
                  {c}<span className="ml-1.5 text-xs text-slate-400">{c === "All" ? all.length : all.filter((e) => e.categories.includes(c)).length}</span>
                </button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-56 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-violet-400" />
          </div>

          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <Th>Brand</Th><Th>Categories</Th><Th right>Revenue</Th><Th right>Funding</Th><Th>Stage</Th><Th>Latest deal / event</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.cin || e.brand} onClick={() => openCompetitor(e)} className="cursor-pointer border-t border-slate-100 transition hover:bg-violet-50/40">
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{e.brand}</div>
                      <div className="truncate text-xs text-slate-400">{e.parent ?? e.legalName ?? ""}</div></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{e.categories.map((c) => (<span key={c} className="rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: `${CAT5_COLOR[c] ?? "#94a3b8"}18`, color: CAT5_COLOR[c] ?? "#64748b" }}>{c}</span>))}</div></td>
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

  const topRev: Slice[] = useMemo(
    () => [...all].filter((e) => revOf(e)).sort((a, b) => (revOf(b) ?? 0) - (revOf(a) ?? 0)).slice(0, 8).map((e) => ({ label: e.brand, value: Math.round(toCrore(revOf(e)) ?? 0), color: "#6d28d9" })),
    [all]
  );
  const discount: Slice[] = useMemo(
    () => [...all].filter((e) => e.shelf?.avgDiscountPct != null).sort((a, b) => (b.shelf!.avgDiscountPct ?? 0) - (a.shelf!.avgDiscountPct ?? 0)).slice(0, 8)
      .map((e) => ({ label: e.brand, sub: e.shelf!.skuCount ? `${e.shelf!.skuCount} Nykaa SKUs` : undefined, value: Math.round(e.shelf!.avgDiscountPct ?? 0), color: "#eb6834" })),
    [all]
  );
  const traction: Slice[] = useMemo(
    () => [...all].filter((e) => e.shelf?.totalReviews).sort((a, b) => (b.shelf!.totalReviews ?? 0) - (a.shelf!.totalReviews ?? 0)).slice(0, 8).map((e) => ({ label: e.brand, value: Math.round((e.shelf!.totalReviews ?? 0) / 1e5) / 10, color: "#2a78d6" })),
    [all]
  );
  const cats: Slice[] = useMemo(
    () => COMPETITOR_CATEGORIES.map((c) => ({ label: c, value: all.filter((e) => e.categories.includes(c)).length, color: CAT5_COLOR[c] ?? "#94a3b8" })).sort((a, b) => b.value - a.value),
    [all]
  );
  const fundingGroups = (["Acquired", "VC-funded", "Unfunded", "Unknown"] as const)
    .map((k) => ({ bucket: k, brands: all.filter((e) => fundingBucket(e.competitor?.stage) === k) }))
    .filter((g) => g.brands.length);
  const events = useMemo(() => all.filter((e) => e.competitor?.materialEvent).slice(0, 6), [all]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="💜 Top competitors by revenue" sub="latest disclosed · ₹ crore" accent="#6d28d9">
        <HBars data={topRev} valueLabel={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${v} Cr`)} onBar={pick} />
      </Card>
      <Card title="🏷️ Heaviest discounting" sub="avg % off MRP on their live Nykaa shelf — high = liquidation or heavy marketing" accent="#eb6834">
        <HBars data={discount} valueLabel={(v) => `${v}%`} onBar={pick} />
      </Card>
      <Card title="🔥 Market traction" sub="total Nykaa reviews (millions) — a sales-velocity proxy" accent="#2a78d6">
        <HBars data={traction} valueLabel={(v) => `${v}m`} onBar={pick} />
      </Card>
      <Card title="📚 Category presence" sub="rivals active per BPC category" accent="#e34948">
        <HBars data={cats} valueLabel={(v) => String(v)} />
      </Card>
      <Card title="💰 Funding status" sub="which rivals are funded, acquired, or bootstrapped" accent="#4a3aa7">
        <div className="space-y-3">
          {fundingGroups.map(({ bucket, brands }) => (
            <div key={bucket}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLOR[bucket] }} />
                <span className="text-sm font-semibold text-slate-700">{bucket}</span>
                <span className="text-xs text-slate-400">{brands.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {brands.map((e) => (
                  <button key={e.cin || e.brand} onClick={() => onSelect(e)} title={e.competitor?.materialEvent ?? undefined}
                    className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-900">{e.brand}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="📰 Recent deals & events" sub="fundraises & acquisitions" accent="#db2777">
        {events.length === 0 ? (
          <div className="text-sm text-slate-400">No material events tracked.</div>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.cin || e.brand} onClick={() => onSelect(e)} className="cursor-pointer rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 hover:bg-slate-100">
                <div className="text-sm font-medium text-slate-800">{e.brand}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{e.competitor?.materialEvent}</div>
              </li>
            ))}
          </ul>
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

  const fyShort = (fy: string) => "'" + fy.split("-")[1];
  const revTrend: Slice[] = d.trend.map((t) => ({ label: fyShort(t.fy), value: cr(t.revenueINR), color: "#0d9488" }));
  const profitTrend: Slice[] = d.trend.map((t) => ({ label: fyShort(t.fy), value: cr(t.netProfitINR), color: (t.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" }));
  const dsoTrend: Slice[] = d.ratioTrend.map((t) => ({ label: fyShort(t.fy), value: t.dso ?? 0, color: "#2a78d6" }));
  const marginTrend: Slice[] = d.ratioTrend.map((t) => ({ label: fyShort(t.fy), value: t.ebitdaMarginPct ?? 0, color: (t.ebitdaMarginPct ?? 0) >= 0 ? "#1baf7a" : "#e34948" }));

  if (selected) return <CompanyPage entity={selected} onBack={back} kind="delivery" />;

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <ModuleHero
        emoji="🚚"
        title="Delivery Partners"
        subtitle="Last-mile & logistics partners — financial strength and the receivables (DSO) credit lever"
        tint="from-[#0369a1] to-[#0d9488]"
        stats={[
          { label: "Partners", value: String(partners.length) },
          { label: "Listed", value: String(partners.filter((p) => p.listed).length) },
          { label: "Delhivery rev", value: crStr(cr(d.revenueINR)) },
          { label: "Delhivery DSO", value: `${Math.round(d.dso ?? 0)} d` },
        ]}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="📈 Delhivery — revenue trend" sub="₹ crore · consolidated · FY14–FY25" className="lg:col-span-2" accent="#0d9488">
          <AreaLine data={revTrend} color="#0d9488" valueLabel={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`)} />
        </Card>
        <Card title="💰 Latest financials" sub={`FY ${d.latestFY}`} accent="#0891b2">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Revenue" value={crStr(cr(d.revenueINR))} />
            <Stat label="Net profit" value={crStr(cr(d.netProfitINR))} />
            <Stat label="EBITDA margin" value={d.ebitdaMarginPct != null ? `${d.ebitdaMarginPct}%` : "—"} />
            <Stat label="DSO" value={`${Math.round(d.dso ?? 0)} d`} />
          </div>
          <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
            Turned profitable in FY {d.latestFY} (+{crStr(cr(d.netProfitINR))}) after years of losses.
          </div>
        </Card>
        <Card title="📉 Delhivery — profit turnaround" sub="net profit / (loss), ₹ crore" className="lg:col-span-2" accent="#e34948">
          <Columns data={profitTrend} valueLabel={(v) => (v >= 0 ? `₹${v}` : `-₹${Math.abs(v)}`)} />
        </Card>
        <Card title="🚚 Partner roster" sub="identified legal entities" accent="#4a3aa7">
          <ul className="space-y-2">
            {partners.map((p) => (
              <li key={p.brand} onClick={() => { const e = partnerEnts.get(nm(p.brand)); if (e) openPartner(e); }}
                className={`flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200 ${partnerEnts.get(nm(p.brand))?.profile ? "cursor-pointer hover:bg-teal-50/60" : ""}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{p.brand}</div>
                  <div className="truncate text-xs text-slate-400">{p.legalName ?? "—"}</div>
                </div>
                {p.listed ? <Pill cls="text-emerald-700 bg-emerald-50 ring-emerald-200">Listed</Pill> : <Pill cls="text-slate-600 bg-slate-100 ring-slate-200">Private</Pill>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="🏦 Delhivery — receivables (DSO) trend" sub="days sales outstanding by year — the credit lever over time" className="lg:col-span-3" accent="#2a78d6">
          <AreaLine data={dsoTrend} color="#2a78d6" valueLabel={(v) => `${Math.round(v)}d`} height={140} />
        </Card>
        <Card title="⚡ Delhivery — EBITDA margin trend" sub="% by year — the path from deep losses to profit" className="lg:col-span-3" accent="#1baf7a">
          <Columns data={marginTrend} valueLabel={(v) => `${v}%`} height={155} />
        </Card>
      </div>
    </main>
  );
}

/* ----------------------------------------------------------- company page */

type CompanyKind = "supplier" | "competitor" | "delivery";
type CardDesc = { key: string; title: string; sub?: string; node: React.ReactNode };
type CompanyTab = "trends" | "financials" | "insights" | "profile";

const TAB_KEYS: Record<CompanyTab, string[]> = {
  trends: ["revprofit", "returns"],
  financials: ["reported", "balance", "cost", "cashflow", "probe", "health"],
  profile: ["details", "cats", "event", "shelf", "ownership", "board", "loans", "peers", "investors", "ma", "research"],
  insights: [],
};
const WIDE_KEYS = new Set(["revprofit", "returns", "health", "research", "shelf"]);

function CompanyPage({ entity: e, onBack, kind }: { entity: Entity; onBack: () => void; kind: CompanyKind }) {
  useEffect(() => { window.scrollTo(0, 0); }, [e.folder, e.category]);
  const [tab, setTab] = useState<CompanyTab>("trends");
  const cards = useMemo(() => companyCards(e, kind), [e, kind]);
  const ins = useMemo(() => supplierInsights(e), [e]);
  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);

  const py = latestYear(e);
  const room = negotiationRoom(e);
  const flags = e.pdf?.riskFlags ?? [];
  const roce = py?.rocePct ?? e.probe?.roce ?? null;
  const backLabel = kind === "competitor" ? "competitors" : kind === "delivery" ? "delivery" : "suppliers";
  const parentGroup = isParentBackedProfile(e) ? e.profile?.parent ?? "its parent group" : null;

  const f = e.financials;
  const hasReported =
    revOf(e) != null || f.ebitdaINR != null || f.netProfitINR != null || f.employeeCount != null ||
    f.paidUpCapitalINR != null || f.authorizedCapitalINR != null ||
    f.revenueCAGR1yrPct != null || f.revenueCAGR3yrPct != null || f.revenueCAGR5yrPct != null;
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

  const tabsAvail: { key: CompanyTab; label: string; emoji: string }[] = [
    { key: "trends", label: "Trends", emoji: "📈" },
    { key: "financials", label: "Financials", emoji: "💰" },
    { key: "insights", label: "Insights", emoji: "💡" },
    { key: "profile", label: "Profile", emoji: "🏢" },
  ];

  const tabCards = (t: CompanyTab) => TAB_KEYS[t].map((k) => cardByKey.get(k)).filter((c): c is CardDesc => !!c);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <button onClick={onBack} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-teal-700">
        <span className="text-base leading-none">←</span> Back to {backLabel}
      </button>

      {/* colourful hero */}
      <div className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b3b39] via-[#0d9488] to-[#0891b2] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold ring-1 ring-white/25">
              {kind === "supplier" ? catEmoji(e.category) : e.brand.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-bold tracking-tight">{e.brand}</div>
              <div className="mt-0.5 text-sm text-white/70">{e.legalName ?? e.folder}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20">{catEmoji(e.category)} {e.category}</span>
                {kind !== "competitor" && room !== "Unknown" && (
                  <span className="rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20">Negotiation room: {room}</span>
                )}
                {e.pdf && (flags.length
                  ? <span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-xs font-medium text-rose-100 ring-1 ring-rose-300/30">🚩 {flags.length} risk flag{flags.length > 1 ? "s" : ""}</span>
                  : <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-xs font-medium text-emerald-100 ring-1 ring-emerald-300/30">✓ No risk flags</span>)}
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

      {parentGroup && (
        <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-800 ring-1 ring-sky-200">
          ℹ️ {e.brand} has no standalone financials — the trends & balance sheet below are <span className="font-medium">{parentGroup}</span>'s consolidated group filing, not {e.brand} alone.
        </div>
      )}
      {noFinancials && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          No financial data is available for this company in Tracxn — only the registry basics (Profile tab).
        </div>
      )}

      <div className="mt-4 mb-4"><SubTabs tabs={tabsAvail} value={tab} onChange={setTab} /></div>

      {tab === "insights" ? (
        ins.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 ring-1 ring-slate-200">No specific negotiation levers or risks surfaced for this company.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ins.map((i, idx) => <InsightCard key={idx} ins={i} />)}
          </div>
        )
      ) : (
        <CardGrid cards={tabCards(tab)} emptyLabel="Nothing to show in this tab for this company." />
      )}
    </main>
  );
}

// Render a tab's cards: wide ones (charts) full-width stacked on top, the rest in a
// tidy 2-column masonry. Keeps things aligned — no 3-column triangle.
function CardGrid({ cards, emptyLabel }: { cards: CardDesc[]; emptyLabel: string }) {
  if (cards.length === 0) return <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 ring-1 ring-slate-200">{emptyLabel}</div>;
  const wide = cards.filter((c) => WIDE_KEYS.has(c.key));
  const narrow = cards.filter((c) => !WIDE_KEYS.has(c.key));
  return (
    <div className="space-y-4">
      {wide.map((c) => <Card key={c.key} title={c.title} sub={c.sub} accent="#0d9488">{c.node}</Card>)}
      {narrow.length > 0 && (
        <div className="gap-4 [column-fill:balance] sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {narrow.map((c) => <Card key={c.key} title={c.title} sub={c.sub} accent="#0d9488">{c.node}</Card>)}
        </div>
      )}
    </div>
  );
}

// Assemble every card we can render for a company from the data we have.
function companyCards(e: Entity, kind: CompanyKind): CardDesc[] {
  const c = e.competitor;
  const cards: CardDesc[] = [];

  const details =
    kind === "competitor" ? (
      <dl className="space-y-2 text-sm">
        <Row k="Legal entity" v={e.legalName ?? "—"} /><Row k="CIN" v={e.cin ?? "—"} mono />
        <Row k="HQ" v={c?.hqCity ?? "—"} /><Row k="Founders" v={c?.founders?.length ? c.founders.join(", ") : "—"} />
        <Row k="Latest round" v={c?.latestRound?.name ? `${c.latestRound.name}${c.latestRound.date ? " · " + c.latestRound.date : ""}` : "—"} />
        <Row k="Sells in" v={c?.geoServed?.length ? c.geoServed.slice(0, 6).join(", ") : "—"} />
        <Row k="Website" v={e.website ?? "—"} />
      </dl>
    ) : (
      <dl className="space-y-2 text-sm">
        <Row k="Category" v={e.category} /><Row k="CIN" v={e.cin ?? "—"} mono /><Row k="PAN" v={e.pan ?? "—"} mono />
        <Row k="Entity type" v={e.entityType ?? "—"} /><Row k="Incorporated" v={fmtDate(e.incorporationDate)} />
        <Row k="Registrar status" v={e.statusAtRegistrar ?? "—"} />
        <Row k="Location" v={[(e.state ?? "").replace(/\s*\(implied\)\s*/i, "").trim() || null, e.city].filter(Boolean).join(" · ") || "—"} />
        <Row k="Industry" v={e.industry ?? "—"} /><Row k="Auditor" v={e.auditor ?? "—"} />
        <Row k="LEI" v={e.lei ?? "—"} mono /><Row k="Parent" v={e.parent ?? "—"} />
      </dl>
    );
  cards.push({ key: "details", title: "🏢 Company details", node: details });

  const f = e.financials;
  const cagr = [f.revenueCAGR1yrPct, f.revenueCAGR3yrPct, f.revenueCAGR5yrPct];
  const reported: React.ReactNode[] = [];
  if (f.ebitdaINR != null) reported.push(<Stat key="ebitda" label="EBITDA" value={fmtCrore(f.ebitdaINR)} />);
  if (cagr.some((v) => v != null)) reported.push(<Stat key="cagr" label="Rev CAGR 1y / 3y / 5y" value={cagr.map((v) => fmtPct(v)).join(" / ")} />);
  if (f.employeeCount != null) reported.push(<Stat key="emp" label="Employees" value={fmtInt(f.employeeCount)} />);
  if (f.paidUpCapitalINR != null) reported.push(<Stat key="paid" label="Paid-up capital" value={fmtCrore(f.paidUpCapitalINR)} />);
  if (f.authorizedCapitalINR != null) reported.push(<Stat key="auth" label="Authorized capital" value={fmtCrore(f.authorizedCapitalINR)} />);
  if (reported.length) cards.push({ key: "reported", title: "📋 Reported financials", node: <div className="grid grid-cols-2 gap-3">{reported}</div> });

  if (kind === "competitor" && (e as CompetitorRow).categories?.length) {
    cards.push({ key: "cats", title: "🧴 Competes in", node: (
      <div className="flex flex-wrap gap-1.5">
        {(e as CompetitorRow).categories.map((cat) => (
          <span key={cat} className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: `${CAT5_COLOR[cat] ?? "#94a3b8"}18`, color: CAT5_COLOR[cat] ?? "#64748b" }}>{cat}</span>
        ))}
      </div>
    ) });
  }

  if (c?.materialEvent) cards.push({ key: "event", title: "📰 Latest material event", node: <p className="text-sm leading-relaxed text-slate-700">{c.materialEvent}</p> });

  if (e.shelf) {
    cards.push({ key: "shelf", title: `🛒 Live shelf · ${e.shelf.channels.join(", ")}`, sub: e.shelf.scrapedAt ? `scraped ${fmtDate(e.shelf.scrapedAt)}` : undefined, node: (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Products" value={String(e.shelf.skuCount)} />
          <Stat label="Avg rating" value={e.shelf.avgRating != null ? `${e.shelf.avgRating} ★` : "—"} />
          <Stat label="Avg discount" value={fmtPct(e.shelf.avgDiscountPct)} />
          <Stat label="Reviews" value={fmtInt(e.shelf.totalReviews)} />
        </div>
        {e.shelf.topSku?.name && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-medium text-slate-500">Hero SKU (most-reviewed)</div>
            <div className="mt-0.5 text-slate-800">{e.shelf.topSku.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {e.shelf.topSku.rating != null ? `${e.shelf.topSku.rating}★ · ` : ""}{fmtInt(e.shelf.topSku.reviewCount)} reviews{e.shelf.topSku.priceINR != null ? ` · ₹${e.shelf.topSku.priceINR}` : ""}
            </div>
          </div>
        )}
      </>
    ) });
  }

  if (e.probe) {
    cards.push({ key: "probe", title: "🔬 Probe42 · deep financials", node: (
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Receivable days" value={fmtDays(e.probe.receivableDays)} />
        <Stat label="Payable days" value={fmtDays(e.probe.payableDays)} />
        <Stat label="RoCE" value={fmtPct(e.probe.roce)} />
        <Stat label="Cash conversion" value={fmtDays(e.probe.cashConversionCycleDays)} />
        <Stat label="Peer median payables" value={fmtDays(e.probe.peerMedianPayableDays)} />
        <Stat label="Credit rating" value={e.probe.creditRating ?? "—"} />
      </div>
    ) });
  }

  if (e.pdf) cards.push({ key: "health", title: "🩺 Financial health & risk · Tracxn", node: <HealthRiskBody pdf={e.pdf} /> });

  if (e.profile) cards.push(...profileSections(e.profile));

  if (c?.investors?.length) cards.push({ key: "investors", title: "🤝 Investors", node: (
    <div className="flex flex-wrap gap-1.5">{c.investors.map((inv) => <span key={inv} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{inv}</span>)}</div>
  ) });

  if (e.research) cards.push({ key: "research", title: "🔎 Research", node: <ResearchBody r={e.research} /> });

  return cards;
}

function RiskCell({ e }: { e: Entity }) {
  const flags = e.pdf?.riskFlags ?? [];
  if (!e.pdf) return <span className="text-slate-300">—</span>;
  if (!flags.length) return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Clear</span>;
  return (
    <span title={flags.join(" · ")} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{flags.length} flag{flags.length > 1 ? "s" : ""}
    </span>
  );
}

function profileSections(p: SupplierProfile): CardDesc[] {
  const years = [...p.years].sort((a, b) => a.fy.localeCompare(b.fy));
  const latest = years[years.length - 1];
  const fyShort = (s: string) => "'" + (s.split("-")[1] ?? s);
  const cr = (v: number | null) => Math.round((v ?? 0) / 1e7);
  const num2 = (v: number | null) => (v != null ? v.toFixed(2) : "—");
  const rev = years.map((y) => ({ label: fyShort(y.fy), value: cr(y.revenueINR), color: "#0d9488" }));
  const profit = years.map((y) => ({ label: fyShort(y.fy), value: cr(y.netProfitINR), color: (y.netProfitINR ?? 0) >= 0 ? "#1baf7a" : "#e34948" }));
  const roce = years.map((y) => ({ label: fyShort(y.fy), value: Math.round(y.rocePct ?? 0), color: "#4a3aa7" }));
  const dso = years.map((y) => ({ label: fyShort(y.fy), value: Math.round(y.receivableDays ?? 0), color: "#2a78d6" }));
  const hasReturns = years.some((y) => y.rocePct != null || y.receivableDays != null);
  const cs = p.costStructure;
  const costBars = [
    { label: "Materials", value: cr(cs.materialsINR), color: "#0d9488" },
    { label: "Employee", value: cr(cs.employeeINR), color: "#4a3aa7" },
    { label: "Marketing", value: cr(cs.marketingINR), color: "#eda100" },
    { label: "Freight", value: cr(cs.freightINR), color: "#2a78d6" },
    { label: "Finance", value: cr(cs.financeINR), color: "#e34948" },
    { label: "Depreciation", value: cr(cs.depreciationINR), color: "#eb6834" },
  ].filter((d) => d.value > 0);

  const out: CardDesc[] = [];

  if (years.length > 1) {
    out.push({ key: "revprofit", title: `📈 Revenue & profit · ${years.length}-yr`, sub: `FY${years[0].fy} → FY${latest.fy}`, node: (
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="mb-1 text-xs text-slate-500">Revenue (₹ Cr)</div><AreaLine data={rev} color="#0d9488" valueLabel={(v) => `₹${v.toLocaleString("en-IN")} Cr`} /></div>
        <div><div className="mb-1 text-xs text-slate-500">Net profit / (loss) (₹ Cr)</div><Columns data={profit} valueLabel={(v) => `₹${v.toLocaleString("en-IN")}`} /></div>
      </div>
    ) });
  }

  if (years.length > 1 && hasReturns) {
    out.push({ key: "returns", title: "⚙️ Returns & working capital", node: (
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="mb-1 text-xs text-slate-500">RoCE (%)</div><AreaLine data={roce} color="#4a3aa7" valueLabel={(v) => `${v}%`} /></div>
        <div><div className="mb-1 text-xs text-slate-500">Receivable days — how fast they collect</div><AreaLine data={dso} color="#2a78d6" valueLabel={(v) => `${v}d`} /></div>
      </div>
    ) });
  }

  if (latest) {
    out.push({ key: "balance", title: `⚖️ Balance sheet & ratios · FY${latest.fy}`, node: (
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total debt" value={fmtCrore(latest.totalDebtINR)} />
        <Stat label="Total equity" value={fmtCrore(latest.totalEquityINR)} />
        <Stat label="Receivables" value={fmtCrore(latest.tradeReceivablesINR)} />
        <Stat label="Payables" value={fmtCrore(latest.tradePayablesINR)} />
        <Stat label="Inventory" value={fmtCrore(latest.inventoryINR)} />
        <Stat label="Cash" value={fmtCrore(latest.cashINR)} />
        <Stat label="Current ratio" value={num2(latest.currentRatio)} />
        <Stat label="Debt / equity" value={num2(latest.debtToEquity)} />
        <Stat label="Interest coverage" value={latest.interestCoverage != null ? `${latest.interestCoverage.toFixed(1)}x` : "—"} />
        <Stat label="RoE" value={fmtPct(latest.roePct)} />
      </div>
    ) });
  }

  if (costBars.length > 0) {
    out.push({ key: "cost", title: `🧾 Cost structure${cs.fy ? ` · FY${cs.fy}` : ""}`, node: <HBars data={costBars} valueLabel={(v) => `₹${v.toLocaleString("en-IN")} Cr`} /> });
  }

  if (latest && (latest.cashFromOpsINR != null || latest.cashFromInvestingINR != null || latest.cashFromFinancingINR != null)) {
    out.push({ key: "cashflow", title: `💵 Cash flow · FY${latest.fy}`, node: (
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Operating" value={fmtCrore(latest.cashFromOpsINR)} />
        <Stat label="Investing" value={fmtCrore(latest.cashFromInvestingINR)} />
        <Stat label="Financing" value={fmtCrore(latest.cashFromFinancingINR)} />
      </div>
    ) });
  }

  if (p.acquisitions.length > 0) {
    out.push({ key: "ma", title: "🤝 M&A", node: (
      <div className="space-y-1">
        {p.acquisitions.map((a, i) => (
          <div key={i} className="rounded-lg bg-violet-50 p-2.5 text-sm ring-1 ring-violet-200">
            <span className="font-medium text-violet-900">{a.role === "acquired" ? "Acquired by" : "Acquired"} {a.counterparty ?? "—"}</span>
            <span className="text-violet-700"> {[a.stake, a.amountINR ? fmtCrore(a.amountINR) : null, a.date].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </div>
    ) });
  }

  if (p.parent || p.subsidiaries.length > 0 || p.capTable.founders.length > 0 || p.capTable.promoterPct != null) {
    out.push({ key: "ownership", title: "🏛️ Ownership & structure", node: (
      <>
        <dl className="space-y-2 text-sm">
          {p.parent && <Row k="Parent / group" v={p.parent} />}
          {p.capTable.promoterPct != null && <Row k="Promoter / public" v={`${p.capTable.promoterPct}% / ${p.capTable.publicPct ?? "—"}%`} />}
          {p.capTable.founders.length > 0 && <Row k="Founders" v={p.capTable.founders.join(", ")} />}
        </dl>
        {p.subsidiaries.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-xs text-slate-500">Subsidiaries</div>
            <div className="flex flex-wrap gap-1.5">{p.subsidiaries.map((s) => <span key={s} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">{s}</span>)}</div>
          </div>
        )}
      </>
    ) });
  }

  if (p.directors.length > 0) {
    out.push({ key: "board", title: "👔 Board", node: (
      <div className="space-y-1">
        {p.directors.map((d, i) => (
          <div key={i} className="flex justify-between gap-4 text-sm"><span className="text-slate-800">{d.name}</span><span className="text-right text-slate-400">{d.designation ?? ""}</span></div>
        ))}
      </div>
    ) });
  }

  if (p.loans.length > 0) {
    out.push({ key: "loans", title: "🏦 Loans & charges", node: (
      <div className="space-y-1">
        {p.loans.map((l, i) => (
          <div key={i} className="flex justify-between gap-4 text-sm"><span className="truncate text-slate-800">{l.lender}</span><span className="shrink-0 font-mono text-slate-500">{l.amountINR ? fmtCrore(l.amountINR) : "—"}{l.status ? ` · ${l.status}` : ""}</span></div>
        ))}
      </div>
    ) });
  }

  if (p.competitors.length > 0) {
    out.push({ key: "peers", title: "🥊 Competitors / comparables", node: (
      <div className="flex flex-wrap gap-1.5">{p.competitors.map((cName) => <span key={cName} className="rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800 ring-1 ring-teal-100">{cName}</span>)}</div>
    ) });
  }

  return out;
}

function HealthRiskBody({ pdf }: { pdf: SupplierPdf }) {
  const signed = (v: number | null, suffix = "%") => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}${suffix}`);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Current ratio" value={pdf.currentRatio != null ? pdf.currentRatio.toFixed(2) : "—"} />
        <Stat label="Interest coverage" value={pdf.interestCoverage != null ? `${pdf.interestCoverage.toFixed(1)}x` : "—"} />
        <Stat label="Debt / equity" value={pdf.debtToEquity != null ? pdf.debtToEquity.toFixed(2) : "—"} />
        <Stat label="Revenue YoY" value={signed(pdf.revenueChangePct)} />
        <Stat label="PAT 3-yr CAGR" value={signed(pdf.patCagr3yrPct)} />
        <Stat label="MSME delays" value={pdf.msme ? `${pdf.msme.count} · ₹${pdf.msme.amount}` : "None"} />
      </div>
      {pdf.riskFlags.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600">Risk flags</div>
          <div className="flex flex-wrap gap-1.5">{pdf.riskFlags.map((f, i) => <span key={i} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-rose-200">{f}</span>)}</div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">No risk indicators flagged in the latest filing.</div>
      )}
    </>
  );
}

function ResearchBody({ r }: { r: ResearchData }) {
  const List = ({ items }: { items: string[] }) => (
    <ul className="space-y-1.5 text-sm text-slate-700">{items.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400" />{s}</li>)}</ul>
  );
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
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{children}
    </span>
  );
}
function EmptyRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} className="px-4 py-10 text-center text-slate-400">Nothing matches this filter.</td></tr>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-slate-900">{value}</div>
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className={`text-right text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
