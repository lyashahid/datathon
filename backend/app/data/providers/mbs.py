"""MBS Census 2022 P3 workbook discovery provider."""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data.cache import FileCache
from app.data.http import PublicSourceClient

P3_URL = "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P3.xlsx"
MBS_TABLE_URLS = {
    "P3": P3_URL,
    "P4": "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P4.xlsx",
    "P5": "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P5.xlsx",
    "P6": "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P6.xlsx",
}


class MbsProvider:
    source_name = "Maldives Bureau of Statistics Census 2022"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        paths: dict[str, Any] = {}
        for table, url in MBS_TABLE_URLS.items():
            response = self.client.get_bytes(url)
            paths[table] = self.cache.write_bytes(
                f"raw/mbs/{table}.xlsx",
                response.content,
                source=self.source_name,
                endpoint=url,
                http_status=response.status_code,
                content_type=response.headers.get("content-type"),
                parser_version="mbs-census-2022-tables-v1",
            )

        p3_path = paths["P3"]
        workbook = pd.ExcelFile(p3_path, engine="openpyxl")
        sheets: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        for sheet in workbook.sheet_names:
            frame = pd.read_excel(p3_path, sheet_name=sheet, header=None, engine="openpyxl")
            preview = _preview(frame, rows=8, columns=12)
            sheet_summary = {
                "name": sheet,
                "rows": int(frame.shape[0]),
                "columns": int(frame.shape[1]),
                "preview": preview,
            }
            sheets.append(sheet_summary)
            candidate = _find_population_candidate(frame, sheet)
            if candidate:
                candidate.update(_population_summary(frame, candidate))
                candidates.append(candidate)

        return {
            "source": self.source_name,
            "endpoint": P3_URL,
            "file": str(p3_path),
            "files": {table: str(path) for table, path in paths.items()},
            "file_size_bytes": p3_path.stat().st_size,
            "sheets": sheets,
            "population_candidates": candidates,
            "selected_table": "P3",
            "demographic_tables": ["P4", "P5", "P6"],
            "population_year": 2022,
        }


def _preview(frame: pd.DataFrame, *, rows: int, columns: int) -> list[list[Any]]:
    result: list[list[Any]] = []
    for row in frame.iloc[:rows, :columns].values.tolist():
        result.append([None if pd.isna(value) else str(value) for value in row])
    return result


def _find_population_candidate(frame: pd.DataFrame, sheet: str) -> dict[str, Any] | None:
    for row_index in range(min(len(frame), 30)):
        values = [str(value).strip().lower() for value in frame.iloc[row_index].tolist()]
        island_columns = [
            index for index, value in enumerate(values) if value in {"island", "locality"}
        ]
        year_columns = [
            index
            for index, value in enumerate(values)
            if value == "2022" or ("2022" in value and "population" in value)
        ]
        if island_columns and year_columns and row_index + 1 < len(frame):
            population_column = year_columns[0]
            subheader = str(frame.iloc[row_index + 1, population_column]).strip().lower()
            if values[population_column] == "2022" and subheader and subheader != "population":
                continue
            return {
                "sheet": sheet,
                "header_row": row_index,
                "island_column": next(
                    (index for index in island_columns if str(values[index]) == "locality"),
                    island_columns[0],
                ),
                "atoll_column": next(
                    (index for index, value in enumerate(values) if value == "atoll"),
                    None,
                ),
                "population_2022_column": population_column,
            }
    return None


def _population_summary(frame: pd.DataFrame, candidate: dict[str, Any]) -> dict[str, Any]:
    start_row = candidate["header_row"] + 1
    island_column = candidate["island_column"]
    atoll_column = candidate["atoll_column"]
    population_column = candidate["population_2022_column"]
    rows: list[dict[str, Any]] = []
    for row in frame.iloc[start_row:].itertuples(index=False, name=None):
        if island_column >= len(row) or population_column >= len(row):
            continue
        locality = row[island_column]
        population = pd.to_numeric(row[population_column], errors="coerce")
        if pd.isna(locality) or pd.isna(population):
            continue
        atoll = row[atoll_column] if atoll_column is not None and atoll_column < len(row) else None
        if pd.isna(atoll):
            continue
        rows.append(
            {
                "atoll_code": str(atoll).strip(),
                "locality": str(locality).strip(),
                "population_2022": int(population),
            }
        )
    return {
        "island_record_count": len(rows),
        "island_population_total": sum(row["population_2022"] for row in rows),
        "sample_island_records": rows[:5],
        "matching_status": "deferred_to_phase_2_atoll_and_name_reconciliation",
    }
