"""Capture attributed official delivery references without inferring present applicability."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/public/delivery-evidence"
OUTPUT.mkdir(parents=True, exist_ok=True)
retrieved = datetime.now(timezone.utc).isoformat()
sources = []
failures = []
for key, url, filename, publisher in [
    ("stelco-tariff", "https://stelco.com.mv/tariff-rates", "stelco-tariff.html", "STELCO"),
    ("mote-energy-methodology-2025", "https://www.environment.gov.mv/v2/wp-content/files/publications/20251002-pub-methodology-report-for-estimation-of-mitigation-actions.pdf",
     "mote-energy-methodology-2025.pdf", "Ministry of Tourism and Environment"),
]:
    try:
        response = httpx.get(url, follow_redirects=True, timeout=30)
        response.raise_for_status()
        (OUTPUT / filename).write_bytes(response.content)
    except httpx.HTTPError as error:
        failures.append({"source_id": key, "error": str(error)[:500]})
        sources.append({"id": key, "url": url, "publisher": publisher,
                        "retrieved_at": None, "sha256": None, "path": None,
                        "retrieval_status": "indexed_primary_reference_only",
                        "meaning": "Values inspected in the primary document's indexed text; "
                        "original download currently unavailable. No raw content hash is claimed."})
        continue
    sources.append({"id": key, "url": url, "resolved_url": str(response.url),
                    "publisher": publisher, "retrieved_at": retrieved,
                    "sha256": hashlib.sha256(response.content).hexdigest(),
                    "path": f"data/public/delivery-evidence/{filename}",
                    "bytes": len(response.content),
                    "license": "Official public reference; explicit reuse licence not stated."})
if (OUTPUT / "mote-energy-methodology-2025.pdf").exists():
    pdf = PdfReader(OUTPUT / "mote-energy-methodology-2025.pdf")
    text = "\n".join(page.extract_text() for page in pdf.pages)
    if not all(value in text.replace(",", "") for value in ("238574998", "61126585", "0.698")):
        raise ValueError("The official reference changed; review Table 5 before publishing values")
html = (OUTPUT / "stelco-tariff.html").read_text(encoding="utf8")
if not all(rate in html for rate in ("3.30", "3.35", "3.65", "4.35", "5.75", "6.65")):
    raise ValueError("Tariff page changed; review progressive bands")
document = {
    "version": "delivery-reference-1.0", "retrieved_at": retrieved, "sources": sources,
    "retrieval_failures": failures,
    "tariffs": [
        {"id": "male_commercial", "title": "Malé-region commercial base electricity tariff",
         "source_id": "stelco-tariff", "unit": "MVR/kWh", "billing_days": 30,
         "bands": [{"up_to_kwh": bound, "rate": rate} for bound, rate in
                   [(100, 3.30), (300, 3.35), (500, 3.65), (600, 4.00), (3000, 4.35),
                    (10000, 5.75), (None, 6.65)]],
         "effective_date": None, "geography": "STELCO Malé region commercial account"},
        {"id": "male_government", "title": "Malé-region government/institutes base tariff",
         "source_id": "stelco-tariff", "unit": "MVR/kWh", "billing_days": 30,
         "bands": [{"up_to_kwh": bound, "rate": rate} for bound, rate in
                   [(100, 3.30), (300, 3.35), (500, 3.65), (600, 4.00), (None, 4.35)]],
         "effective_date": None, "geography": "STELCO Malé region government/institutes account"},
    ],
    "historical_energy": {"source_id": "mote-energy-methodology-2025",
                          "title": "STELCO 2022 grid-generation CO2 sample",
                          "publication_period": "July 2025", "reference_year": 2022,
                          "generation_kwh": 238574998, "diesel_litres": 61126585,
                          "reported_kg_co2_per_kwh": 0.698,
                          "recomputed_kg_co2_per_kwh": 61126585 * 43.3 * 0.849 * 74.1
                          / 1000 / 238574998,
                          "meaning": "Historical generation CO2 example, not a measured 2026 "
                          "delivered-grid CO2e factor. PDF labels for SEGR/GEF ratios are inverted; "
                          "recomputed factor uses emissions divided by generation. Distribution "
                          "losses and non-CO2 gases are outside this example."},
    "limitations": ["Tariff effective date is not published on the captured page. Confirm the "
                    "account, billing period, fuel adjustment and taxes from an actual bill.",
                    "Progressive monthly tiers cannot be replaced by one quoted marginal band "
                    "for all charging consumption.",
                    "These references are not hospital/school construction quotations, current "
                    "bus energy measurements or a nationwide grid-carbon estimate."],
}
(OUTPUT / "references.json").write_text(json.dumps(document, indent=2), encoding="utf8")
print(json.dumps({"sources": len(sources), "failures": len(failures),
                  "output": str(OUTPUT / "references.json")}))
