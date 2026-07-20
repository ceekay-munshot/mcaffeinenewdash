#!/usr/bin/env python3
# Extract supplier financial-health & risk signals from the heavy Tracxn
# "DetailedReport" PDFs (the data the client already paid Tracxn for).
#
# We pull only fields that appear as UNAMBIGUOUS sentences in the PDF's
# "Risk Indicators" block — actual ratio values, revenue/PAT trend, MSME
# payment delays, DPO status — so we never invent a number from a flattened
# table. Output: data/raw/masters/supplier_pdf.json (small, committed).

import os, re, json, glob, sys
from pdfminer.high_level import extract_text

SUPPLY_DIRS = ["RM Vendor", "PM Vendor", "Manufacturer"]
OUT = "data/raw/masters/supplier_pdf.json"


def num(s):
    try:
        return float(s)
    except Exception:
        return None


def parse(text):
    text = text.replace("\xa0", " ").replace("​", "")
    t = re.sub(r"[ \t]+", " ", text)
    g = lambda pat: (re.search(pat, t, re.I) or [None, None])

    current = num((g(r"Current ratio is ([\d.]+) for FY")[1]))
    icr = num((g(r"Interest coverage ratio is ([\d.]+) for FY")[1]))
    dte = num((g(r"Debt to equity ratio is ([\d.]+) for FY")[1]))

    rev_m = re.search(r"Revenue (increased|decreased)\s+([\d.]+)\s*%", t, re.I)
    revChange = (num(rev_m.group(2)) * (1 if rev_m.group(1).lower() == "increased" else -1)) if rev_m else None
    pat_m = re.search(r"PAT (increased|decreased) at a CAGR of ([\d.]+)\s*%", t, re.I)
    patCagr = (num(pat_m.group(2)) * (1 if pat_m.group(1).lower() == "increased" else -1)) if pat_m else None

    msme_m = re.search(r"There (?:are|is) (\d+) payment delays? amounting to ₹?\s*([\d.]+\s*[KLCrn]*)", t, re.I)
    msme = {"count": int(msme_m.group(1)), "amount": msme_m.group(2).strip()} if msme_m else None

    # High DPO: capture the flag state that follows the indicator label
    dpo_m = re.search(r"High DPO \(Days Payable Outstanding\)\s*(Yes|No Data Available|No)", t, re.I)
    dpo_days = re.search(r"Days Payable Outstanding has exceeded (\d+) days", t, re.I)
    dpo = None
    if dpo_m:
        st = dpo_m.group(1)
        dpo = {"flagged": st.lower() == "yes", "note": (f"exceeds {dpo_days.group(1)} days" if (st.lower() == "yes" and dpo_days) else st)}

    founders = []  # unreliable from the flattened cap-table; sourced elsewhere

    # computed risk flags — derived from the actual values (thresholds are the
    # PDF's own definitions), so they're defensible, not guessed.
    flags = []
    if current is not None and current < 1: flags.append("Liquidity strain (current ratio < 1)")
    if icr is not None and icr < 2: flags.append("Low interest coverage (< 2x)")
    if dte is not None and dte > 3: flags.append("High leverage (D/E > 3)")
    if revChange is not None and revChange < 0: flags.append(f"Revenue down {abs(revChange):g}% YoY")
    if patCagr is not None and patCagr < 0: flags.append(f"PAT declining ({patCagr:g}% 3-yr CAGR)")
    if msme: flags.append(f"MSME payment delays ({msme['count']} · ₹{msme['amount']})")
    if dpo and dpo["flagged"]: flags.append(f"High DPO — pays suppliers slowly ({dpo['note']})")

    got = sum(x is not None for x in [current, icr, dte, revChange, patCagr]) + (1 if msme else 0)
    return {
        "currentRatio": current,
        "interestCoverage": icr,
        "debtToEquity": dte,
        "revenueChangePct": revChange,
        "patCagr3yrPct": patCagr,
        "msme": msme,
        "dpo": dpo,
        "founders": founders,
        "riskFlags": flags,
        "_fields": got,
    }


def main():
    out = {}
    stats = []
    for cat in SUPPLY_DIRS:
        for pdf in glob.glob(f"data/raw/{cat}/*/TracxnExport*DetailedReport*.pdf"):
            folder = pdf.split("/")[3]
            try:
                text = extract_text(pdf)
                rec = parse(text)
            except Exception as e:
                stats.append((folder, "FAIL", str(e)[:40])); continue
            fields = rec.pop("_fields")
            out[folder] = rec
            stats.append((folder, fields, len(rec["riskFlags"])))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(f"Parsed {len(out)} supplier PDFs -> {OUT}\n")
    print(f"{'FOLDER':<28}{'fields':>7}{'flags':>7}")
    for f, fields, flags in sorted(stats):
        print(f"{f:<28}{str(fields):>7}{str(flags):>7}")


if __name__ == "__main__":
    main()
