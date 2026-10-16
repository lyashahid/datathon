"""Explicit local maintenance for the optional development computation cache.

Run from a local checkout only, never from a deployment or container entrypoint:
``uv run --directory backend python -m app.cli.database_setup``.
The application runtime does not execute schema setup.
"""

from __future__ import annotations

from app.config.settings import Settings
from app.data.computed_cache import postgres_connection_options


def initialize_shared_cache(settings: Settings) -> None:
    """Create only the cache table in the pre-existing configured schema."""
    if settings.environment != "development":
        raise ValueError("Database setup is allowed only from a local development checkout.")
    if not settings.shared_cache_database_url:
        raise ValueError("Enable and configure the optional development database cache first.")

    import psycopg

    url, options = postgres_connection_options(settings.shared_cache_database_url)
    with psycopg.connect(url, **options) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS mobility_computed_cache ("
            "cache_key text PRIMARY KEY, payload bytea NOT NULL, "
            "created_at timestamptz NOT NULL DEFAULT now())"
        )


def main() -> int:
    try:
        initialize_shared_cache(Settings())
    except Exception:
        # Database errors can embed credentials. Keep them out of CLI/CI logs.
        print(
            "Cache table setup failed. Check local development settings and database permissions."
        )
        return 1
    print("Optional development cache table is ready. No source-data tables were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
