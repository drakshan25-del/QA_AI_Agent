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
"""

from __future__ import annotations

import os
from typing import NamedTuple

import httpx
import pytest

DEFAULT_BASE_URL = "http://localhost:8001"


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
        httpx.get(base_url, timeout=2.0)
    except httpx.HTTPError:
        pytest.skip("target app not running")
