"""Keep reviewed source-data maintenance out of the public production app."""

from fastapi import HTTPException, Request


def source_mutations_allowed(request: Request) -> bool:
    settings = getattr(request.app.state, "settings", None)
    return getattr(settings, "environment", "development") != "production"


def require_local_source_maintenance(request: Request) -> None:
    if not source_mutations_allowed(request):
        raise HTTPException(
            status_code=403,
            detail=(
                "Source-data changes are disabled in production. Review and prepare updated "
                "datasets in your local checkout, then deploy the reviewed snapshot."
            ),
        )
