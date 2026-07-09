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

export interface ProbeData {
  receivableDays: number | null;
  payableDays: number | null;
  cashConversionCycleDays: number | null;
  roce: number | null;
  roe: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  peerMedianPayableDays: number | null;
  peerMedianReceivableDays: number | null;
  creditRating: string | null;
  profitabilityScore: number | null;
  fetchedAt?: string;
}

export interface CompetitorData {
  stage: string | null;
  founders: string[];
  investors: string[];
  geoServed: string[];
  hqCity: string | null;
  fundingUSD: number | null;
  latestRound: { name: string | null; date: string | null; amountUSD: number | null } | null;
  acquiredBy: { acquirer: string | null; amountUSD: number | null; date: string | null } | null;
  materialEvent: string | null;
}

export interface ShelfData {
  channels: string[];
  skuCount: number;
  avgRating: number | null;
  avgDiscountPct: number | null;
  totalReviews: number;
  topSku: { name: string | null; rating: number | null; reviewCount: number | null; priceINR: number | null; channel: string } | null;
  scrapedAt: string | null;
}

export interface ResearchData {
  overview: string | null;
  products: string[];
  leadership: string[];
  ownership: string | null;
  clients: string[];
  news: string[];
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
  probe?: ProbeData;
  competitor?: CompetitorData;
  shelf?: ShelfData;
  research?: ResearchData;
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

export const COMPETITOR_CATEGORIES = ["Sunscreen", "Face Serums", "Bodywash", "Body Scrub", "Body Lotion"] as const;

export interface CompetitorRow extends Entity {
  categories: string[]; // a brand can compete across several categories
}

// Competitors are listed once per category in the raw data; collapse to one row
// per brand/entity and collect the categories it competes in.
export function competitorRows(): CompetitorRow[] {
  const byKey = new Map<string, CompetitorRow>();
  for (const e of DATA.entities) {
    if (!e.category.startsWith("Competitor")) continue;
    const cat = e.category.replace(/^Competitor -\s*/, "");
    const key = e.cin || e.brand.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.categories.includes(cat)) existing.categories.push(cat);
      // fill any gaps from a richer duplicate
      if (existing.financials.revenueINR == null && e.financials.revenueINR != null) existing.financials = e.financials;
      if (!existing.competitor?.materialEvent && e.competitor?.materialEvent) existing.competitor = e.competitor;
    } else {
      byKey.set(key, { ...e, categories: [cat] });
    }
  }
  return [...byKey.values()];
}
