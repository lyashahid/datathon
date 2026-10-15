"""Local Government Authority council discovery provider."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd

from app.data.cache import FileCache
from app.data.http import PublicSourceClient
from app.data.providers.html_utils import soup_for, table_records, text_preview

PAGE_URL = "https://www.lga.gov.mv/en/councils"
XLSX_URL = "https://www.lga.gov.mv/en/councils?download=1&dataset=councilors"


class LgaProvider:
    source_name = "Local Government Authority"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        page_response = self.client.get_bytes(PAGE_URL)
        self.cache.write_bytes(
            "raw/lga/councils.html",
            page_response.content,
            source=self.source_name,
            endpoint=PAGE_URL,
            http_status=page_response.status_code,
            content_type=page_response.headers.get("content-type"),
            parser_version="lga-discovery-v1",
        )
        download_response = self.client.get_bytes(XLSX_URL)
        content = download_response.content
        is_xlsx = content[:2] == b"PK"
        download_path = self.cache.write_bytes(
            "raw/lga/councils-download.xlsx" if is_xlsx else "raw/lga/councils-download.bin",
            content,
            source=self.source_name,
            endpoint=XLSX_URL,
            http_status=download_response.status_code,
            content_type=download_response.headers.get("content-type"),
            parser_version="lga-discovery-v1",
        )
        result: dict[str, Any] = {
            "source": self.source_name,
            "page_endpoint": PAGE_URL,
            "download_endpoint": XLSX_URL,
            "download_format": "xlsx" if is_xlsx else "non_xlsx",
        }
        if is_xlsx:
            workbook = pd.ExcelFile(BytesIO(content), engine="openpyxl")
            result["sheets"] = []
            for sheet in workbook.sheet_names:
                frame = pd.read_excel(
                    download_path,
                    sheet_name=sheet,
                    header=None,
                    engine="openpyxl",
                )
                result["sheets"].append(
                    {"name": sheet, "rows": int(frame.shape[0]), "columns": int(frame.shape[1])}
                )
            result["dataset_role"] = "councilor_member_export"
            result["council_facility_identity_status"] = (
                "requires_separate_council_registry_extraction"
            )
            member_frame = pd.read_excel(download_path, header=0, engine="openpyxl")
            if "Council" in member_frame.columns:
                council_names = sorted(
                    {
                        str(value).strip()
                        for value in member_frame["Council"].dropna()
                        if str(value).strip()
                    }
                )
                result["council_name_count"] = len(council_names)
                result["council_name_sample"] = council_names[:10]
        else:
            soup = soup_for(page_response.content)
            result["html_table_record_count"] = len(table_records(soup))
            result["html_text_preview"] = text_preview(soup)
        return result
