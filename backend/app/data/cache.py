"""Atomic raw-source cache with integrity metadata."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


class FileCache:
    """Store raw source files and metadata without overwriting good data in place."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, relative_path: str | Path) -> Path:
        relative = Path(relative_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Cache paths must be relative to the cache root")
        return self.root / relative

    def write_bytes(
        self,
        relative_path: str | Path,
        content: bytes,
        *,
        source: str,
        endpoint: str,
        http_status: int = 200,
        content_type: str | None = None,
        source_record_id: str | None = None,
        parser_version: str = "discovery-v1",
    ) -> Path:
        destination = self.path(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        checksum = hashlib.sha256(content).hexdigest()
        self._atomic_write(destination, content)

        metadata = {
            "source": source,
            "endpoint": endpoint,
            "retrieved_at": datetime.now(UTC).isoformat(),
            "http_status": http_status,
            "content_type": content_type,
            "sha256": checksum,
            "source_record_id": source_record_id,
            "parser_version": parser_version,
            "schema_version": 1,
            "status": "fresh",
        }
        self._atomic_write(
            Path(f"{destination}.meta.json"),
            json.dumps(metadata, indent=2, sort_keys=True).encode("utf-8"),
        )
        return destination

    def write_json(self, relative_path: str | Path, value: Any, **metadata: Any) -> Path:
        destination = self.path(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                json.dump(
                    value,
                    temporary,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                temporary.flush()
                os.fsync(temporary.fileno())
            digest = hashlib.sha256()
            with temporary_path.open("rb") as content_file:
                for chunk in iter(lambda: content_file.read(1024 * 1024), b""):
                    digest.update(chunk)
            os.replace(temporary_path, destination)
            temporary_path = None
            metadata = {
                **metadata,
                "content_type": "application/json",
                "sha256": digest.hexdigest(),
            }
            self._atomic_write(
                Path(f"{destination}.meta.json"),
                json.dumps(
                    {
                        "source": metadata.pop("source"),
                        "endpoint": metadata.pop("endpoint"),
                        "retrieved_at": datetime.now(UTC).isoformat(),
                        "http_status": metadata.pop("http_status", 200),
                        "content_type": metadata.pop("content_type"),
                        "sha256": metadata.pop("sha256"),
                        "source_record_id": metadata.pop("source_record_id", None),
                        "parser_version": metadata.pop("parser_version", "discovery-v1"),
                        "schema_version": 1,
                        "status": "fresh",
                        **metadata,
                    },
                    indent=2,
                    sort_keys=True,
                ).encode("utf-8"),
            )
            return destination
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def read_bytes(self, relative_path: str | Path) -> bytes:
        return self.path(relative_path).read_bytes()

    def read_json(self, relative_path: str | Path) -> Any:
        return json.loads(self.read_bytes(relative_path))

    def read_metadata(self, relative_path: str | Path) -> dict[str, Any]:
        return self.read_json(f"{relative_path}.meta.json")

    @staticmethod
    def _atomic_write(destination: Path, content: bytes) -> None:
        with NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, destination)
