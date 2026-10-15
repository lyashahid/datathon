"""Public notices remain evidence until a person maps and reviews their meaning."""

import asyncio
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException

PUBLIC_HOSTS = {
    "cap.meteorology.gov.mv",
    "www.meteorology.gov.mv",
    "meteorology.gov.mv",
    "malecity.gov.mv",
    "www.malecity.gov.mv",
    "maavehi.gov.mv",
    "police.gov.mv",
    "www.police.gov.mv",
    "rtl.mv",
    "www.rtl.mv",
    "mtcc.mv",
    "www.mtcc.mv",
    "hdc.mv",
    "www.hdc.mv",
    "english.sun.mv",
    "sun.mv",
    "psmnews.mv",
    "www.psmnews.mv",
    "edition.mv",
    "avas.mv",
}
DISRUPTION = re.compile(
    r"clos(?:e|ure|ed)|block|obstruct|diversion|detour|road\s*work|construction|"
    r"maintenance|suspend|cancel|flood",
    re.I,
)


def public_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if (
            len(value) > 2048
            or parsed.scheme != "https"
            or parsed.hostname not in PUBLIC_HOSTS
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
        ):
            raise ValueError
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except ValueError as exc:
        raise HTTPException(
            422, "Use an HTTPS URL from a supported public Maldives source."
        ) from exc


async def fetch_notice(url: str, client: httpx.AsyncClient | None = None) -> dict:
    try:
        async with asyncio.timeout(45):
            return await _fetch_notice(url, client)
    except TimeoutError as exc:
        raise HTTPException(
            504, "Public notice retrieval exceeded its 45-second deadline."
        ) from exc


async def _fetch_notice(url: str, client: httpx.AsyncClient | None = None) -> dict:
    current = public_url(url)
    owned = client is None
    transport = client or httpx.AsyncClient(follow_redirects=False)
    try:
        for _ in range(5):
            async with transport.stream(
                "GET", current, timeout=12, follow_redirects=False
            ) as response:
                if response.is_redirect:
                    current = public_url(urljoin(current, response.headers.get("location", "")))
                    continue
                response.raise_for_status()
                kind = response.headers.get("content-type", "").lower()
                mime = kind.split(";", 1)[0].strip()
                if not (
                    mime.startswith("text/")
                    or mime == "application/xml"
                    or (mime.startswith("application/") and mime.endswith("+xml"))
                ):
                    raise HTTPException(422, "The source must return text, HTML, or XML.")
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > 1_000_000:
                        raise HTTPException(413, "Public notice exceeds the 1 MB import limit.")
                    chunks.append(chunk)
                raw = b"".join(chunks)
                soup = BeautifulSoup(raw, "html.parser")
                title = soup.title.get_text(" ", strip=True) if soup.title else "Public notice"
                for element in soup(["script", "style", "nav", "footer", "header"]):
                    element.decompose()
                return {
                    "url": current,
                    "title": title[:180],
                    "text": soup.get_text(" ", strip=True)[:16000],
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "bytes": size,
                }
        raise HTTPException(422, "Too many public-notice redirects.")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Public source could not be retrieved: {exc}") from exc
    finally:
        if owned:
            await transport.aclose()


