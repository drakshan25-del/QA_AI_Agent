"""End-to-end UI Scanner journey through the running application (FR-UIS-*).

Drives the real React UI with Playwright: open the Analysis page, switch to the
UI Scanner tab, scan a deterministic fixture, wait for completion, confirm the
scanned elements appear with at least one unique locator, expand the locator
details, approve a locator and save it to the project library.

The scan target is the local fixture in ``tests/fixtures/ui_scanner`` served on
loopback, never a third-party website, so the assertions are stable.

Requires the whole stack (frontend, backend, engine) to be running, and skips
cleanly when it is not::

    QA_E2E_BASE_URL=http://localhost:5173 \\
    QA_E2E_EMAIL=admin@example.com \\
    QA_E2E_PASSWORD=... \\
    QA_E2E_PROJECT_ID=<project-uuid> \\
    .venv/bin/python -m pytest tests/e2e/test_ui_scanner_flow.py
"""

from __future__ import annotations

import functools
import http.server
import os
import socketserver
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "ui_scanner"

BASE_URL = os.environ.get("QA_E2E_BASE_URL", "")
EMAIL = os.environ.get("QA_E2E_EMAIL", "")
PASSWORD = os.environ.get("QA_E2E_PASSWORD", "")
PROJECT_ID = os.environ.get("QA_E2E_PROJECT_ID", "")

#: A scan launches a browser and validates every locator; allow for that.
SCAN_TIMEOUT_MS = 120_000


class _QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@pytest.fixture(scope="module", autouse=True)
def require_stack() -> None:
    missing = [
        name
        for name, value in (
            ("QA_E2E_BASE_URL", BASE_URL),
            ("QA_E2E_EMAIL", EMAIL),
            ("QA_E2E_PASSWORD", PASSWORD),
            ("QA_E2E_PROJECT_ID", PROJECT_ID),
        )
        if not value
    ]
    if missing:
        pytest.skip(f"UI Scanner e2e needs a running stack; set {', '.join(missing)}")


@pytest.fixture(scope="module")
def fixture_url() -> Iterator[str]:
    """Serve the deterministic scan fixture on loopback."""
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(FIXTURE_DIR)
    )
    server = _QuietServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/index.html"
    finally:
        server.shutdown()
        server.server_close()


def _sign_in(page: Page) -> None:
    page.goto(f"{BASE_URL}/login")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(f"{BASE_URL}/dashboard", timeout=30_000)


def test_scan_review_and_save_locators(page: Page, fixture_url: str) -> None:
    _sign_in(page)

    # 1. Open the Analysis page and switch to the UI Scanner section.
    page.goto(f"{BASE_URL}/projects/{PROJECT_ID}/analysis")
    expect(page.get_by_role("heading", name="Analysis")).to_be_visible()
    page.get_by_role("tab", name="UI Scanner").click()

    # 2. Configure and start a scan of the deterministic fixture.
    page.get_by_label("Target URL").fill(fixture_url)
    page.get_by_role("button", name="Start scan").click()
    page.get_by_role("button", name="Scan without signing in").click()

    # 3. Live stages and logs appear while the scan runs.
    expect(page.get_by_role("region", name="UI scan logs")).to_be_visible()

    # 4. Wait for completion.
    expect(page.get_by_text("UI scan completed successfully")).to_be_visible(
        timeout=SCAN_TIMEOUT_MS
    )

    # 5. Scanned elements are listed.
    results = page.get_by_role("table")
    expect(results).to_be_visible(timeout=30_000)
    expect(page.get_by_role("button", name="Login")).to_be_visible()

    # 6. At least one locator is unique.
    expect(results.get_by_text("Unique").first).to_be_visible()

    # 7. Expand an element to inspect its locator candidates.
    page.get_by_role("button", name="Login", exact=False).first.click()
    expect(page.get_by_text("Locator candidates", exact=False)).to_be_visible()

    # 8. Approve a locator.
    page.get_by_role("button", name="Approve").first.click()
    expect(page.get_by_text("Approved").first).to_be_visible()

    # 9. Save the approved locators to the project library.
    page.get_by_role("button", name="Save approved locators", exact=False).click()
    expect(page.get_by_text("saved to the project library", exact=False)).to_be_visible(
        timeout=30_000
    )
