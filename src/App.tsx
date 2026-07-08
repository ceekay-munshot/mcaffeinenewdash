import { useMemo, useState } from "react";
import { DATA, supplyEntities, type Entity } from "./types";
import { fmtCrore, fmtPct, fmtInt, fmtDate, fmtDays, toCrore } from "./lib/format";
import { negotiationRoom, ROOM_META, COVERAGE_META, type Room } from "./lib/health";

const CATS = ["All", "RM Vendor", "PM Vendor", "Manufacturer"] as const;
type Cat = (typeof CATS)[number];
type SortKey = "revenue" | "ebitda" | "name" | "room";

export default function App() {
  const all = useMemo(() => supplyEntities(), []);
  const [cat, setCat] = useState<Cat>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [selected, setSelected] = useState<Entity | null>(null);

  const rows = useMemo(() => {
    let r = all;
    if (cat !== "All") r = r.filter((e) => e.category === cat);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((e) => `${e.brand} ${e.legalName ?? ""} ${e.cin ?? ""}`.toLowerCase().includes(q));
    const roomRank: Record<Room, number> = { High: 3, Medium: 2, Low: 1, Unknown: 0 };
    return [...r].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.brand.localeCompare(b.brand);
        case "ebitda":
          return (b.financials.ebitdaMarginPct ?? -1) - (a.financials.ebitdaMarginPct ?? -1);
        case "room":
          return roomRank[negotiationRoom(b)] - roomRank[negotiationRoom(a)];
        default:
          return (b.financials.revenueINR ?? -1) - (a.financials.revenueINR ?? -1);
      }
    });
  }, [all, cat, query, sort]);

  const kpis = useMemo(() => {
    const tracked = all.length;
    const full = all.filter((e) => e.coverage === "full").length;
    const partial = all.filter((e) => e.coverage === "partial").length;
    const revCr = all.reduce((s, e) => s + (toCrore(e.financials.revenueINR) ?? 0), 0);
    const highRoom = all.filter((e) => negotiationRoom(e) === "High").length;
    return { tracked, full, partial, revCr, highRoom };
  }, [all]);

  return (
    <div className="min-h-full">
      <Header generatedAt={DATA.generatedAt} />

      <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
        {/* KPI row */}
        <section className="grid grid-cols-2 gap-3 py-6 lg:grid-cols-4">
          <Kpi label="Suppliers tracked" value={String(kpis.tracked)} sub="RM · PM · Manufacturers" />
          <Kpi label="Data coverage" value={`${kpis.full} full`} sub={`${kpis.partial} partial · numbers pending`} tone="emerald" />
          <Kpi label="Revenue in view" value={`₹${kpis.revCr >= 1000 ? (kpis.revCr / 1000).toFixed(1) + "k" : kpis.revCr.toFixed(0)} Cr`} sub="sum of disclosed supplier revenue" tone="teal" />
          <Kpi label="High negotiation room" value={String(kpis.highRoom)} sub="fat-margin suppliers to push on" tone="amber" />
        </section>

        {/* toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {CATS.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
                  cat === c
                    ? "bg-teal-50 text-teal-700 ring-teal-300"
                    : "bg-white text-slate-500 ring-slate-200 hover:text-slate-800 hover:ring-slate-300"
                }`}
              >
                {c}
                <span className={`ml-1.5 text-xs ${cat === c ? "text-teal-500" : "text-slate-400"}`}>
                  {c === "All" ? all.length : all.filter((e) => e.category === c).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company or CIN…"
              className="w-56 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-teal-400"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-teal-400"
            >
              <option value="revenue">Sort: Revenue</option>
              <option value="ebitda">Sort: EBITDA margin</option>
              <option value="room">Sort: Negotiation room</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>

        {/* table */}
        <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <Th>Company</Th>
                <Th>Category</Th>
                <Th right>Revenue</Th>
                <Th right>EBITDA %</Th>
                <Th right>Net %</Th>
                <Th right>3-yr growth</Th>
                <Th right>Staff</Th>
                <Th>Negotiation room</Th>
                <Th>Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const room = negotiationRoom(e);
                return (
                  <tr
                    key={e.category + e.folder}
                    onClick={() => setSelected(e)}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{e.brand}</div>
                      <div className="truncate text-xs text-slate-400">{e.legalName ?? e.folder}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{e.category}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">{fmtCrore(e.financials.revenueINR)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.ebitdaMarginPct)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.netMarginPct)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtPct(e.financials.revenueCAGR3yrPct)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{fmtInt(e.financials.employeeCount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${ROOM_META[room].cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ROOM_META[room].dot}`} />
                        {ROOM_META[room].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${COVERAGE_META[e.coverage].cls}`}>
                        {COVERAGE_META[e.coverage].label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No suppliers match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Legend />
      </main>

      {selected && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Header({ generatedAt }: { generatedAt: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500 font-bold text-white shadow-sm">m</div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-slate-900">
              mCaffeine <span className="font-normal text-slate-400">· CCO Command Center</span>
            </div>
            <div className="text-xs text-slate-500">P0 — Vendor &amp; Manufacturer Financial Health</div>
          </div>
        </div>
        <div className="hidden text-right text-xs text-slate-400 sm:block">
          <div>Data snapshot</div>
          <div className="font-mono text-slate-600">{fmtDate(generatedAt)}</div>
        </div>
      </div>
    </header>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "emerald" | "amber" | "teal" }) {
  const accent =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "teal" ? "text-teal-600" : "text-slate-900";
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

function DetailPanel({ entity: e, onClose }: { entity: Entity; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">{e.brand}</div>
            <div className="text-sm text-slate-500">{e.legalName ?? e.folder}</div>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 ring-1 ring-slate-200 hover:text-slate-700">✕</button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Stat label="Revenue" value={fmtCrore(e.financials.revenueINR)} />
          <Stat label="EBITDA" value={fmtCrore(e.financials.ebitdaINR)} />
          <Stat label="EBITDA margin" value={fmtPct(e.financials.ebitdaMarginPct)} />
          <Stat label="Net margin" value={fmtPct(e.financials.netMarginPct)} />
          <Stat label="3-yr revenue CAGR" value={fmtPct(e.financials.revenueCAGR3yrPct)} />
          <Stat label="Employees" value={fmtInt(e.financials.employeeCount)} />
        </div>

        <dl className="mt-6 space-y-2 text-sm">
          <Row k="Category" v={e.category} />
          <Row k="CIN" v={e.cin ?? "—"} mono />
          <Row k="PAN" v={e.pan ?? "—"} mono />
          <Row k="Entity type" v={e.entityType ?? "—"} />
          <Row k="Incorporated" v={fmtDate(e.incorporationDate)} />
          <Row k="Registrar status" v={e.statusAtRegistrar ?? "—"} />
          <Row k="Parent" v={e.parent ?? "—"} />
          <Row k="Website" v={e.website ?? "—"} />
          <Row k="Coverage" v={COVERAGE_META[e.coverage].label} />
          <Row k="Sources" v={`Tracxn ${e.sources.tracxn ? "✓" : "✗"} · web ${e.sources.webResearch ? "✓" : "✗"} · ${e.sources.pdfs} PDF`} />
        </dl>

        {e.probe ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Probe42 · deep financials
            </div>
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
            Receivable/payable days, RoCE and full balance sheet come from Probe42 — not pulled for this company yet. This card shows what the Tracxn snapshot already gives us.
          </div>
        )}

        {e.tracxnUrl && (
          <a href={e.tracxnUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-medium text-teal-600 hover:underline">
            Open Tracxn record ↗
          </a>
        )}
      </aside>
    </div>
  );
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
      <dt className="text-slate-500">{k}</dt>
      <dd className={`text-right text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

function Legend() {
  return (
    <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-500">
      <span className="font-medium text-slate-700">Negotiation room</span> is a transparent first-cut signal from EBITDA
      margin (≥20% High · 10–20% Medium · &lt;10% Low) — fatter supplier margins mean more room to push on price/terms.
      It sharpens once Probe42 adds receivable days &amp; RoCE. Figures are the latest disclosed Tracxn snapshot; “partial”
      rows are identified (CIN in hand) with financials still to be pulled.
    </p>
  );
}
