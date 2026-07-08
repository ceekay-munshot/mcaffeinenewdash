// Shared: turn scraped marketplace snapshots into a compact "shelf" summary
// per competitor brand. Used by shelf.mjs (after scrape) and normalize.mjs
// (from cache) so the live-shelf data survives a rebuild.

const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
const sum = (a) => a.reduce((s, x) => s + x, 0);

function discountPct(p) {
  const price = num(p.priceINR ?? p.price);
  const mrp = num(p.mrpINR ?? p.mrp);
  if (p.discountPct != null) return num(p.discountPct);
  if (price != null && mrp && mrp > price) return Math.round(((mrp - price) / mrp) * 100);
  return null;
}

// Repair extraction slips: a "rating" must be 0–5. Marketplaces show star rating
// AND a (much larger) review count, and the extractor sometimes swaps them — so
// a rating > 5 is really the review count. This fixes cached data without re-scraping.
function repair(p) {
  let rating = num(p.rating);
  let reviews = num(p.reviewCount);
  if (rating != null && rating > 5) {
    if (reviews == null || reviews === 0) reviews = rating;
    rating = null;
  }
  // 0 (or negative) means the rating wasn't captured, not a real 0-star product.
  if (rating != null && rating <= 0) rating = null;
  return { ...p, rating, reviewCount: reviews };
}

// snapshots: [{ channel, scrapedAt, products: [{name, price/priceINR, mrp, rating, reviewCount, url}] }]
export function summarizeShelf(snapshots) {
  const products = snapshots.flatMap((s) => (s.products || []).map((p) => ({ ...repair(p), channel: s.channel })));
  if (!products.length) return null;

  const ratings = products.map((p) => num(p.rating)).filter((x) => x != null && x <= 5);
  const discounts = products.map(discountPct).filter((x) => x != null);
  const reviews = products.map((p) => num(p.reviewCount)).filter((x) => x != null);
  const withReviews = products
    .map((p) => ({ p, r: num(p.reviewCount) }))
    .filter((x) => x.r != null)
    .sort((a, b) => b.r - a.r);
  const top = withReviews[0]?.p ?? null;

  return {
    channels: [...new Set(snapshots.map((s) => s.channel))],
    skuCount: products.length,
    avgRating: avg(ratings),
    avgDiscountPct: avg(discounts),
    totalReviews: sum(reviews),
    topSku: top
      ? { name: top.name ?? null, rating: num(top.rating), reviewCount: num(top.reviewCount), priceINR: num(top.priceINR ?? top.price), channel: top.channel }
      : null,
    scrapedAt: snapshots.map((s) => s.scrapedAt).filter(Boolean).sort().pop() ?? null,
  };
}
