// Attach the LLM-extracted multi-year financials onto the committed clean dataset.
// Touches only committed files, so it runs in CI (no data/raw needed).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENTITIES = "data/clean/entities.json";
const FIN = "data/raw/masters/supplier_financials.json";

const data = JSON.parse(readFileSync(ENTITIES, "utf8"));
const fin = existsSync(FIN) ? JSON.parse(readFileSync(FIN, "utf8")) : {};
let n = 0;
for (const e of data.entities) {
  const f = fin[e.folder];
  if (f?.years?.length) { e.statements = f.years; n++; }
  else if (e.statements) delete e.statements; // authoritative: drop stale data
}
writeFileSync(ENTITIES, JSON.stringify(data, null, 2));
console.log(`Attached multi-year statements to ${n} suppliers → ${ENTITIES}`);
