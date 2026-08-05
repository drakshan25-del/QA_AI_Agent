"""ARIA snapshot capture (§8, §20).

Playwright's ARIA snapshot is the accessibility tree as Playwright itself sees
it, so it is the authoritative cross-check for the names this scanner infers:
where the two disagree, Playwright wins, because Playwright is what the
generated tests will run against.

The snapshot is optional — an older Playwright build or a page that crashes
mid-capture records a warning and the scan continues (NFR-REL-001).
"""

from __future__ import annotations

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

from engine.uiscanner.redaction import redact_text
from engine.uiscanner.types import MAX_SNAPSHOT_CHARS


def capture_aria_snapshot(page: Page) -> tuple[str, list[str]]:
    """Return ``(snapshot_yaml, warnings)`` for the page body.

    The snapshot is redacted and truncated: it is a debugging aid for humans,
    not a data export, and an unbounded blob would be persisted on every scan.
    """
    warnings: list[str] = []
    try:
        snapshot = page.locator("body").aria_snapshot()
    except AttributeError:
        return "", [
            "Accessibility snapshot unavailable: this Playwright build has no "
            "aria_snapshot() API — upgrade Playwright to capture it."
        ]
    except PlaywrightError as exc:
        return "", [f"Accessibility snapshot failed: {exc}"]

    text = redact_text(snapshot or "")
    if len(text) > MAX_SNAPSHOT_CHARS:
        text = text[:MAX_SNAPSHOT_CHARS] + "\n# … snapshot truncated by the scanner\n"
        warnings.append(
            f"Accessibility snapshot truncated at {MAX_SNAPSHOT_CHARS} characters."
        )
    return text, warnings


def snapshot_section(snapshot: str, needle: str, radius: int = 12) -> str:
    """Extract the lines around ``needle`` for a bounded LLM prompt (§20).

    The complete snapshot is never sent to a model; only the neighbourhood of
    the element being disambiguated.
    """
    if not snapshot or not needle:
        return ""
    lines = snapshot.splitlines()
    lowered = needle.lower()
    for index, line in enumerate(lines):
        if lowered in line.lower():
            start = max(0, index - radius)
            end = min(len(lines), index + radius + 1)
            return "\n".join(lines[start:end])
    return ""
