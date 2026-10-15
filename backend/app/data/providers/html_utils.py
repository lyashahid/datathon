"""Small HTML extraction helpers for public directory discovery."""

from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urljoin

from bs4 import BeautifulSoup


def soup_for(content: bytes | str, url: str | None = None) -> BeautifulSoup:
    return BeautifulSoup(content, "html.parser", from_encoding=None)


def clean_text(value: str | None) -> str:
    return " ".join((value or "").split())


def table_records(soup: BeautifulSoup) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        header_row = next((row for row in rows if row.find_all("th")), None)
        if header_row is not None:
            header_cells = header_row.find_all("th")
        else:
            header_row = rows[0] if rows and rows[0].find_all("td") else None
            header_cells = header_row.find_all("td") if header_row is not None else []
            if not any(cell.find("b") for cell in header_cells):
                header_cells = []
        headers = [clean_text(cell.get_text(" ", strip=True)).lower() for cell in header_cells]
        if not headers:
            continue
        for row in rows:
            if row is header_row:
                continue
            cells = row.find_all("td")
            if not cells:
                continue
            values = [clean_text(cell.get_text(" ", strip=True)) for cell in cells]
            records.append(
                {
                    (headers[index] if index < len(headers) else f"column_{index}"): value
                    for index, value in enumerate(values)
                }
            )
    return records


def absolute_links(soup: BeautifulSoup, base_url: str, href_contains: str) -> list[str]:
    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"])
        if href_contains in href:
            links.append(urljoin(base_url, href))
    return sorted(set(links))


def text_preview(soup: BeautifulSoup, limit: int = 1000) -> str:
    return clean_text(soup.get_text(" ", strip=True))[:limit]


def counts(values: Iterable[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[value] = result.get(value, 0) + 1
    return dict(sorted(result.items()))
