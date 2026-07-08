# mcAFFEINE Intelligence Dashboard

A self-updating "command center" for mcAFFEINE — watches the money flowing through
suppliers, manufacturers, delivery partners and sales channels, and keeps an eye on
competitors. Built by Munshot AI.

## Priorities (from the client brief)

- **P0 — Vendor & Manufacturer Financial Health** *(building first)* — RoCE, EBITDA,
  receivable days, cash-flow strength → where we can improve cash flow & margin.
- **P1** — Raw material & packaging cost intelligence (pricing, commodity/war cues).
- **P2** — Category competitor benchmarking (revenue, cap table, reviews, M&A).
- **P3** — Last-mile delivery & storage partner economics.
- **P4** — Sales channel (marketplace / quick-commerce) economics.

## How it's built — the "kitchen"

```
data/raw  (pantry)   →   scripts/normalize.mjs (prep station)   →   data/clean (fridge)   →   dashboard (table)
messy per-company        one clean record per company               entities.json             reads clean data only
JSON + PDF + XLSX        + master-sheet CIN/name fallback
```

- **data/raw/** — the 190 MB Tracxn snapshot (one folder per company). Kept **local, not
  in git** (see `.gitignore`). Only `data/raw/masters/` (small reference sheets) is tracked.
- **scripts/normalize.mjs** — schema-tolerant reader. The raw JSON hides the same fact
  under many key names (`entityId` / `cin` / `entityId_CIN`, `latestRevenue.INR` /
  `latestRevenue_INR`), so it searches by pattern and fills missing CINs/legal names from
  the master verification sheet. Run with `npm run normalize`.
- **data/clean/entities.json** — the single clean dataset the dashboard reads.

## Data sources (fuel tanks)

1. **Drive snapshot** — have now; company financials + research (powers P0/P2 today).
2. **Probe42 API** — test key in hand; deep MCA numbers (payable/receivable days, ownership).
3. **Firecrawl + LLM** — live marketplace prices, reviews, ads (P1/P2/P4).

## Current coverage (73 companies)

| | count |
|---|---|
| Fully covered (identity + financials) | 35 |
| Partial (identified, numbers pending) | 34 |
| Not found (need client / deeper search) | 4 |

The 4 not-found (revepharma, Khosla Printers, beemanpharmaceuticals, kayceeenterprise)
match the RM/PM gaps the client flagged.

## Setup

```bash
cp .env.example .env   # fill in keys (kept out of git; prod uses GitHub Secrets)
npm run normalize      # rebuild data/clean/entities.json from data/raw
```
