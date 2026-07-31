// mCaffeine's real supply chain: which of our key raw materials / packaging
// each tracked vendor actually supplies. Built from the client's key-ingredients
// sheet (data/raw/masters/key_ingredients_manufacturers.json) joined to the
// supplier records by folder. This is what makes the dashboard about mCaffeine's
// own supply base, not generic companies.
import raw from "./supply.json";

export type SupplyRow = { item: string; folder: string; brand: string; category: string };
// One leg of a supply line — the vendor (or contract manufacturer) for that node.
// `mapped` is false when the sheet named a vendor we don't yet track as an entity.
export type SupplyLeg = { item?: string; folder: string; brand: string; mapped: boolean };
// One row of the client's key-ingredients sheet, reconstructed as a full chain:
// raw material → its vendor → the contract manufacturer → packaging → its vendor.
export type SupplyLine = { no: number; product: string | null; rm: SupplyLeg; mf: SupplyLeg; pm: SupplyLeg };
const SUPPLY = raw as { rm: SupplyRow[]; pm: SupplyRow[]; mf: SupplyRow[]; lines: SupplyLine[] };

export const RM_SUPPLY = SUPPLY.rm;
export const PM_SUPPLY = SUPPLY.pm;
export const MF_SUPPLY = SUPPLY.mf;
export const SUPPLY_LINES = SUPPLY.lines;

// folder -> the mCaffeine items this vendor supplies (raw materials + packaging)
const byFolder = (() => {
  const m = new Map<string, { rm: string[]; pm: string[] }>();
  const add = (folder: string, item: string, key: "rm" | "pm") => {
    const e = m.get(folder) ?? { rm: [], pm: [] };
    e[key].push(item);
    m.set(folder, e);
  };
  SUPPLY.rm.forEach((r) => add(r.folder, r.item, "rm"));
  SUPPLY.pm.forEach((r) => add(r.folder, r.item, "pm"));
  return m;
})();

export const supplyOf = (folder: string) => byFolder.get(folder) ?? null;
export const suppliedItems = (folder: string): string[] => {
  const e = byFolder.get(folder);
  return e ? [...e.rm, ...e.pm] : [];
};
