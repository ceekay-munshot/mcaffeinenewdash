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

type Module = "suppliers" | "competitors";

export default function App() {
  const [module, setModule] = useState<Module>("suppliers");
  return (
    <div className="min-h-full">
      <Header module={module} setModule={setModule} generatedAt={DATA.generatedAt} />
      {module === "suppliers" ? <SupplierView /> : <CompetitorView />}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function Header({ module, setModule, generatedAt }: { module: Module; setModule: (m: Module) => void; generatedAt: string }) {
  const subtitle = module === "suppliers" ? "P0 — Vendor & Manufacturer Financial Health" : "P2 — Category Competitor Benchmarking";
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
            {(["suppliers", "competitors"] as Module[]).map((m) => (
              <button
                key={m}
                onClick={() => setModule(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  module === m ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {m === "suppliers" ? "Suppliers" : "Competitors"}
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

      {selected && <SupplierDetail entity={selected} onClose={() => setSelected(null)} />}
    </main>
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
        rows are collapsed per brand with category chips. <span className="font-medium text-slate-700">Coming next:</span> live
        ratings, review-to-sales trend &amp; social listening via Firecrawl.
      </p>

      {selected && <CompetitorDetail row={selected} onClose={() => setSelected(null)} />}
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
