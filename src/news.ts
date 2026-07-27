// Recent news & legal/risk signals per supplier — the qualitative half of L1
// ("investor intelligence"), gathered from the open web. Keyed by entity folder.
// Populated by scripts/agents; the app just reads and renders it.
import raw from "./news.json";

export type NewsItem = { date: string; title: string; source: string; url: string; oneLine: string };
export type Signal = { type: string; oneLine: string; source: string; url: string };
export type SupplierNews = { found: boolean; summary: string; news: NewsItem[]; signals: Signal[] };

const NEWS = raw as Record<string, SupplierNews>;

export const newsOf = (folder: string): SupplierNews | null => {
  const n = NEWS[folder];
  if (!n) return null;
  // only surface it when there's something real to show
  return n.found && (n.news.length > 0 || n.signals.length > 0) ? n : null;
};
