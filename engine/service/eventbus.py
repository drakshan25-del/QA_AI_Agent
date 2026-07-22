"""In-process ordered event bus per job/run for SSE forwarding (FR-ENG-003).

The engine emits ordered events (job progress, execution steps) into a
per-key history list. The backend consumes them over SSE (``GET /internal/v1/
runs/{id}/events``) and forwards to the React frontend over WebSocket.

Design (FR-BE-004, FR-EXE-006, FR-V3-LOG-008):
- Events are appended to a retained per-key history, so any number of
  consumers can stream concurrently and a reconnect with ``from_seq`` replays
  everything it missed — including after the run has completed.
- Sequence numbers are monotonic per key.
- Memory is bounded: each key retains at most ``MAX_EVENTS_PER_KEY`` events
  and at most ``MAX_CLOSED_KEYS`` completed runs are kept for replay before
  the oldest are evicted.
"""

from __future__ import annotations

import threading
from typing import Any, Iterator

_LOCK = threading.Lock()
_COND = threading.Condition(_LOCK)
_HISTORY: dict[str, list[dict]] = {}
_DONE: dict[str, bool] = {}
_CLOSED_ORDER: list[str] = []  # completed keys, oldest first (eviction order)

#: Upper bound on retained events per run; oldest events are dropped beyond it.
MAX_EVENTS_PER_KEY = 10_000
#: Completed runs kept replayable before the oldest are evicted.
MAX_CLOSED_KEYS = 200

#: Wait slice for streaming consumers; bounds reaction time to missed wakeups.
_WAIT_SECONDS = 1.0


def emit(key: str, event_type: str, payload: dict[str, Any]) -> dict:
    """Append an ordered event to ``key`` and return the full envelope."""
    with _COND:
        hist = _HISTORY.setdefault(key, [])
        _DONE.setdefault(key, False)
        seq = hist[-1]["seq"] + 1 if hist else 1
        envelope = {"type": event_type, "seq": seq, "payload": payload}
        hist.append(envelope)
        if len(hist) > MAX_EVENTS_PER_KEY:
            del hist[: len(hist) - MAX_EVENTS_PER_KEY]
        _COND.notify_all()
    return envelope


def close(key: str) -> None:
    """Signal that no more events will arrive for ``key``.

    Idempotent. The history stays available for replay until evicted by the
    ``MAX_CLOSED_KEYS`` retention bound.
    """
    with _COND:
        _HISTORY.setdefault(key, [])
        if not _DONE.get(key, False):
            _DONE[key] = True
            _CLOSED_ORDER.append(key)
            while len(_CLOSED_ORDER) > MAX_CLOSED_KEYS:
                evicted = _CLOSED_ORDER.pop(0)
                if evicted != key:
                    _HISTORY.pop(evicted, None)
                    _DONE.pop(evicted, None)
        _COND.notify_all()


def purge(key: str) -> None:
    """Drop all state for ``key`` immediately (tests / explicit cleanup)."""
    with _COND:
        _HISTORY.pop(key, None)
        _DONE.pop(key, None)
        if key in _CLOSED_ORDER:
            _CLOSED_ORDER.remove(key)
        _COND.notify_all()


def is_done(key: str) -> bool:
    """True when :func:`close` has been called for ``key``."""
    with _LOCK:
        return _DONE.get(key, False)


def stream(key: str, from_seq: int = 0) -> Iterator[dict]:
    """Yield envelopes for ``key`` in order, resuming after ``from_seq``.

    Replays retained history first (so late subscribers and reconnects get
    every event, even after completion), then blocks for live events. Ends
    when :func:`close` has been called and all events were delivered.
    Multiple consumers may stream the same key concurrently; each receives
    the complete sequence.
    """
    last = from_seq
    while True:
        with _COND:
            hist = _HISTORY.get(key, [])
            pending = [e for e in hist if e["seq"] > last]
            done = _DONE.get(key, False)
            if not pending:
                if done:
                    return
                _COND.wait(timeout=_WAIT_SECONDS)
                continue
        for envelope in pending:
            last = envelope["seq"]
            yield envelope
