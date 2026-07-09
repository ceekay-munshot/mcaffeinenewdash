import { useMemo, useState } from "react";
import {
  DATA,
  supplyEntities,
  competitorRows,
  COMPETITOR_CATEGORIES,
  type Entity,
  type CompetitorRow,
} from "./types";
import { fmtCrore, fmtPct, fmtInt, fmtDate, fmtDays, fmtUSD, toCrore } from "./lib/format";
import { negotiationRoom, ROOM_META, COVERAGE_META, type Room } from "./lib/health";
import { CATEGORY_COLOR, COVERAGE_COLOR, ROOM_COLOR } from "./lib/palette";
import { Donut, HBars, Columns, Legend, Card, type Slice } from "./charts";
import { DELIVERY } from "./delivery";
import KIM from "@data/raw/masters/key_ingredients_manufacturers.json";

// Bill-of-materials rosters the client shared (raw materials + packaging specs).
const BOM = (KIM as { Sheet1: Record<string, string>[] }).Sheet1
  .filter((r) => r.col0 && r.col0 !== "Sr. No.");
const RAW_MATERIALS = [...new Set(BOM.map((r) => r.col1).filter((v) => v && !/sum of formulation/i.test(v)))];
const PACKAGING = [...new Set(BOM.map((r) => r.col2).filter(Boolean))];

type Module = "suppliers" | "competitors" | "delivery";

