// L2 — market structure per ingredient / packaging category ("India Trade" /
// monopoly check). The qualitative question L1 can't answer: for each thing we
// buy, how many credible suppliers exist, and does that hand the leverage to us
// (a crowded commodity market) or to them (a sole-source proprietary molecule)?
//
// Populated by real web research (src/market.json); the app just reads it. Every
// entry carries its sources and a confidence flag — nothing here is invented.
import raw from "./market.json";
import { RM_SUPPLY, PM_SUPPLY } from "./supply";

export type Concentration = "sole" | "concentrated" | "competitive";
export type Leverage = "them" | "balanced" | "us";
export type IngredientKind = "proprietary" | "semi" | "commodity";
export type Band = "sole" | "few" | "many";

export type MarketEntry = {
  item: string; // trade name (RM) or packaging category label (PM)
  inci?: string;
  kind: IngredientKind;
  upstream?: string;
  indiaBand: Band;
  indiaSuppliers: string[];
  concentration: Concentration;
  leverage: Leverage;
  implication: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  side: "rm" | "pm";
};

const MARKET = raw as MarketEntry[];
const byItem = new Map(MARKET.map((m) => [m.item, m]));

export const allMarket = (): MarketEntry[] => MARKET;
export const marketOf = (item: string): MarketEntry | null => byItem.get(item) ?? null;

// Packaging is assessed at the category level (there's no market for one exact
// bottle SKU), so map a specific PM line-item to its converter category.
const PM_CAT: { re: RegExp; cat: string }[] = [
  { re: /pump|actuator|dispenser/i, cat: "Lotion / serum pumps & actuators" },
  { re: /\btube\b/i, cat: "Plastic laminated / extruded tubes" },
  { re: /carton|insert|\binner\b/i, cat: "Folding cartons / mono-cartons" },
  { re: /glass|\bjar\b/i, cat: "Cosmetic glass bottles & jars" },
  { re: /fliptop|flip-?top|\bcaps?\b|closure/i, cat: "Flip-top caps & closures" },
  { re: /bottle|hdpe|\bpet\b/i, cat: "HDPE / PET plastic bottles" },
];
export const pmCategoryOf = (item: string): string | null => PM_CAT.find((p) => p.re.test(item))?.cat ?? null;

// All market entries relevant to one vendor folder — an RM vendor maps by the
// exact trade name it supplies; a PM vendor maps through its item's category.
export const marketOfFolder = (folder: string): MarketEntry[] => {
  if (!folder) return [];
  const out = new Map<string, MarketEntry>();
  RM_SUPPLY.filter((s) => s.folder === folder).forEach((s) => {
    const m = byItem.get(s.item);
    if (m) out.set(m.item, m);
  });
  PM_SUPPLY.filter((s) => s.folder === folder).forEach((s) => {
    const cat = pmCategoryOf(s.item);
    const m = cat ? byItem.get(cat) : null;
    if (m) out.set(m.item, m);
  });
  return [...out.values()];
};

// Display metadata for the three concentration classes.
export const CONC_META: Record<Concentration, { label: string; blurb: string; color: string; bg: string; text: string; ring: string; emoji: string; pos: number }> = {
  sole: { label: "Sole-source", blurb: "One originator — leverage sits with them", color: "#e11d48", bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200", emoji: "🔒", pos: 12 },
  concentrated: { label: "Concentrated", blurb: "A handful of credible suppliers", color: "#d97706", bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200", emoji: "⚖️", pos: 50 },
  competitive: { label: "Competitive", blurb: "Many makers — leverage is ours", color: "#059669", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", emoji: "🔓", pos: 88 },
};

export const LEV_META: Record<Leverage, { label: string; who: string; emoji: string }> = {
  them: { label: "Supplier holds the cards", who: "them", emoji: "🔒" },
  balanced: { label: "Balanced", who: "balanced", emoji: "⚖️" },
  us: { label: "We hold the cards", who: "us", emoji: "💪" },
};
