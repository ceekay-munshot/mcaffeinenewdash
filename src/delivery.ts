import deliveryData from "@data/clean/delivery.json";

export interface DeliveryPartner {
  brand: string;
  legalName: string | null;
  cin: string | null;
  coverage: string;
  listed: boolean;
}

export interface DelhiveryFin {
  latestFY: string;
  revenueINR: number | null;
  netProfitINR: number | null;
  dso: number | null;
  ebitdaMarginPct: number | null;
  roce: number | null;
  trend: { fy: string; revenueINR: number | null; netProfitINR: number | null }[];
}

export interface DeliveryDataset {
  partners: DeliveryPartner[];
  delhivery: DelhiveryFin;
}

export const DELIVERY = deliveryData as DeliveryDataset;
