import argparse

import uvicorn

from .config import Settings


def main():
    parser = argparse.ArgumentParser(description="Run the standalone Vela REST API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1") and not Settings.from_env().api_key:
        parser.error("Set VELA_API_KEY before binding to a non-loopback address")
    # Access logs omit URLs because coordinates and continuation tokens are request data.
    uvicorn.run(f"{__package__}.app:app", host=args.host, port=args.port, access_log=False)
