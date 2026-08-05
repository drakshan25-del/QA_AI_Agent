"""Sensitive-value redaction for scanned UI metadata (§7, SEC-007).

The scanner reads a live authenticated application, so element values can hold
passwords, one-time codes, session identifiers and bearer tokens. Nothing here
is ever needed to build a locator, so values are dropped at the point of
capture rather than filtered later:

* password/hidden inputs and anything whose name, id, label or placeholder
  looks credential-shaped contribute metadata only (role, label, type);
* every surviving free-text value passes :func:`safe_value`, which masks
  token-shaped strings and truncates the rest;
* :func:`redact_mapping` sanitises whole attribute maps before they leave the
  engine.
"""

from __future__ import annotations

import re
from typing import Any

MASK = "***"

#: Input types whose value is never captured.
SENSITIVE_INPUT_TYPES = frozenset({"password", "hidden"})

#: Substrings in name/id/label/placeholder that mark a field as sensitive.
SENSITIVE_NAME_HINTS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "otp",
    "one-time",
    "onetime",
    "mfa",
    "2fa",
    "cvv",
    "cvc",
    "pin",
    "ssn",
    "creditcard",
    "credit-card",
    "cardnumber",
    "card-number",
    "apikey",
    "api-key",
    "api_key",
    "authorization",
    "auth",
    "session",
    "cookie",
    "credential",
)

#: Value shapes that are secrets regardless of the field they came from.
_SECRET_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^(?:bearer|basic)\s+\S+$", re.IGNORECASE),
    re.compile(r"^gh[pousr]_[A-Za-z0-9]{16,}$"),
    re.compile(r"^github_pat_[A-Za-z0-9_]{20,}$"),
    re.compile(r"^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$"),  # JWT
    re.compile(r"^[A-Fa-f0-9]{32,}$"),  # long hex blob (session ids, hashes)
)

#: Free-text redaction for log lines (mirrors the backend's redactText).
_LABELLED_SECRET = re.compile(
    r"(password|passwd|pwd|secret|token|credential|cookie|authorization)"
    r"([=:\s]+)(\S+)",
    re.IGNORECASE,
)

#: Longest value kept for display; locators never need more than this.
MAX_VALUE_CHARS = 120


def looks_sensitive(*names: str | None) -> bool:
    """True when any identifier hints at a credential-bearing field."""
    for name in names:
        low = (name or "").strip().lower()
        if low and any(hint in low for hint in SENSITIVE_NAME_HINTS):
            return True
    return False


def safe_value(value: str | None, *, sensitive: bool = False) -> str:
    """Return a value safe to store and display, or ``''``.

    Sensitive fields yield ``''`` (the metadata still describes the field);
    secret-shaped values are masked; everything else is whitespace-collapsed
    and truncated.
    """
    if value is None:
        return ""
    text = str(value).strip()
    if not text or sensitive:
        return ""
    if any(pattern.match(text) for pattern in _SECRET_VALUE_PATTERNS):
        return MASK
    text = re.sub(r"\s+", " ", text)
    return text[:MAX_VALUE_CHARS]


def redact_text(text: str) -> str:
    """Mask labelled secrets inside a free-text log line."""
    if not text:
        return text
    return _LABELLED_SECRET.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{MASK}", text
    )


def redact_mapping(data: dict[str, Any], depth: int = 0) -> dict[str, Any]:
    """Recursively mask credential-shaped keys in an attribute mapping."""
    if depth > 5:
        return {}
    out: dict[str, Any] = {}
    for key, value in data.items():
        if looks_sensitive(key):
            out[key] = MASK
        elif isinstance(value, dict):
            out[key] = redact_mapping(value, depth + 1)
        elif isinstance(value, str):
            out[key] = safe_value(value)
        else:
            out[key] = value
    return out
