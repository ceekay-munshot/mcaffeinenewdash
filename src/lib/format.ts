// Money is stored in rupees; Indian business reads it in crore (1 Cr = 10,000,000).
export function toCrore(inr: number | null): number | null {
  if (inr == null) return null;
  return inr / 1e7;
}

export function fmtCrore(inr: number | null): string {
  const cr = toCrore(inr);
  if (cr == null) return "—";
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(2)}k Cr`;
  if (cr >= 100) return `₹${cr.toFixed(0)} Cr`;
  return `₹${cr.toFixed(1)} Cr`;
}

export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

export function fmtInt(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-IN");
}

export function fmtDays(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)} d`;
}

export function fmtUSD(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

// Registry strings arrive inconsistently cased ("THANE", "Jigani", "VASAI EAST",
// and folder slugs like "kayceeenterprise"). Normalise so the UI reads as prose,
// not as a database dump.
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// A name for chips and dense lists, where the full legal name is noise: the
// company as a buyer would say it. Some brands carry the incorporation suffix
// ("Manjushree Technopack Limited", "PRISHA TUBES PRIVATE LIMITED") and sat
// beside bare ones like "ValueTree" in the same row of chips.
export function shortName(brand: string): string {
  const s = brand
    .replace(/[\s,]*\b(private|pvt\.?|public|limited|ltd\.?|llp|inc\.?|corp\.?)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s&,-]+$/, "")
    .trim();
  if (!s) return brand;
  // Registry all-caps reads as shouting next to normal-cased brands, and a
  // lowercase folder slug ("arovea", "kapco") reads as a typo next to them.
  if (s === s.toUpperCase() && s.length > 4) return titleCase(s);
  return s === s.toLowerCase() ? titleCase(s) : s;
}

// Registry legal names are ALL-CAPS ("VALUETREE INGREDIENTS PRIVATE LIMITED").
// Title-case them, but keep the brand's own casing as the prefix so the reader
// sees one clean full name ("ValueTree Ingredients Private Limited") — never the
// short + full pair. Falls back to the brand when there is no legal name.
export function fullName(legalName: string | null | undefined, brand: string): string {
  const clean = (legalName ?? "")
    .replace(/\[[^\]]*\]/g, "") // drop editorial "[sic …]" notes
    .replace(/\s*\([^)]*\)\s*$/, "") // drop a trailing "(India)"-style qualifier
    .replace(/\bLIM(?:ITD|TED|ITE)\b/i, "LIMITED") // fix known registry typos of "LIMITED"
    .replace(/\s+/g, " ")
    .trim();
  // No legal name on file (open-market traders with no CIN). Their "brand" is the
  // folder slug — capitalise it so the UI never shows a raw lowercase id.
  if (!clean) return brand === brand.toLowerCase() ? titleCase(brand) : brand;
  // Probe sometimes returns a stub legal name that the brand already contains in
  // full ("EPL" vs "EPL Limited"). Title-casing the stub would mangle an acronym
  // into "Epl", so keep the richer brand string as-is — unless the brand is
  // itself a registry all-caps string ("PRISHA TUBES PRIVATE LIMITED"), which
  // shouted next to every title-cased name around it.
  if (brand && brand.toLowerCase().startsWith(clean.toLowerCase()))
    return brand === brand.toUpperCase() && /\s/.test(brand) ? titleCase(brand) : brand;
  const tc = clean.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLlp\b/g, "LLP");
  // Preserve the brand's own casing as the prefix ONLY when it's intentional
  // mixed-case ("ValueTree", "EPL") — not an all-lowercase folder slug ("kapco",
  // "arovea"), which should just title-case cleanly.
  const intentionalCase = brand && brand !== brand.toLowerCase() && brand !== brand.toUpperCase();
  if (intentionalCase && tc.toLowerCase().startsWith(brand.toLowerCase())) {
    return brand + tc.slice(brand.length);
  }
  return tc;
}
