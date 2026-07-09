// mcAFFEINE chart palette. Categorical set validated (CVD-safe) via the dataviz
// validator; amber carries direct value labels on every mark it fills.

export const INK = { primary: "#0f172a", secondary: "#475569", muted: "#94a3b8" };
export const TEAL = "#0d9488";

// category identity (fixed order, never cycled)
export const CATEGORY_COLOR: Record<string, string> = {
  "RM Vendor": "#0d9488", // teal
  "PM Vendor": "#f59e0b", // amber
  Manufacturer: "#6366f1", // indigo
};

// status: data coverage
export const COVERAGE_COLOR: Record<string, string> = {
  full: "#059669", // emerald
  partial: "#f59e0b", // amber
  not_found: "#f43f5e", // rose
};

// ordinal status: negotiation room
export const ROOM_COLOR: Record<string, string> = {
  High: "#059669", // emerald
  Medium: "#f59e0b", // amber
  Low: "#0ea5e9", // sky
  Unknown: "#94a3b8", // neutral (no data)
};
