"""Public HEMS health-establishment directory discovery provider."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

from app.data.cache import FileCache
from app.data.http import PublicSourceClient
from app.data.providers.html_utils import clean_text, counts, soup_for

BASE_URL = "https://hems.health.gov.mv/establishments"
_ID_PATTERN = re.compile(r"toggleProfessionals\(this,\s*(\d+)\)")


class HemsProvider:
    source_name = "Ministry of Health HEMS"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        pages = 0
        seen_signatures: set[tuple[str, ...]] = set()
        for page_number in range(1, 501):
            url = BASE_URL if page_number == 1 else f"{BASE_URL}?{urlencode({'page': page_number})}"
            response = self.client.get_bytes(url)
            self.cache.write_bytes(
                f"raw/health/page_{page_number}.html",
                response.content,
                source=self.source_name,
                endpoint=url,
                http_status=response.status_code,
                content_type=response.headers.get("content-type"),
                parser_version="hems-discovery-v1",
            )
            page_records = _parse_records(response.content)
            signature = tuple(record["establishment_id"] for record in page_records)
            if not page_records or signature in seen_signatures:
                break
            seen_signatures.add(signature)
            records.extend(page_records)
            pages += 1

        return {
            "source": self.source_name,
            "endpoint": BASE_URL,
            "page_count": pages,
            "record_count": len(records),
            "unique_establishment_ids": len({record["establishment_id"] for record in records}),
            "facility_levels": counts(record["facility_level"] for record in records),
            "owners": counts(record["owner"] for record in records),
            "statuses": counts(record["status"] for record in records),
            "records_with_island_text": sum(bool(record.get("island_text")) for record in records),
            "sample_records": records[:5],
        }


def _parse_records(content: bytes) -> list[dict[str, Any]]:
    soup = soup_for(content)
    records: list[dict[str, Any]] = []
    for row in soup.select("tr.est-row"):
        cells = row.find_all("td")
        values = [clean_text(cell.get_text(" ", strip=True)) for cell in cells]
        if not values:
            continue
        match = _ID_PATTERN.search(str(row.get("onclick", "")))
        if not match:
            continue
        records.append(
            {
                "establishment_id": match.group(1),
                "name": values[0] if len(values) > 0 else "",
                "owner": values[1] if len(values) > 1 else "",
                "facility_level": values[2] if len(values) > 2 else "",
                "registration_number": values[3] if len(values) > 3 else "",
                "license_number": values[4] if len(values) > 4 else "",
                "contact": values[5] if len(values) > 5 else "",
                "email": values[6] if len(values) > 6 else "",
                "status": "closed" if "est-row-closed" in (row.get("class") or []) else "open",
                "island_text": _find_island_text(values[0] if values else ""),
            }
        )
    return records


def _find_island_text(name: str) -> str:
    parts = [part.strip() for part in re.split(r"[,()\-]", name) if part.strip()]
    return parts[0] if len(parts) > 1 else ""
