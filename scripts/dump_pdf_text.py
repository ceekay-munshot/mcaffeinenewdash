#!/usr/bin/env python3
# Dump the text of each supplier's Tracxn DetailedReport PDF into one committed
# JSON, so the LLM financials Action (which runs on a fresh clone WITHOUT the
# heavy PDFs) can read it. We keep only the financial-statements portion to trim
# size + tokens.

import os, re, json, glob
from pdfminer.high_level import extract_text

SUPPLY_DIRS = ["RM Vendor", "PM Vendor", "Manufacturer"]
OUT = "data/raw/masters/supplier_pdf_text.json"


def slim(text):
    # Grab the REAL financial block — from the revenue chart / detailed statements
    # down to (but excluding) the huge MSME-payments annexure. Avoids the tiny
    # table-of-contents slice and the token-heavy supplier PAN lists.
    t = text.replace("\xa0", " ")
    s = t.find("Revenue - INR (Cr)")
    if s < 0:
        s = t.find("Detailed Income Statement")
    if s < 0:
        s = 0
    e = t.find("MSME Payments", s + 100)
    if e < 0 or e - s < 3000:
        e = min(len(t), s + 45000)
    chunk = re.sub(r"\n{2,}", "\n", t[s:e])
    return chunk[:50000]


def main():
    out = {}
    for cat in SUPPLY_DIRS:
        for pdf in glob.glob(f"data/raw/{cat}/*/TracxnExport*DetailedReport*.pdf"):
            folder = pdf.split("/")[3]
            try:
                out[folder] = slim(extract_text(pdf))
            except Exception as e:
                print("FAIL", folder, str(e)[:40])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), ensure_ascii=False)
    kb = os.path.getsize(OUT) // 1024
    print(f"Wrote {len(out)} supplier texts -> {OUT} ({kb} KB)")


if __name__ == "__main__":
    main()
