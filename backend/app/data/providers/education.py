"""Ministry of Education school directory discovery provider."""

from __future__ import annotations

import re
from typing import Any

from app.data.cache import FileCache
from app.data.http import PublicSourceClient
from app.data.providers.html_utils import absolute_links, clean_text, soup_for, text_preview

DIRECTORY_URL = "https://www.moe.gov.mv/en/schools"
SCHOOL_PATTERN = re.compile(r"/en/schools/(\d+)(?:$|[/?#])")


class EducationProvider:
    source_name = "Ministry of Education school directory"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        directory_response = self.client.get_bytes(DIRECTORY_URL)
        self.cache.write_bytes(
            "raw/education/directory.html",
            directory_response.content,
            source=self.source_name,
            endpoint=DIRECTORY_URL,
            http_status=directory_response.status_code,
            content_type=directory_response.headers.get("content-type"),
            parser_version="education-discovery-v1",
        )
        soup = soup_for(directory_response.content)
        detail_urls = [
            url
            for url in absolute_links(soup, DIRECTORY_URL, "/en/schools/")
            if SCHOOL_PATTERN.search(url)
        ]
        detail_urls = sorted(set(detail_urls))
        records: list[dict[str, Any]] = []
        for url in detail_urls:
            school_id_match = SCHOOL_PATTERN.search(url)
            if not school_id_match:
                continue
            response = self.client.get_bytes(url)
            school_id = school_id_match.group(1)
            self.cache.write_bytes(
                f"raw/education/schools/{school_id}.html",
                response.content,
                source=self.source_name,
                endpoint=url,
                http_status=response.status_code,
                content_type=response.headers.get("content-type"),
                source_record_id=school_id,
                parser_version="education-discovery-v1",
            )
            records.append(_parse_school(response.content, school_id, url))

        return {
            "source": self.source_name,
            "endpoint": DIRECTORY_URL,
            "directory_link_count": len(detail_urls),
            "detail_pages_fetched": len(records),
            "unique_school_ids": len({record["school_id"] for record in records}),
            "sample_records": records[:5],
        }


def _parse_school(content: bytes, school_id: str, url: str) -> dict[str, Any]:
    soup = soup_for(content)
    headings = [
        clean_text(element.get_text(" ", strip=True))
        for element in soup.find_all(["h1", "h2", "h3"])
    ]
    return {
        "school_id": school_id,
        "detail_url": url,
        "heading": headings[0] if headings else "",
        "text_preview": text_preview(soup, limit=500),
    }
