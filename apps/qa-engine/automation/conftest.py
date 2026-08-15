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
* ``api_base_url`` — root the API under test is served at:
  ``QA_TARGET_API_BASE_URL`` when the project configures a dedicated API base
  URL (different port or an ``/api/v1``-style prefix), else ``base_url``.
* ``api_client`` — an ``httpx.Client`` preconfigured with ``api_base_url`` for
  generated API tests (no browser). Every outbound request — including
  redirect hops — is checked against ``QA_ALLOWED_DOMAINS`` and refused when
  the host is not allow-listed, mirroring the browser-route guard so
  non-browser tests get the same SEC-003 enforcement. Every request/response
  is recorded; when a test fails, the crash message is enriched with the last
  exchange (method, full URL, actual status, response body) so a bare
  ``assert 404 == 200`` becomes diagnosable from the live log and the report.
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
from typing import Iterator, NamedTuple
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
def api_base_url(base_url: str) -> str:
    """Root the API under test is served at (FR-AUT-005).

    ``QA_TARGET_API_BASE_URL`` carries the project's configured API base URL
    (injected by the execution service); it falls back to ``base_url`` when
    the API is served from the same origin as the UI. Keeping the two apart
    is what stops generated API tests from firing at the frontend URL and
    collecting 404s.
    """
    return (os.environ.get("QA_TARGET_API_BASE_URL") or base_url).rstrip("/")


def _api_request_guard(domains: list[str]):
    """Build an httpx request hook enforcing the domain allow-list (SEC-003).

    Pure factory so the guard is unit-testable; the returned hook refuses any
    request whose host is not allow-listed, before it leaves the process.
    """

    def _enforce(request: httpx.Request) -> None:
        if not _host_allowed(str(request.url), domains):
            raise RuntimeError(
                f"request to non-allow-listed host '{request.url.host}' refused "
                "(QA_ALLOWED_DOMAINS, SEC-003)"
            )

    return _enforce


#: Response-body excerpt kept per exchange for failure diagnostics. Bounded so
#: a large payload never bloats reports; secrets are redacted downstream
#: (results parser + backend log redaction, SEC-007).
_API_BODY_SNIPPET_CHARS = 300


def _format_exchange(exchange: dict) -> str:
    """One-line ``METHOD url -> status; body: ...`` rendering of an exchange."""
    line = f"{exchange['method']} {exchange['url']} -> {exchange['status']}"
    body = " ".join(str(exchange.get("body") or "").split())
    if body:
        line += f"; body: {body[:200]}"
    return line


def _emit_api_step(config: pytest.Config, node_id: str, exchange: dict) -> None:
    """Stream one API exchange as a live 'api' step event (FR-EXE-006).

    Uses the engine's ``step_events`` plugin when it is loaded (engine-managed
    runs pass ``-p engine.service.step_events``); a standalone pytest run has
    no plugin and this is a no-op, keeping the automation tree dependency-light.
    """
    plugin = config.pluginmanager.get_plugin("engine.service.step_events")
    emit = getattr(plugin, "emit_step", None)
    if emit is None:
        return
    emit(
        "api",
        target=f"{exchange['method']} {exchange['url']}",
        value=f"HTTP {exchange['status']} {exchange.get('reason', '')}".strip(),
        status="passed" if int(exchange["status"]) < 400 else "warning",
        test_name=node_id,
    )


@pytest.fixture()
def api_client(
    api_base_url: str, request: pytest.FixtureRequest
) -> Iterator[httpx.Client]:
    """Allow-list-guarded HTTP client for generated API tests (SEC-003).

    The browser guard above cannot cover non-browser tests, so this client
    applies the same ``QA_ALLOWED_DOMAINS`` policy at the httpx layer: a
    request hook refuses any request — first or redirect hop — whose host is
    not allow-listed. Fails closed, like the browser route guard.

    Every response is additionally recorded on the test item (and streamed as
    a live ``api`` step event) so a failing test can report the method, full
    URL, actual status and response body instead of a bare status assertion.
    """
    domains = _allowed_domains(os.environ.get("QA_ALLOWED_DOMAINS"))
    exchanges: list[dict] = []
    request.node._qa_api_exchanges = exchanges  # read by pytest_runtest_makereport

    def _record(response: httpx.Response) -> None:
        try:
            response.read()
            body = response.text[:_API_BODY_SNIPPET_CHARS]
        except Exception:  # noqa: BLE001 - diagnostics must never fail a request
            body = ""
        exchange = {
            "method": response.request.method,
            "url": str(response.request.url),
            "status": response.status_code,
            "reason": response.reason_phrase,
            "body": body,
        }
        exchanges.append(exchange)
        _emit_api_step(request.config, request.node.nodeid, exchange)

    client = httpx.Client(
        base_url=api_base_url,
        timeout=10.0,
        follow_redirects=False,
        event_hooks={
            "request": [_api_request_guard(domains)],
            "response": [_record],
        },
    )
    try:
        yield client
    finally:
        client.close()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Enrich failing API tests with their recorded HTTP exchanges.

    ``assert 404 == 200`` explains nothing on its own. The last exchange
    (method, full URL, actual status, response body) is appended to the crash
    message — the single string that travels through the JUnit report, the
    step-events stream and the stored test result — so the live log and the
    execution report show WHY the request failed. The full tail of exchanges
    is attached as a report section for local debugging.
    """
    outcome = yield
    report = outcome.get_result()
    exchanges = getattr(item, "_qa_api_exchanges", None)
    if report.when != "call" or not report.failed or not exchanges:
        return
    report.sections.append(
        ("API exchanges (last 5)", "\n".join(_format_exchange(e) for e in exchanges[-5:]))
    )
    crash = getattr(getattr(report, "longrepr", None), "reprcrash", None)
    if crash is not None and getattr(crash, "message", ""):
        # Keep the appended detail on the FIRST line: junit's failure message
        # and the live log's failure reason both take only that line.
        first, sep, rest = crash.message.partition("\n")
        crash.message = (
            f"{first} | last API call: {_format_exchange(exchanges[-1])}{sep}{rest}"
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
