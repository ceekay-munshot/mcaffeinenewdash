import dataset from "@data/clean/entities.json";

export type Coverage = "full" | "partial" | "not_found";

export interface Financials {
  revenueINR: number | null;
  ebitdaINR: number | null;
  netProfitINR: number | null;
  ebitdaMarginPct: number | null;
  netMarginPct: number | null;
  revenueCAGR3yrPct: number | null;
  employeeCount: number | null;
}

export interface Entity {
  category: string;
  folder: string;
  brand: string;
  legalName: string | null;
  cin: string | null;
  pan: string | null;
  coverage: Coverage;
  tracxnUrl: string | null;
  website: string | null;
  incorporationDate: string | null;
  entityType: string | null;
  statusAtRegistrar: string | null;
  parent: string | null;
  financials: Financials;
  funding: { rounds: number; acquisitions: number };
  sources: { tracxn: boolean; webResearch: boolean; pdfs: number };
}

export interface Dataset {
  generatedAt: string;
  count: number;
  entities: Entity[];
}

export const DATA = dataset as Dataset;

// P0 is about the supply side: raw-material vendors, packaging vendors, factories.
export const SUPPLY_CATEGORIES = ["RM Vendor", "PM Vendor", "Manufacturer"] as const;

export function supplyEntities(): Entity[] {
  return DATA.entities.filter((e) => SUPPLY_CATEGORIES.includes(e.category as never));
}
