// Pull qualitative research out of the (wildly varied) web_research.json files.
// Every company was researched by a different run, so keys differ everywhere
// (products_services | Products/Manufacturing Capabilities | productLineup_faceSerum,
// leadership | Leadership, recent_news | Recent News | recentNews, …). Search by
// key pattern, flatten to clean string lists, and cap lengths.

function* walk(node, key = null) {
  yield [key, node];
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) yield* walk(v, k);
}

const clip = (s, n = 220) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// turn any leaf/array/object into clean strings
function toStrings(v) {
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [clip(v.trim())] : [];
  if (typeof v === "number" || typeof v === "boolean") return [];
  if (Array.isArray(v)) return v.flatMap(itemToStr);
  if (typeof v === "object") {
    const s = itemToStr(v);
    return s ? [s] : [];
  }
  return [];
}
function itemToStr(item) {
  if (item == null) return null;
  if (typeof item === "string") return item.trim() ? clip(item.trim()) : null;
  if (typeof item !== "object") return null;
  const head = pickStr(item, /title|headline|name|event|product|role|person|summary|description|item/i);
  const meta = pickStr(item, /date|year|source|company|price|positioning/i);
  if (head) return clip(meta && !head.includes(meta) ? `${head} · ${meta}` : head);
  // fall back to joining short string values
  const vals = Object.values(item).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  return vals.length ? clip(vals.join(" · ")) : null;
}
function pickStr(obj, re) {
  for (const [k, v] of Object.entries(obj)) if (re.test(k) && typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function collect(root, keyRe, limit) {
  const out = [];
  const seen = new Set();
  for (const [k, v] of walk(root)) {
    if (!k || !keyRe.test(k)) continue;
    for (const s of toStrings(v)) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
function firstString(root, keyRe) {
  for (const [k, v] of walk(root)) {
    if (!k || !keyRe.test(k)) continue;
    const s = toStrings(v)[0];
    if (s) return s;
  }
  return null;
}

export function extractResearch(web) {
  if (!web || typeof web !== "object") return null;
  const overview = firstString(web, /overview|about|description|tagline/i);
  const products = collect(web, /product|manufactur|lineup|capabilit|portfolio|services/i, 12);
  const leadership = collect(web, /leadership|founder|management|ceo|key.?people|promoter/i, 8);
  const ownership = firstString(web, /ownership|parent|financ|funding|investor/i);
  const clients = collect(web, /clients|customers|notable/i, 8);
  const news = collect(web, /recent.?news|^news$|news$|developments/i, 6);

  const any = overview || products.length || leadership.length || ownership || clients.length || news.length;
  if (!any) return null;
  return { overview, products, leadership, ownership, clients, news };
}
