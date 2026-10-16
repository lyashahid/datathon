"""Memoized JSON content identity with invalidation for nested source edits.

Planning snapshots are read-only during normal requests. Tracking their uncommon
mutations lets cache hits reuse a content hash without encoding the national
network again. Scenario deep copies deliberately return ordinary containers.
"""

from __future__ import annotations

import copy
from threading import RLock
from typing import Any

from app.data.computed_cache import digest


class ContentSnapshot:
    def __init__(self, value: Any) -> None:
        self.lock = RLock()
        self.revision = 0
        self._hashed_revision = -1
        self._fingerprint = ""
        self.value = _track(value, self)

    def changed(self) -> None:
        self.revision += 1

    def fingerprint(self) -> str:
        with self.lock:
            if self._hashed_revision != self.revision:
                self._fingerprint = digest(self.value)
                self._hashed_revision = self.revision
            return self._fingerprint


def _track(value: Any, state: ContentSnapshot) -> Any:
    if isinstance(value, (_SourceDict, _SourceList)) and value._state is state:
        return value
    if isinstance(value, dict):
        return _SourceDict(value, state)
    if isinstance(value, list):
        return _SourceList(value, state)
    return value


class _SourceDict(dict):
    __slots__ = ("_state",)

    def __init__(self, value: dict, state: ContentSnapshot) -> None:
        self._state = state
        dict.__init__(self, ((key, _track(item, state)) for key, item in value.items()))

    def __deepcopy__(self, memo: dict) -> dict:
        result = {}
        memo[id(self)] = result
        result.update((key, copy.deepcopy(value, memo)) for key, value in self.items())
        return result

    def __setitem__(self, key: Any, value: Any) -> None:
        with self._state.lock:
            dict.__setitem__(self, key, _track(value, self._state))
            self._state.changed()

    def __delitem__(self, key: Any) -> None:
        with self._state.lock:
            dict.__delitem__(self, key)
            self._state.changed()

    def update(self, *args: Any, **kwargs: Any) -> None:
        with self._state.lock:
            for key, value in dict(*args, **kwargs).items():
                self[key] = value

    def __ior__(self, other: Any) -> _SourceDict:
        self.update(other)
        return self

    def setdefault(self, key: Any, default: Any = None) -> Any:
        with self._state.lock:
            if key not in self:
                self[key] = default
            return self[key]

    def pop(self, key: Any, *default: Any) -> Any:
        with self._state.lock:
            present = key in self
            result = dict.pop(self, key, *default)
            if present:
                self._state.changed()
            return result

    def popitem(self) -> tuple:
        with self._state.lock:
            result = dict.popitem(self)
            self._state.changed()
            return result

    def clear(self) -> None:
        with self._state.lock:
            if self:
                dict.clear(self)
                self._state.changed()


class _SourceList(list):
    __slots__ = ("_state",)

    def __init__(self, value: list, state: ContentSnapshot) -> None:
        self._state = state
        list.__init__(self, (_track(item, state) for item in value))

    def __deepcopy__(self, memo: dict) -> list:
        result = []
        memo[id(self)] = result
        result.extend(copy.deepcopy(value, memo) for value in self)
        return result

    def __setitem__(self, key: Any, value: Any) -> None:
        with self._state.lock:
            value = (
                [_track(item, self._state) for item in value]
                if isinstance(key, slice)
                else _track(value, self._state)
            )
            list.__setitem__(self, key, value)
            self._state.changed()

    def __delitem__(self, key: Any) -> None:
        with self._state.lock:
            list.__delitem__(self, key)
            self._state.changed()

    def append(self, value: Any) -> None:
        with self._state.lock:
            list.append(self, _track(value, self._state))
            self._state.changed()

    def extend(self, values: Any) -> None:
        with self._state.lock:
            values = [_track(value, self._state) for value in values]
            if values:
                list.extend(self, values)
                self._state.changed()

    def insert(self, index: int, value: Any) -> None:
        with self._state.lock:
            list.insert(self, index, _track(value, self._state))
            self._state.changed()

    def pop(self, index: int = -1) -> Any:
        with self._state.lock:
            result = list.pop(self, index)
            self._state.changed()
            return result

    def remove(self, value: Any) -> None:
        with self._state.lock:
            list.remove(self, value)
            self._state.changed()

    def clear(self) -> None:
        with self._state.lock:
            if self:
                list.clear(self)
                self._state.changed()

    def reverse(self) -> None:
        with self._state.lock:
            list.reverse(self)
            self._state.changed()

    def sort(self, *args: Any, **kwargs: Any) -> None:
        with self._state.lock:
            try:
                list.sort(self, *args, **kwargs)
            finally:
                self._state.changed()

    def __iadd__(self, values: Any) -> _SourceList:
        self.extend(values)
        return self

    def __imul__(self, count: int) -> _SourceList:
        with self._state.lock:
            list.__imul__(self, count)
            self._state.changed()
        return self
