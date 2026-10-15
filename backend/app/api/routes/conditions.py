"""Environmental conditions and traffic-aware route evidence."""

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from vendor.vela_api.models import DirectionsRequest

router = APIRouter(prefix="/api/v1/conditions", tags=["Conditions"])


@router.get("/status")
def status(request: Request):
    return request.app.state.conditions.status()


@router.get("/weather")
async def weather(
    request: Request,
    latitude: float = Query(4.175, ge=-90, le=90),
    longitude: float = Query(73.509, ge=-180, le=180),
):
    return await request.app.state.conditions.forecast(latitude, longitude)


@router.get("/marine")
async def marine(
    request: Request,
    latitude: float = Query(4.175, ge=-90, le=90),
    longitude: float = Query(73.509, ge=-180, le=180),
):
    return await request.app.state.conditions.forecast(latitude, longitude, marine=True)


@router.post("/traffic")
async def traffic(body: DirectionsRequest, request: Request):
    # Reuse the child API boundary, including its auth, limiter, cache and deadline.
    address = (request.client.host, request.client.port) if request.client else ("127.0.0.1", 0)
    transport = httpx.ASGITransport(app=request.app.state.places_api, client=address)
    async with httpx.AsyncClient(transport=transport, base_url="http://places.local") as client:
        response = await client.post(
            "/directions",
            json=body.model_dump(),
            headers={"x-api-key": request.headers.get("x-api-key", "")},
        )
    envelope = response.json()
    if response.status_code != 200:
        return JSONResponse(
            envelope,
            status_code=response.status_code,
            headers={
                k: v for k, v in response.headers.items() if k in ("x-request-id", "retry-after")
            },
        )
    return {
        **envelope,
        "receipt": {
            "provider": "Vela Google consumer directions",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "qualification": (
                "Traffic time is provider supplied. A null traffic_seconds value means "
                "unavailable; the typical duration remains separate."
            ),
        },
    }
