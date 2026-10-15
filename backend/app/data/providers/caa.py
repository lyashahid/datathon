"""Civil Aviation Authority aerodrome discovery provider."""

from __future__ import annotations

from typing import Any

from pypdf import PdfReader

from app.data.cache import FileCache
from app.data.http import PublicSourceClient
from app.data.providers.html_utils import clean_text, soup_for, table_records

PAGE_URL = "https://caa.gov.mv/operations/air-operations/status-of-certification-of-aerodromes"
PDF_URL = "https://caa.gov.mv/attachments/RkSqFC1muGxI4GakQ992lPnwqT5gjTxwiat2m7af.pdf"


class CaaProvider:
    source_name = "Maldives Civil Aviation Authority"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        page_response = self.client.get_bytes(PAGE_URL)
        self.cache.write_bytes(
            "raw/caa/certification.html",
            page_response.content,
            source=self.source_name,
            endpoint=PAGE_URL,
            http_status=page_response.status_code,
            content_type=page_response.headers.get("content-type"),
            parser_version="caa-discovery-v1",
        )
        page_records = table_records(soup_for(page_response.content))

        pdf_response = self.client.get_bytes(PDF_URL)
        pdf_path = self.cache.write_bytes(
            "raw/caa/aerodromes.pdf",
            pdf_response.content,
            source=self.source_name,
            endpoint=PDF_URL,
            http_status=pdf_response.status_code,
            content_type=pdf_response.headers.get("content-type"),
            parser_version="caa-discovery-v1",
        )
        reader = PdfReader(str(pdf_path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        return {
            "source": self.source_name,
            "page_endpoint": PAGE_URL,
            "pdf_endpoint": PDF_URL,
            "html_table_record_count": len(page_records),
            "html_airport_names": [
                record.get("aerodrome name", "")
                for record in page_records
                if record.get("aerodrome name")
            ],
            "pdf_page_count": len(reader.pages),
            "pdf_text_characters": len(text),
            "pdf_text_preview": clean_text(text)[:1000],
        }
