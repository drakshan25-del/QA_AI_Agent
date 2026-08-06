"""Pytest fixtures for the whole automation tree (hand-written + generated tests).

Configuration comes exclusively from environment variables so that neither
hand-written nor AI-generated tests ever contain URL or credential literals
(FR-AUT-005, SEC-002). Browser/page fixtures are provided by pytest-playwright,
which creates a fresh browser context per test (FR-EXE-002).

Fixtures exposed to every test under ``automation/``:

* ``base_url`` — target app root from ``QA_TARGET_BASE_URL``
  (default ``http://localhost:8001``); overrides pytest-base-url's fixture so
  relative ``page.goto()`` calls also resolve against it.
* ``credentials`` — ``Credentials(username, password)`` from
  ``QA_TEST_USERNAME`` / ``QA_TEST_PASSWORD`` (defaults match the sample app).
* ``target_available`` — pings ``base_url`` once per session (httpx, 2 s
  timeout) and skips requesting tests when the target app is not running, so
  suites stay green without services.
* ``_domain_allowlist_guard`` (autouse) — runtime enforcement of the domain
  allow-list (SEC-003, complements the static FR-VAL-004 check): every
  browser test's Playwright context gets a route that aborts requests whose
  host is not on ``QA_ALLOWED_DOMAINS`` (exact or dot-suffix match). An
  empty/unset variable falls back to ``localhost,127.0.0.1`` — never
  allow-all.

This module stays dependency-light (stdlib + httpx + pytest only) so the
automation tree remains standalone in CI.
"""

from __future__ import annotations

import os
from typing import NamedTuple
from urllib.parse import urlparse

import httpx
import pytest

DEFAULT_BASE_URL = "http://localhost:8001"

#: Fallback for the runtime domain allow-list (SEC-003). An empty or unset
#: QA_ALLOWED_DOMAINS must never mean "allow everything".
DEFAULT_ALLOWED_DOMAINS = "localhost,127.0.0.1"


def _allowed_domains(raw: str | None) -> list[str]:
    """Parse a ``QA_ALLOWED_DOMAINS`` value into a domain list (SEC-003).

    Empty or unset input falls back to :data:`DEFAULT_ALLOWED_DOMAINS` — the
    guard never degrades to allow-all.
    """
    entries = [d.strip() for d in (raw or "").split(",") if d.strip()]
    return entries or DEFAULT_ALLOWED_DOMAINS.split(",")


def _host_allowed(url: str, domains: list[str]) -> bool:
    """True iff ``url``'s host is on the allow-list (SEC-003). Pure function.

    A host matches an entry on exact equality or as a subdomain (dot-suffix):
    ``example.com`` allows ``example.com`` and ``app.example.com`` but never
    ``notexample.com``. URLs without a parseable host, and empty allow-lists,
    are refused — the guard fails closed.
    """
    host = (urlparse(url).hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    for entry in domains:
        domain = entry.strip().lower().lstrip(".").rstrip(".")
        if domain and (host == domain or host.endswith("." + domain)):
            return True
    return False


@pytest.fixture(autouse=True)
def _domain_allowlist_guard(request: pytest.FixtureRequest) -> None:
    """Enforce the domain allow-list at runtime for every browser test (SEC-003).

    Wraps pytest-playwright's ``context`` fixture with a catch-all route that
    aborts any request whose host is not allowed by ``QA_ALLOWED_DOMAINS``
    (injected into the pytest subprocess by the execution service). The static
    validation gate checks generated code; this closes the runtime hole —
    redirects, scripts or dynamically built URLs can no longer reach
    non-allow-listed hosts.
    """
    if "context" not in request.fixturenames:
        return  # not a browser test: nothing to guard
    context = request.getfixturevalue("context")
    domains = _allowed_domains(os.environ.get("QA_ALLOWED_DOMAINS"))

    def _enforce(route, intercepted_request) -> None:
        if _host_allowed(intercepted_request.url, domains):
            route.continue_()
        else:
            route.abort("blockedbyclient")

    context.route("**/*", _enforce)


class Credentials(NamedTuple):
    """Test account credentials, sourced from the environment (FR-AUT-005)."""

    username: str
    password: str


@pytest.fixture(scope="session")
def base_url(request: pytest.FixtureRequest) -> str:
    """Target app base URL: ``--base-url`` CLI option, else QA_TARGET_BASE_URL.

    Overrides the pytest-base-url fixture consumed by pytest-playwright, so the
    browser context's ``base_url`` matches the framework's (FR-AUT-005).
    """
    try:
        cli_option = request.config.getoption("base_url")
    except ValueError:  # option not registered (plugin disabled)
        cli_option = None
    return (cli_option or os.environ.get("QA_TARGET_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


@pytest.fixture(scope="session")
def credentials() -> Credentials:
    """Demo account credentials from env; defaults match the sample app.

    These defaults exist ONLY here — test code must always consume this
    fixture rather than embedding literals (FR-AUT-005, SEC-002).
    """
    return Credentials(
        username=os.environ.get("QA_TEST_USERNAME", "demo@example.com"),
        password=os.environ.get("QA_TEST_PASSWORD", "change-me"),
    )


@pytest.fixture(scope="session")
def target_available(base_url: str) -> None:
    """Skip tests when the target app is unreachable (keeps suites green).

    Session-scoped: the probe runs once and pytest re-applies the cached skip
    to every test that requests this fixture.
    """
    try:
        # 10s (not 2s) + redirects + a browser-like UA so a slow or
        # CDN/Cloudflare-fronted external target isn't spuriously treated as
        # down and skipped.
        httpx.get(
            base_url,
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (qa-agent target probe)"},
        )
    except httpx.HTTPError:
        pytest.skip("target app not running")
