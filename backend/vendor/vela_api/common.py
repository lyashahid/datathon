"""Defensive helpers for Google's positional wire format."""

import json
import math


class ApiError(Exception):
    def __init__(self, code, message, status_code=502, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def at(value, *indexes):
    for index in indexes:
        if not isinstance(value, list) or index < 0 or index >= len(value):
            return None
        value = value[index]
    return value


def string(value):
    return value if isinstance(value, str) else None


def number(value, default=None):
    if value is None or isinstance(value, bool):
        return default
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except ValueError, TypeError, OverflowError:
        return default


def parse_json(body):
    body = body.lstrip("\ufeff \t\r\n")
    for guard in (")]}'\n", ")]}',\n", ")]}'", ")]}", "while(1);", "for(;;);"):
        if body.startswith(guard):
            body = body[len(guard) :].lstrip()
            break
    try:
        return json.loads(body)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ApiError(
            "upstream_parse_error", "Upstream returned an unexpected JSON envelope."
        ) from exc
