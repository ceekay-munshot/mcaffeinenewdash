#!/usr/bin/env python3
# Dump the text of each supplier's Tracxn DetailedReport PDF into one committed
# JSON, so the LLM financials Action (which runs on a fresh clone WITHOUT the
# heavy PDFs) can read it. We keep only the financial-statements portion to trim
# size + tokens.

import os, re, json, glob, sys
from pdfminer.high_level import extract_text

OUT = "data/raw/masters/supplier_pdf_text.json"


def slim(text):
    # Keep the WHOLE report (entity details, corporate structure, board,
    # financials, ratios, cap table, competitors, news) but strip the huge
    # MSME-payments PAN-list annexures, which are noise and eat tokens.
    t = text.replace("\xa0", " ")
    t = re.sub(r"Annexure - MSME Payments.*?(?=Annexure - Cap Tables|Latest Shareholding|$)", "\n[MSME annexure omitted]\n", t, flags=re.S)
    t = re.sub(r"\bMSME Payments\b\s*\nName of MSME.*?(?=Loans & Charges|Latest Shareholding Summary|$)", "\n[MSME list omitted]\n", t, flags=re.S)
    t = re.sub(r"\n{2,}", "\n", t)
    return t[:85000]


def main():
    refresh = "--refresh" in sys.argv
    out = json.load(open(OUT)) if os.path.exists(OUT) else {}
    added = 0
    for pdf in glob.glob("data/raw/*/*/TracxnExport*DetailedReport*.pdf"):
        folder = pdf.split("/")[3]
        if folder in out and not refresh:
            continue
        try:
            out[folder] = slim(extract_text(pdf))
            added += 1
            print("  +", folder)
        except Exception as e:
            print("FAIL", folder, str(e)[:40])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), ensure_ascii=False)
    kb = os.path.getsize(OUT) // 1024
    print(f"Wrote {len(out)} company texts (+{added} new) -> {OUT} ({kb} KB)")


if __name__ == "__main__":
    main()
