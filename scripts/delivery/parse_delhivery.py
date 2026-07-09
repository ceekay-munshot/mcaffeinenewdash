# Parse the client-provided Delhivery Tracxn financials export into a clean
# data/clean/delivery.json (5-yr revenue + net-profit trend, latest ratios,
# and the delivery-partner roster). Run locally where data/raw exists:
#   python3 scripts/delivery/parse_delhivery.py
import openpyxl, json

XLSX = "data/raw/Delivery Partners/Delhivery/Delhivery-Financials-FY2013-FY2024.xlsx"
wb = openpyxl.load_workbook(XLSX, data_only=True)
rows = lambda name: list(wb[name].iter_rows(values_only=True))

rev, npf = {}, {}
for r in rows("FinancialsSummaryREVENUE"):
    if r and r[0] and str(r[0]).startswith("FY"):
        rev[str(r[0]).replace("\n", "").replace("FY", "").strip()] = r[1]
for r in rows("FinancialsSummaryNET_PROFIT"):
    if r and r[0] and str(r[0]).startswith("FY"):
        npf[str(r[0]).replace("\n", "").replace("FY", "").strip()] = r[1]
years = sorted(rev)
trend = [{"fy": y, "revenueINR": rev.get(y), "netProfitINR": npf.get(y)} for y in years]

ratios = {}
for r in rows("2 Ratios"):
    if r and r[0] and str(r[0]).strip() in (
        "EBITDA Margin", "Net Profit Margin", "Return on Capital Employed", "Days Sales Outstanding"):
        ratios[str(r[0]).strip()] = r[1]

pct = lambda v: round(v * 100, 1) if v is not None else None
delhivery = {
    "latestFY": "2024-25",
    "revenueINR": rev.get("2024-25"),
    "netProfitINR": npf.get("2024-25"),
    "dso": ratios.get("Days Sales Outstanding"),
    "ebitdaMarginPct": pct(ratios.get("EBITDA Margin")),
    "roce": pct(ratios.get("Return on Capital Employed")),
    "trend": trend,
}

ent = json.load(open("data/clean/entities.json"))
LISTED = {"Delhivery"}
partners = [
    {"brand": e["brand"], "legalName": e.get("legalName"), "cin": e.get("cin"),
     "coverage": e.get("coverage"), "listed": e["brand"] in LISTED}
    for e in ent["entities"] if e["category"] == "Delivery Partners"
]

json.dump({"partners": partners, "delhivery": delhivery},
          open("data/clean/delivery.json", "w"), indent=2)
print("wrote data/clean/delivery.json")