class NoticeStore:
    def __init__(self, runtime_dir: Path, public_dir: Path):
        runtime_dir.mkdir(parents=True, exist_ok=True)
        self.path = runtime_dir / "notices.sqlite"
        self.public_dir = public_dir
        with self.connection() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, body TEXT NOT NULL)"
            )

    def connection(self):
        return sqlite3.connect(self.path, timeout=10)

    def save(self, notice: dict):
        with self.connection() as db:
            db.execute(
                "INSERT OR REPLACE INTO notices (id,body) VALUES (?,?)",
                (notice["id"], json.dumps(notice, ensure_ascii=False)),
            )

    def get(self, notice_id: str) -> dict:
        with self.connection() as db:
            row = db.execute("SELECT body FROM notices WHERE id=?", (notice_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Notice not found.")
        return json.loads(row[0])

    def list(self, status: str | None = None) -> dict:
        with self.connection() as db:
            rows = db.execute("SELECT body FROM notices ORDER BY rowid DESC LIMIT 500").fetchall()
        items = [json.loads(r[0]) for r in rows]
        if status:
            items = [n for n in items if n["status"] == status]
        return {"items": items, "total": len(items), "limit": 500}

    async def ingest(
        self, source_url: str, text: str | None, title: str | None, published_at
    ) -> dict:
        url = public_url(source_url)
        receipt = (
            {
                "url": url,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "input_method": "user_supplied_text",
                "sha256": hashlib.sha256(text.encode()).hexdigest(),
            }
            if text is not None
            else await fetch_notice(url)
        )
        content = re.sub(r"\s+", " ", text if text is not None else receipt["text"]).strip()
        if not 20 <= len(content) <= 16000:
            raise HTTPException(422, "Notice text must contain 20–16,000 characters.")
        notice_id = "notice:" + hashlib.sha256((url + content).encode()).hexdigest()[:24]
        try:
            existing = self.get(notice_id)
            return {**existing, "duplicate": True}
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        sentences = re.split(r"(?<=[.!?])\s+", content)
        support = next((s for s in sentences if DISRUPTION.search(s)), content[:500])
        location = re.search(
            r"\b(?:[A-Z][\w'-]*\s+){0,3}(?:Magu|Road|Street|Bridge|Terminal|Harbou?r)\b", support
        )
        notice = {
            "id": notice_id,
            "title": (title or receipt.get("title") or "Public notice")[:180],
            "source_url": url,
            "published_at": published_at.isoformat() if published_at else None,
            "ingested_at": receipt["retrieved_at"],
            "text": content,
            "supporting_text": support[:1200],
            "possible_location": location.group(0) if location else None,
            "possible_mode": (
                "ferry"
                if re.search(r"ferry|boat|sailing|marine", support, re.I)
                else "road"
                if re.search(r"road|magu|street|bridge|traffic", support, re.I)
                else "unknown"
            ),
            "confidence": "medium" if DISRUPTION.search(content) else "low",
            "status": "candidate",
            "receipt": {k: v for k, v in receipt.items() if k != "text"},
            "review": None,
            "proposed_operation": None,
            "qualification": (
                "Rules extraction suggests relevance only. A reviewer must map a known target "
                "and validity window; baseline routes are never changed by ingestion."
            ),
        }
        self.save(notice)
        return notice

    def review(self, notice_id: str, review: dict) -> dict:
        notice = self.get(notice_id)
        operation = None
        if review["decision"] == "approved":
            with (self.public_dir / "planning-baseline.json").open(encoding="utf-8") as file:
                baseline = json.load(file)
            kind, target = review["operation_type"], review["target_id"]
            if kind == "road_closure":
                edges = baseline["network"]["edges"]
                allowed = {
                    str(e.get(k)) for e in edges for k in ("id", "sourceOsmWayId") if e.get(k)
                }
                target_check = target.removeprefix("osm:way:")
            elif kind == "disable_facility":
                allowed = {f["id"] for f in baseline["facilities"]}
                target_check = target
            else:
                allowed = {p["id"] for p in baseline["transit"]["patterns"]}
                target_check = target
            if target_check not in allowed:
                raise HTTPException(422, "Target is absent from the preserved planning network.")
            operation = {
                "type": kind,
                "target_id": target,
                "metadata": {
                    "notice_id": notice_id,
                    "source_url": notice["source_url"],
                    "valid_from": review["valid_from"],
                    "valid_until": review["valid_until"],
                    "reviewed": True,
                    "qualification": "Reviewer interpretation of public notice",
                },
            }
        notice.update(
            status=review["decision"],
            proposed_operation=operation,
            review={
                **review,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        self.save(notice)
        return notice

    def snapshot(self) -> dict:
        path = self.public_dir / "operations" / "bundle.json"
        if not path.exists():
            return {"status": "unavailable", "notices": self.list(), "sources": []}
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {
            **payload,
            "data_kind": "preserved_public_evidence",
            "qualification": (
                "This is a dated evidence snapshot. Alerts do not establish current weather, "
                "road closures or ferry cancellations. Imported notices require review."
            ),
            "notices": self.list(),
            "supported_notice_hosts": sorted(PUBLIC_HOSTS),
        }
