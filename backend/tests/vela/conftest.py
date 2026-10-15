"""Allow unchanged upstream async fixtures without changing global test mode."""

import inspect

import pytest


def pytest_collection_modifyitems(items):
    for item in items:
        if str(item.fspath).replace("\\", "/").find("/tests/vela/") >= 0:
            if inspect.iscoroutinefunction(item.obj):
                item.add_marker(pytest.mark.asyncio)