export default function App() {
  const [module, setModule] = useState<Module>("suppliers");
  return (
    <div className="min-h-full">
      <Header module={module} setModule={setModule} generatedAt={DATA.generatedAt} />
      {module === "suppliers" && <SupplierView />}
      {module === "competitors" && <CompetitorView />}
      {module === "delivery" && <DeliveryView />}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

const MODULE_META: Record<Module, { label: string; subtitle: string }> = {
  suppliers: { label: "Suppliers", subtitle: "P0 — Vendor & Manufacturer Financial Health" },
  competitors: { label: "Competitors", subtitle: "P2 — Category Competitor Benchmarking" },
  delivery: { label: "Delivery", subtitle: "P3 — Last-Mile Delivery Partner Insights" },
};

function Header({ module, setModule, generatedAt }: { module: Module; setModule: (m: Module) => void; generatedAt: string }) {
  const subtitle = MODULE_META[module].subtitle;
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500 font-bold text-white shadow-sm">m</div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-slate-900">
              mCaffeine <span className="font-normal text-slate-400">· CCO Command Center</span>
            </div>
            <div className="text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {(["suppliers", "competitors", "delivery"] as Module[]).map((m) => (
              <button
                key={m}
                onClick={() => setModule(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  module === m ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {MODULE_META[m].label}
              </button>
            ))}
          </nav>
          <div className="hidden text-right text-xs text-slate-400 sm:block">
            <div>Data snapshot</div>
            <div className="font-mono text-slate-600">{fmtDate(generatedAt)}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- P0 Supplier view */

const SUP_CATS = ["All", "RM Vendor", "PM Vendor", "Manufacturer"] as const;
type SupCat = (typeof SUP_CATS)[number];
type SupSort = "revenue" | "ebitda" | "name" | "room";

function SupplierView() {
  const all = useMemo(() => supplyEntities(), []);
  const [cat, setCat] = useState<SupCat>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SupSort>("revenue");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [view, setView] = useState<"overview" | "table">("overview");

  const rows = useMemo(() => {
    let r = all;
    if (cat !== "All") r = r.filter((e) => e.category === cat);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((e) => `${e.brand} ${e.legalName ?? ""} ${e.cin ?? ""}`.toLowerCase().includes(q));
    const roomRank: Record<Room, number> = { High: 3, Medium: 2, Low: 1, Unknown: 0 };
    return [...r].sort((a, b) => {
      switch (sort) {
        case "name": return a.brand.localeCompare(b.brand);
        case "ebitda": return (b.financials.ebitdaMarginPct ?? -1) - (a.financials.ebitdaMarginPct ?? -1);
        case "room": return roomRank[negotiationRoom(b)] - roomRank[negotiationRoom(a)];
        default: return (b.financials.revenueINR ?? -1) - (a.financials.revenueINR ?? -1);
      }
    });
  }, [all, cat, query, sort]);

  const kpis = useMemo(() => ({
    tracked: all.length,
    full: all.filter((e) => e.coverage === "full").length,
    partial: all.filter((e) => e.coverage === "partial").length,
    revCr: all.reduce((s, e) => s + (toCrore(e.financials.revenueINR) ?? 0), 0),
    highRoom: all.filter((e) => negotiationRoom(e) === "High").length,
  }), [all]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <section className="grid grid-cols-2 gap-3 py-6 lg:grid-cols-4">
        <Kpi label="Suppliers tracked" value={String(kpis.tracked)} sub="RM · PM · Manufacturers" />
        <Kpi label="Data coverage" value={`${kpis.full} full`} sub={`${kpis.partial} partial · numbers pending`} tone="emerald" />
        <Kpi label="Revenue in view" value={crStr(kpis.revCr)} sub="sum of disclosed supplier revenue" tone="teal" />
        <Kpi label="High negotiation room" value={String(kpis.highRoom)} sub="fat-margin suppliers to push on" tone="amber" />
      </section>

      <div className="mb-4 flex w-fit rounded-lg bg-slate-100 p-0.5 text-sm">
        {(["overview", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 font-medium capitalize transition ${view === v ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{v}</button>
        ))}
      </div>

      {view === "overview" && <SupplierOverview all={all} onSelect={setSelected} />}

      {view === "table" && (<>
      <Toolbar
        cats={SUP_CATS as unknown as string[]} cat={cat} setCat={(c) => setCat(c as SupCat)}
        count={(c) => (c === "All" ? all.length : all.filter((e) => e.category === c).length)}
        query={query} setQuery={setQuery}
        sortValue={sort} setSort={(s) => setSort(s as SupSort)}
        sortOptions={[["revenue", "Revenue"], ["ebitda", "EBITDA margin"], ["room", "Negotiation room"], ["name", "Name"]]}
      />

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <Th>Company</Th><Th>Category</Th><Th right>Revenue</Th><Th right>EBITDA %</Th>
              <Th right>Net %</Th><Th right>3-yr growth</Th><Th right>Staff</Th><Th>Negotiation room</Th><Th>Coverage</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const room = negotiationRoom(e);
              return (
                <tr key={e.category + e.folder} onClick={() => setSelected(e)}
                  className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                  <td className="px-4 py-3"><div className="font-medium text-slate-900">{e.brand}</div>
                    <div className="truncate text-xs text-slate-400">{e.legalName ?? e.folder}</div></td>
                  <td className="px-4 py-3 text-slate-500">{e.category}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(e.financials.revenueINR)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.ebitdaMarginPct)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.netMarginPct)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.revenueCAGR3yrPct)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{fmtInt(e.financials.employeeCount)}</td>
                  <td className="px-4 py-3"><Pill cls={ROOM_META[room].cls} dot={ROOM_META[room].dot}>{ROOM_META[room].label}</Pill></td>
                  <td className="px-4 py-3"><Pill cls={COVERAGE_META[e.coverage].cls}>{COVERAGE_META[e.coverage].label}</Pill></td>
                </tr>
              );
            })}
            {rows.length === 0 && <EmptyRow cols={9} />}
          </tbody>
        </table>
      </div>

      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-700">Negotiation room</span> is a transparent first-cut signal from EBITDA
        margin (≥20% High · 10–20% Medium · &lt;10% Low) — fatter supplier margins mean more room to push on price/terms.
        It sharpens once Probe42 adds receivable days &amp; RoCE.
      </p>
      </>)}

      {selected && <SupplierDetail entity={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

/* --------------------------------------------- P0 Supplier overview (charts) */

function SupplierOverview({ all, onSelect }: { all: Entity[]; onSelect: (e: Entity) => void }) {
  const byName = useMemo(() => new Map(all.map((e) => [e.brand, e])), [all]);

  const revByCat: Slice[] = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of all) m[e.category] = (m[e.category] ?? 0) + (toCrore(e.financials.revenueINR) ?? 0);
    return Object.entries(m)
      .map(([label, value]) => ({ label, value: Math.round(value), color: CATEGORY_COLOR[label] ?? "#94a3b8" }))
      .sort((a, b) => b.value - a.value);
  }, [all]);

  const topRev: Slice[] = useMemo(
    () =>
      [...all]
        .filter((e) => e.financials.revenueINR)
        .sort((a, b) => (b.financials.revenueINR ?? 0) - (a.financials.revenueINR ?? 0))
        .slice(0, 8)
        .map((e) => ({ label: e.brand, value: Math.round(toCrore(e.financials.revenueINR) ?? 0), color: CATEGORY_COLOR[e.category] ?? "#94a3b8" })),
    [all]
  );

  const coverage: Slice[] = useMemo(() => {
    const order = ["full", "partial", "not_found"] as const;
    return order.map((k) => ({ label: COVERAGE_META[k].label, value: all.filter((e) => e.coverage === k).length, color: COVERAGE_COLOR[k] }));
  }, [all]);

  const room: Slice[] = useMemo(() => {
    const order: Room[] = ["High", "Medium", "Low", "Unknown"];
    return order.map((k) => ({ label: k === "Unknown" ? "No data" : k, value: all.filter((e) => negotiationRoom(e) === k).length, color: ROOM_COLOR[k] }));
  }, [all]);

  const targets = useMemo(
    () =>
      [...all]
        .filter((e) => negotiationRoom(e) === "High" && e.financials.revenueINR)
        .sort((a, b) => (b.financials.revenueINR ?? 0) - (a.financials.revenueINR ?? 0))
        .slice(0, 5),
    [all]
  );

  const totalCr = Math.round(revByCat.reduce((s, d) => s + d.value, 0));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Top suppliers by revenue" sub="latest disclosed · ₹ crore · colour = category" className="lg:col-span-2">
        <HBars data={topRev} valueLabel={(v) => `₹${v.toLocaleString("en-IN")} Cr`} onBar={(l) => byName.get(l) && onSelect(byName.get(l)!)} />
        <div className="mt-4">
          <Legend items={Object.entries(CATEGORY_COLOR).map(([label, color]) => ({ label, color }))} />
        </div>
      </Card>

      <Card title="Revenue by category" sub="share of disclosed revenue">
        <Donut data={revByCat} centerValue={totalCr >= 1000 ? `₹${(totalCr / 1000).toFixed(0)}k` : `₹${totalCr}`} centerLabel="Cr total" unit=" Cr" />
      </Card>

      <Card title="Data coverage" sub="how complete each supplier is">
        <Donut data={coverage} centerValue={String(all.length)} centerLabel="suppliers" />
      </Card>

      <Card title="Negotiation room" sub="based on EBITDA margin — where to push">
        <HBars data={room} valueLabel={(v) => String(v)} />
        <div className="mt-3 text-xs text-slate-400">High ≥20% · Medium 10–20% · Low &lt;10% EBITDA margin</div>
      </Card>

      <Card title="Top negotiation targets" sub="fat-margin, high-revenue suppliers">
        {targets.length === 0 ? (
          <div className="text-sm text-slate-400">No high-room suppliers with revenue yet.</div>
        ) : (
          <ul className="space-y-2">
            {targets.map((e) => (
              <li key={e.folder} onClick={() => onSelect(e)} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{e.brand}</div>
                  <div className="text-xs text-slate-400">{e.category}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-slate-900">{fmtPct(e.financials.ebitdaMarginPct)}</div>
                  <div className="text-xs text-slate-400">EBITDA</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What we source" sub={`${RAW_MATERIALS.length} raw materials · ${PACKAGING.length} packaging components (client BOM)`} className="lg:col-span-3">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
              <span className="h-2 w-2 rounded-sm bg-teal-500" /> Raw materials
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RAW_MATERIALS.map((m) => (
                <span key={m} className="rounded-md bg-teal-50 px-2 py-0.5 text-xs text-teal-800 ring-1 ring-teal-100">{m}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">
              <span className="h-2 w-2 rounded-sm bg-indigo-500" /> Packaging components
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PACKAGING.map((m) => (
                <span key={m} className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 ring-1 ring-indigo-100">{m}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------ P2 Competitor view */

type CompCat = "All" | (typeof COMPETITOR_CATEGORIES)[number];
type CompSort = "revenue" | "funding" | "name";

function CompetitorView() {
  const all = useMemo(() => competitorRows(), []);
  const [cat, setCat] = useState<CompCat>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CompSort>("revenue");
  const [selected, setSelected] = useState<CompetitorRow | null>(null);
  const [view, setView] = useState<"overview" | "table">("overview");

  const rows = useMemo(() => {
    let r = all;
    if (cat !== "All") r = r.filter((e) => e.categories.includes(cat));
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((e) => `${e.brand} ${e.legalName ?? ""} ${e.parent ?? ""}`.toLowerCase().includes(q));
    return [...r].sort((a, b) => {
      switch (sort) {
        case "name": return a.brand.localeCompare(b.brand);
        case "funding": return (b.competitor?.fundingUSD ?? -1) - (a.competitor?.fundingUSD ?? -1);
        default: return (b.financials.revenueINR ?? -1) - (a.financials.revenueINR ?? -1);
      }
    });
  }, [all, cat, query, sort]);

  const kpis = useMemo(() => ({
    tracked: all.length,
    cats: COMPETITOR_CATEGORIES.length,
    revCr: all.reduce((s, e) => s + (toCrore(e.financials.revenueINR) ?? 0), 0),
    deals: all.filter((e) => e.competitor?.materialEvent).length,
  }), [all]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <section className="grid grid-cols-2 gap-3 py-6 lg:grid-cols-4">
        <Kpi label="Competitors tracked" value={String(kpis.tracked)} sub="across 5 BPC categories" />
        <Kpi label="Categories" value={String(kpis.cats)} sub="sunscreen · serums · wash · scrub · lotion" tone="teal" />
        <Kpi label="Revenue in view" value={crStr(kpis.revCr)} sub="sum of disclosed competitor revenue" />
        <Kpi label="Material events" value={String(kpis.deals)} sub="fundraises & acquisitions tracked" tone="amber" />
      </section>

      <div className="mb-4 flex w-fit rounded-lg bg-slate-100 p-0.5 text-sm">
        {(["overview", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 font-medium capitalize transition ${view === v ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{v}</button>
        ))}
      </div>

      {view === "overview" && <CompetitorOverview all={all} onSelect={setSelected} />}

      {view === "table" && (<>
      <Toolbar
        cats={["All", ...COMPETITOR_CATEGORIES]} cat={cat} setCat={(c) => setCat(c as CompCat)}
        count={(c) => (c === "All" ? all.length : all.filter((e) => e.categories.includes(c)).length)}
        query={query} setQuery={setQuery}
        sortValue={sort} setSort={(s) => setSort(s as CompSort)}
        sortOptions={[["revenue", "Revenue"], ["funding", "Funding raised"], ["name", "Name"]]}
      />

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <Th>Brand</Th><Th>Categories</Th><Th right>Revenue</Th><Th right>Funding</Th>
              <Th>Stage</Th><Th>Latest deal / event</Th><Th>Coverage</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.cin || e.brand} onClick={() => setSelected(e)}
                className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50">
                <td className="px-4 py-3"><div className="font-medium text-slate-900">{e.brand}</div>
                  <div className="truncate text-xs text-slate-400">{e.parent ?? e.legalName ?? ""}</div></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {e.categories.map((c) => (
                      <span key={c} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(e.financials.revenueINR)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtUSD(e.competitor?.fundingUSD ?? null)}</td>
                <td className="px-4 py-3 text-slate-600">{e.competitor?.stage ?? "—"}</td>
                <td className="max-w-[260px] px-4 py-3 text-slate-600">
                  <span className="line-clamp-1">{e.competitor?.materialEvent ?? "—"}</span>
                </td>
                <td className="px-4 py-3"><Pill cls={COVERAGE_META[e.coverage].cls}>{COVERAGE_META[e.coverage].label}</Pill></td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow cols={7} />}
          </tbody>
        </table>
      </div>

      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-500">
        Financials, funding rounds, cap-table &amp; M&amp;A from the Tracxn snapshot. Brands compete across several categories —
        rows are collapsed per brand with category chips. Digital-shelf metrics (discount, reviews, ratings) are live from Nykaa via Firecrawl.
      </p>
      </>)}

      {selected && <CompetitorDetail row={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

/* ------------------------------------------ P2 Competitor overview (charts) */

const CAT5_COLOR: Record<string, string> = {
  Sunscreen: "#f59e0b", "Face Serums": "#6366f1", Bodywash: "#0ea5e9", "Body Scrub": "#f43f5e", "Body Lotion": "#0d9488",
};

function fundingBucket(stage: string | null | undefined): "Acquired" | "VC-funded" | "Unfunded" | "Unknown" {
  const s = (stage ?? "").toLowerCase();
  if (s.includes("acquired")) return "Acquired";
  if (s.includes("unfunded") || s.includes("subsidiary")) return "Unfunded";
  if (/series|seed|funding raised|funded/.test(s)) return "VC-funded";
  return "Unknown";
}
const BUCKET_COLOR = { Acquired: "#059669", "VC-funded": "#0d9488", Unfunded: "#f59e0b", Unknown: "#cbd5e1" } as const;

function CompetitorOverview({ all, onSelect }: { all: CompetitorRow[]; onSelect: (e: CompetitorRow) => void }) {
  const byName = useMemo(() => new Map(all.map((e) => [e.brand, e])), [all]);
  const pick = (l: string) => byName.get(l) && onSelect(byName.get(l)!);

  const topRev: Slice[] = useMemo(
    () => [...all].filter((e) => e.financials.revenueINR).sort((a, b) => (b.financials.revenueINR ?? 0) - (a.financials.revenueINR ?? 0)).slice(0, 8)
      .map((e) => ({ label: e.brand, value: Math.round(toCrore(e.financials.revenueINR) ?? 0), color: "#0d9488" })),
    [all]
  );

  const funding: Slice[] = useMemo(() => {
    const order = ["Acquired", "VC-funded", "Unfunded", "Unknown"] as const;
    const c: Record<string, number> = {};
    for (const e of all) c[fundingBucket(e.competitor?.stage)] = (c[fundingBucket(e.competitor?.stage)] ?? 0) + 1;
    return order.filter((k) => c[k]).map((k) => ({ label: k, value: c[k], color: BUCKET_COLOR[k] }));
  }, [all]);

  const discount: Slice[] = useMemo(
    () => [...all].filter((e) => e.shelf?.avgDiscountPct != null).sort((a, b) => (b.shelf!.avgDiscountPct ?? 0) - (a.shelf!.avgDiscountPct ?? 0)).slice(0, 8)
      .map((e) => ({ label: e.brand, value: Math.round(e.shelf!.avgDiscountPct ?? 0), color: "#f59e0b" })),
    [all]
  );

  const traction: Slice[] = useMemo(
    () => [...all].filter((e) => e.shelf?.totalReviews).sort((a, b) => (b.shelf!.totalReviews ?? 0) - (a.shelf!.totalReviews ?? 0)).slice(0, 8)
      .map((e) => ({ label: e.brand, value: Math.round((e.shelf!.totalReviews ?? 0) / 1e5) / 10, color: "#0ea5e9" })),
    [all]
  );

  const ratings: Slice[] = useMemo(
    () => [...all].filter((e) => e.shelf?.avgRating != null).sort((a, b) => (b.shelf!.avgRating ?? 0) - (a.shelf!.avgRating ?? 0)).slice(0, 8)
      .map((e) => ({ label: e.brand, value: e.shelf!.avgRating ?? 0, color: "#059669" })),
    [all]
  );

  const cats: Slice[] = useMemo(
    () => COMPETITOR_CATEGORIES.map((c) => ({ label: c, value: all.filter((e) => e.categories.includes(c)).length, color: CAT5_COLOR[c] ?? "#94a3b8" }))
      .sort((a, b) => b.value - a.value),
    [all]
  );

  const events = useMemo(() => all.filter((e) => e.competitor?.materialEvent).slice(0, 6), [all]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Top competitors by revenue" sub="latest disclosed · ₹ crore" className="lg:col-span-2">
        <HBars data={topRev} valueLabel={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${v} Cr`)} onBar={pick} />
      </Card>

      <Card title="Funding status" sub="where the field stands">
        <Donut data={funding} centerValue={String(all.length)} centerLabel="brands" />
      </Card>

      <Card title="Heaviest discounting" sub="avg discount % on Nykaa — a marketing-vs-liquidation signal">
        <HBars data={discount} valueLabel={(v) => `${v}%`} onBar={pick} />
      </Card>

      <Card title="Market traction" sub="total reviews (millions) — a sales-velocity proxy">
        <HBars data={traction} valueLabel={(v) => `${v}m`} onBar={pick} />
      </Card>

      <Card title="Customer ratings" sub="avg rating on Nykaa (out of 5)">
        {ratings.length === 0 ? (
          <div className="text-sm text-slate-400">No ratings captured yet.</div>
        ) : (
          <HBars data={ratings} valueLabel={(v) => `${v.toFixed(1)}★`} onBar={pick} />
        )}
      </Card>

      <Card title="Category presence" sub="competitors active per category">
        <HBars data={cats} valueLabel={(v) => String(v)} />
      </Card>

      <Card title="Recent deals & events" sub="fundraises & acquisitions" className="lg:col-span-2">
        {events.length === 0 ? (
          <div className="text-sm text-slate-400">No material events tracked.</div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

  const revTrend: Slice[] = d.trend.map((t) => ({ label: t.fy.replace("20", "'"), value: cr(t.revenueINR), color: "#0d9488" }));
  const profitTrend: Slice[] = d.trend.map((t) => ({ label: t.fy.replace("20", "'"), value: cr(t.netProfitINR), color: (t.netProfitINR ?? 0) >= 0 ? "#059669" : "#f43f5e" }));

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <section className="grid grid-cols-2 gap-3 py-6 lg:grid-cols-4">
        <Kpi label="Partners tracked" value={String(partners.length)} sub="last-mile & logistics" />
        <Kpi label="Publicly listed" value={String(partners.filter((p) => p.listed).length)} sub="rich financials available" tone="teal" />
        <Kpi label="Delhivery revenue" value={crStr(cr(d.revenueINR))} sub={`FY ${d.latestFY} · consolidated`} />
        <Kpi label="Delhivery DSO" value={`${Math.round(d.dso ?? 0)} d`} sub="days sales outstanding — the credit lever" tone="amber" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Delhivery — revenue trend" sub="₹ crore · consolidated, last 5 fiscal years" className="lg:col-span-2">
          <Columns data={revTrend} valueLabel={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`)} />
        </Card>

        <Card title="Latest financials" sub={`FY ${d.latestFY}`}>
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

        <Card title="Delhivery — profit turnaround" sub="net profit / (loss), ₹ crore" className="lg:col-span-2">
          <Columns data={profitTrend} valueLabel={(v) => (v >= 0 ? `₹${v}` : `-₹${Math.abs(v)}`)} />
        </Card>

        <Card title="Partner roster" sub="identified legal entities">
          <ul className="space-y-2">
            {partners.map((p) => (
              <li key={p.brand} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{p.brand}</div>
                  <div className="truncate text-xs text-slate-400">{p.legalName ?? "—"}</div>
                </div>
                {p.listed ? (
                  <Pill cls="text-emerald-700 bg-emerald-50 ring-emerald-200">Listed</Pill>
                ) : (
                  <Pill cls="text-slate-600 bg-slate-100 ring-slate-200">Private</Pill>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-500">
        Delhivery financials from its Tracxn export (FY13–FY25). The other partners are identified legal entities — their
        financials come next from public filings / Probe42. <span className="font-medium text-slate-700">DSO 55 days</span> is
        the receivables lever flagged in the calls.
      </p>
    </main>
  );
}

/* ----------------------------------------------------------- detail panels */

function SupplierDetail({ entity: e, onClose }: { entity: Entity; onClose: () => void }) {
  return (
    <Drawer onClose={onClose} title={e.brand} subtitle={e.legalName ?? e.folder}>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat label="Revenue" value={fmtCrore(e.financials.revenueINR)} />
        <Stat label="EBITDA" value={fmtCrore(e.financials.ebitdaINR)} />
        <Stat label="EBITDA margin" value={fmtPct(e.financials.ebitdaMarginPct)} />
        <Stat label="Net margin" value={fmtPct(e.financials.netMarginPct)} />
        <Stat label="3-yr revenue CAGR" value={fmtPct(e.financials.revenueCAGR3yrPct)} />
        <Stat label="Employees" value={fmtInt(e.financials.employeeCount)} />
      </div>
      <dl className="mt-6 space-y-2 text-sm">
        <Row k="Category" v={e.category} /><Row k="CIN" v={e.cin ?? "—"} mono /><Row k="PAN" v={e.pan ?? "—"} mono />
        <Row k="Entity type" v={e.entityType ?? "—"} /><Row k="Incorporated" v={fmtDate(e.incorporationDate)} />
        <Row k="Registrar status" v={e.statusAtRegistrar ?? "—"} /><Row k="Parent" v={e.parent ?? "—"} />
        <Row k="Website" v={e.website ?? "—"} /><Row k="Coverage" v={COVERAGE_META[e.coverage].label} />
      </dl>
      {e.probe ? (
        <div className="mt-6">
          <SectionLabel>Probe42 · deep financials</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Receivable days" value={fmtDays(e.probe.receivableDays)} />
            <Stat label="Payable days" value={fmtDays(e.probe.payableDays)} />
            <Stat label="RoCE" value={fmtPct(e.probe.roce)} />
            <Stat label="Cash conversion" value={fmtDays(e.probe.cashConversionCycleDays)} />
            <Stat label="Peer median payables" value={fmtDays(e.probe.peerMedianPayableDays)} />
            <Stat label="Credit rating" value={e.probe.creditRating ?? "—"} />
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
          Receivable/payable days, RoCE &amp; balance sheet come from Probe42 — not pulled for this company yet.
        </div>
      )}
      {e.tracxnUrl && <TracxnLink url={e.tracxnUrl} />}
    </Drawer>
  );
}

function CompetitorDetail({ row: e, onClose }: { row: CompetitorRow; onClose: () => void }) {
  const c = e.competitor;
  return (
    <Drawer onClose={onClose} title={e.brand} subtitle={e.parent ?? e.legalName ?? ""}>
      <div className="mt-3 flex flex-wrap gap-1">
        {e.categories.map((cat) => (
          <span key={cat} className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">{cat}</span>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat label="Revenue" value={fmtCrore(e.financials.revenueINR)} />
        <Stat label="Stage" value={c?.stage ?? "—"} />
        <Stat label="Funding raised" value={fmtUSD(c?.fundingUSD ?? null)} />
        <Stat label="Employees" value={fmtInt(e.financials.employeeCount)} />
      </div>

      {c?.materialEvent && (
        <div className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-800 ring-1 ring-teal-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-600">Latest material event</div>
          {c.materialEvent}
        </div>
      )}

      <dl className="mt-6 space-y-2 text-sm">
        <Row k="Legal entity" v={e.legalName ?? "—"} /><Row k="CIN" v={e.cin ?? "—"} mono />
        <Row k="HQ" v={c?.hqCity ?? "—"} /><Row k="Founders" v={c?.founders?.length ? c.founders.join(", ") : "—"} />
        <Row k="Latest round" v={c?.latestRound?.name ? `${c.latestRound.name}${c.latestRound.date ? " · " + c.latestRound.date : ""}` : "—"} />
        <Row k="Sells in" v={c?.geoServed?.length ? c.geoServed.slice(0, 6).join(", ") : "—"} />
        <Row k="Website" v={e.website ?? "—"} /><Row k="Coverage" v={COVERAGE_META[e.coverage].label} />
      </dl>

      {e.shelf ? (
        <div className="mt-6">
          <SectionLabel>Live shelf · {e.shelf.channels.join(", ")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Products on shelf" value={String(e.shelf.skuCount)} />
            <Stat label="Avg rating" value={e.shelf.avgRating != null ? `${e.shelf.avgRating} ★` : "—"} />
            <Stat label="Avg discount" value={fmtPct(e.shelf.avgDiscountPct)} />
            <Stat label="Total reviews" value={fmtInt(e.shelf.totalReviews)} />
          </div>
          {e.shelf.topSku?.name && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
              <div className="text-xs font-medium text-slate-500">Hero SKU (most-reviewed)</div>
              <div className="mt-0.5 text-slate-800">{e.shelf.topSku.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {e.shelf.topSku.rating != null ? `${e.shelf.topSku.rating}★ · ` : ""}
                {fmtInt(e.shelf.topSku.reviewCount)} reviews
                {e.shelf.topSku.priceINR != null ? ` · ₹${e.shelf.topSku.priceINR}` : ""}
              </div>
            </div>
          )}
          {e.shelf.scrapedAt && <div className="mt-1 text-right text-[11px] text-slate-400">scraped {fmtDate(e.shelf.scrapedAt)}</div>}
        </div>
      ) : null}

      {c?.investors?.length ? (
        <div className="mt-6">
          <SectionLabel>Investors</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {c.investors.map((inv) => (
              <span key={inv} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{inv}</span>
            ))}
          </div>
        </div>
      ) : null}

      {e.tracxnUrl && <TracxnLink url={e.tracxnUrl} />}
    </Drawer>
  );
}

/* -------------------------------------------------------- shared UI pieces */

function Toolbar({ cats, cat, setCat, count, query, setQuery, sortValue, setSort, sortOptions }: {
  cats: string[]; cat: string; setCat: (c: string) => void; count: (c: string) => number;
  query: string; setQuery: (q: string) => void; sortValue: string; setSort: (s: string) => void;
  sortOptions: [string, string][];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
              cat === c ? "bg-teal-50 text-teal-700 ring-teal-300" : "bg-white text-slate-500 ring-slate-200 hover:text-slate-800 hover:ring-slate-300"
            }`}>
            {c}<span className={`ml-1.5 text-xs ${cat === c ? "text-teal-500" : "text-slate-400"}`}>{count(c)}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
          className="w-56 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-teal-400" />
        <select value={sortValue} onChange={(e) => setSort(e.target.value)}
          className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400">
          {sortOptions.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
        </select>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "emerald" | "amber" | "teal" }) {
  const accent = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "teal" ? "text-teal-600" : "text-slate-900";
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

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
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />{children}
    </div>
  );
}
function TracxnLink({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-medium text-teal-600 hover:underline">Open Tracxn record ↗</a>;
}
function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div><div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="text-sm text-slate-500">{subtitle}</div></div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 ring-1 ring-slate-200 hover:text-slate-700">✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

const crStr = (cr: number) => `₹${cr >= 1000 ? (cr / 1000).toFixed(1) + "k" : cr.toFixed(0)} Cr`;
