"""In-process ordered event bus per job/run for SSE forwarding (FR-ENG-003).

The engine emits ordered events (job progress, execution steps) into a
per-key queue. The backend consumes them over SSE (``GET /internal/v1/jobs/
{id}/events``) and forwards to the React frontend over WebSocket. Sequence
numbers are monotonic per key so the frontend can reconnect and resume
(FR-BE-004, FR-EXE-006).
"""

from __future__ import annotations

import queue
import threading
from typing import Any

_LOCK = threading.Lock()
_QUEUES: dict[str, queue.Queue] = {}
_SEQ: dict[str, int] = {}
_DONE: dict[str, bool] = {}

_SENTINEL = object()


def _q(key: str) -> queue.Queue:
    with _LOCK:
        if key not in _QUEUES:
            _QUEUES[key] = queue.Queue()
            _SEQ[key] = 0
            _DONE[key] = False
        return _QUEUES[key]


def emit(key: str, event_type: str, payload: dict[str, Any]) -> dict:
    """Append an ordered event to ``key`` and return the full envelope."""
    q = _q(key)
    with _LOCK:
        _SEQ[key] += 1
        seq = _SEQ[key]
    envelope = {"type": event_type, "seq": seq, "payload": payload}
    q.put(envelope)
    return envelope


def close(key: str) -> None:
    """Signal that no more events will arrive for ``key``."""
    q = _q(key)
    with _LOCK:
        _DONE[key] = True
    q.put(_SENTINEL)


def stream(key: str, from_seq: int = 0):
    """Yield envelopes for ``key`` in order, resuming after ``from_seq``.

    Blocks for live events; ends when :func:`close` has been called and the
    queue is drained. Reconnect support: events with seq <= from_seq are
    skipped (FR-BE-004).
    """
    q = _q(key)
    while True:
        item = q.get()
        if item is _SENTINEL:
            return
        if item["seq"] > from_seq:
            yield item
        with _LOCK:
            done = _DONE[key]
        if done and q.empty():
            return
