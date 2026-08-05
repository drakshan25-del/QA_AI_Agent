"""End-to-end engine tests for the UI Scanner against a deterministic fixture.

Nothing here touches a real website: a local HTTP server serves
``tests/fixtures/ui_scanner``, which contains exactly the shapes the scanner
has to get right — a login form, duplicate buttons in differently named
regions, a dialog, hidden elements, framework-generated ids and an iframe.

The suite is marked ``integration`` because it launches a real Chromium.
"""

from __future__ import annotations

import functools
import http.server
import socketserver
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from engine.uiscanner.scanner import run_scan
from engine.uiscanner.types import UI_SCAN_STAGES, ScanOptions

pytestmark = pytest.mark.integration

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "ui_scanner"


class _QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@pytest.fixture(scope="module")
def fixture_server() -> Iterator[str]:
    """Serve the fixture directory on an ephemeral loopback port."""
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(FIXTURE_DIR)
    )
    server = _QuietServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def chromium_available() -> bool:
    """Skip the suite when no browser binary is installed on this host."""
    box: dict = {}

    def probe() -> None:
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                browser.close()
            box["ok"] = True
        except Exception as exc:  # noqa: BLE001 - a missing browser is a skip
            box["error"] = str(exc)

    worker = threading.Thread(target=probe, name="ui-scan-probe")
    worker.start()
    worker.join()
    if not box.get("ok"):
        pytest.skip(
            f"Chromium is not available for the UI scanner tests: {box.get('error')}"
        )
    return True


def _run_scan_in_worker(options: ScanOptions, **kwargs) -> dict:
    """Run a scan on a worker thread, exactly as the engine does in production.

    Playwright's sync API refuses to run in a thread that has an asyncio loop
    installed, and merely importing the e2e suite installs one in the main
    thread. `engine/service/ui_scan.py` always dispatches to a worker thread,
    so running the same way here keeps the suite order-independent *and* closer
    to how the scanner actually runs.
    """
    box: dict = {}

    def target() -> None:
        try:
            box["result"] = run_scan(options, **kwargs)
        except BaseException as exc:  # noqa: BLE001 - re-raised on the caller
            box["error"] = exc

    worker = threading.Thread(target=target, name="ui-scan-test")
    worker.start()
    worker.join()
    if "error" in box:
        raise box["error"]
    return box["result"]


def _scan(url: str, **overrides) -> dict:
    options = ScanOptions(
        url=url,
        headless=True,
        # The fixture is served from loopback, which the SSRF guard blocks by
        # default — exactly the switch a local development stack flips.
        allow_private_network=True,
        use_llm_fallback=False,
        **overrides,
    )
    return _run_scan_in_worker(options, emit=lambda *_: None)


@pytest.fixture(scope="module")
def scan_result(fixture_server: str, chromium_available: bool) -> dict:
    assert chromium_available
    return _scan(f"{fixture_server}/index.html")


def _by_key(result: dict, needle: str) -> list[dict]:
    return [e for e in result["elements"] if needle in e["elementKey"]]


def _recommended(element: dict) -> dict | None:
    return next(
        (c for c in element["candidates"] if c["id"] == element["recommendedLocatorId"]),
        None,
    )


# --- a simple page ---------------------------------------------------------


def test_scan_completes_and_finds_the_login_form(scan_result: dict) -> None:
    assert scan_result["status"] == "COMPLETED"
    assert scan_result["totalElements"] if "totalElements" in scan_result else True
    assert len(scan_result["elements"]) > 10

    email = _by_key(scan_result, "input:textbox:email-address")
    assert email, "the email field should be discovered"
    best = _recommended(email[0])
    assert best is not None
    assert best["unique"] is True
    assert best["strategy"] in {"role", "label"}


def test_every_element_has_a_page_url_and_a_stable_key(scan_result: dict) -> None:
    for element in scan_result["elements"]:
        assert element["elementKey"]
        assert element["pageUrl"].startswith("http://127.0.0.1")


def test_recommended_locators_are_predominantly_semantic(scan_result: dict) -> None:
    metrics = scan_result["metrics"]
    assert metrics["uniqueLocatorRate"] > 0.8
    assert metrics["semanticLocatorRate"] > 0.5
    # XPath is the documented last resort: allowed, but it must stay marginal.
    assert metrics["xpathFallbackRate"] <= 0.05


# --- duplicates ------------------------------------------------------------


def test_duplicate_buttons_are_disambiguated_by_their_region(scan_result: dict) -> None:
    saves = _by_key(scan_result, "button:button:save")
    assert len(saves) >= 3, "Profile, Billing and the dialog each have a Save button"

    expressions = set()
    for element in saves:
        best = _recommended(element)
        assert best is not None, "every duplicate should still resolve"
        assert best["unique"] is True
        assert best["strategy"] == "scopedRole"
        expressions.add(best["expression"])
    # Three different scopes must produce three different locators.
    assert len(expressions) == len(saves)
    assert any("Profile" in e for e in expressions)
    assert any("Billing" in e for e in expressions)
    assert any("Edit user" in e for e in expressions)


def test_scoped_locators_never_fall_back_to_index_selection(scan_result: dict) -> None:
    for element in scan_result["elements"]:
        best = _recommended(element)
        if best is None:
            continue
        assert "nth=" not in best["expression"]
        assert ":nth-child" not in best["expression"]


# --- dialogs, frames, hidden elements --------------------------------------


def test_dialog_is_discovered_with_its_accessible_name(scan_result: dict) -> None:
    dialogs = _by_key(scan_result, "dialog:edit-user")
    assert dialogs
    best = _recommended(dialogs[0])
    assert best is not None
    assert best["expression"] == (
        "page.getByRole('dialog', { name: 'Edit user', exact: true })"
    )


def test_iframe_contents_are_scanned_with_frame_aware_locators(scan_result: dict) -> None:
    assert len(scan_result["frames"]) == 2
    pay = _by_key(scan_result, "f1:button:button:pay-now")
    assert pay, "the button inside the payment iframe should be discovered"
    best = _recommended(pay[0])
    assert best is not None
    assert best["expression"].startswith(
        "page.frameLocator('iframe[title=\"Payment\"]')"
    )
    assert best["locatorData"]["frame"]["path"] == ['iframe[title="Payment"]']
    assert best["unique"] is True


def test_decorative_elements_are_not_offered_as_testable(scan_result: dict) -> None:
    """role="presentation"/"none" means "ignore me" — honour it (§6).

    Such nodes have no name, text or attribute to key on, so collecting them
    only manufactures elements no locator can ever address and drags the
    unresolved rate down with noise.
    """
    assert not [e for e in scan_result["elements"] if e["tagName"] == "svg"]
    assert not [
        e
        for e in scan_result["elements"]
        if e["explicitRole"] in {"presentation", "none", "separator"}
    ]
    assert not [e for e in scan_result["elements"] if e["tagName"] == "hr"]


def test_late_rendered_content_is_waited_for(scan_result: dict) -> None:
    """A single-page application mounts after the network goes quiet.

    Scanning at `networkidle` finds an empty page and reports a perfectly
    successful scan of nothing, so the scanner waits on the real condition:
    elements exist and their count has stopped changing.
    """
    late = _by_key(scan_result, "mark-all-read")
    assert late, "content mounted after load should still be scanned"
    best = _recommended(late[0])
    assert best is not None and best["unique"] is True


def test_hidden_elements_are_skipped_by_default(scan_result: dict) -> None:
    assert not _by_key(scan_result, "archive-account")


def test_hidden_elements_are_included_on_request(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", include_hidden=True)
    hidden = _by_key(result, "archive-account")
    assert hidden, "the hidden button should appear when hidden elements are included"
    assert hidden[0]["states"]["visible"] is False


# --- credentials, artefacts and limits -------------------------------------


def test_password_values_are_never_captured(scan_result: dict) -> None:
    password_fields = [
        e
        for e in scan_result["elements"]
        if e.get("inputType") == "password" or e.get("sensitive")
    ]
    assert password_fields, "the fixture has a password field"
    for element in password_fields:
        assert element["value"] == ""
        # The metadata a locator needs is still there.
        assert element["context"]["associatedLabel"] or element["accessibleName"]


def test_password_field_still_gets_a_usable_locator(scan_result: dict) -> None:
    fields = [e for e in scan_result["elements"] if e.get("inputType") == "password"]
    best = _recommended(fields[0])
    assert best is not None
    assert best["unique"] is True
    assert "Password" in best["expression"]


def test_artefacts_are_captured(scan_result: dict) -> None:
    assert scan_result["screenshotBase64"]
    assert "button" in scan_result["accessibilitySnapshot"].lower()


def test_element_limit_is_enforced(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_elements=5)
    assert len(result["elements"]) <= 5


def test_cancellation_stops_the_scan_and_reports_it(fixture_server: str) -> None:
    options = ScanOptions(
        url=f"{fixture_server}/index.html",
        headless=True,
        allow_private_network=True,
        use_llm_fallback=False,
    )
    # Cancel immediately: the scan must stop at its first checkpoint and still
    # close its browser cleanly.
    result = _run_scan_in_worker(
        options, emit=lambda *_: None, is_cancelled=lambda: True
    )
    assert result["status"] == "CANCELLED"
    assert result["elements"] == []


def test_blocked_url_fails_with_a_structured_error(chromium_available: bool) -> None:
    assert chromium_available
    options = ScanOptions(url="http://169.254.169.254/latest/meta-data/", headless=True)
    result = _run_scan_in_worker(options, emit=lambda *_: None)
    assert result["status"] == "FAILED"
    assert result["error"]["code"] == "UI_SCAN_URL_BLOCKED"
    assert result["error"]["recoverable"] is False


def _stages_of(url: str, **overrides) -> list[str]:
    stages: list[str] = []
    options = ScanOptions(
        url=url, headless=True, allow_private_network=True, use_llm_fallback=False, **overrides
    )
    _run_scan_in_worker(
        options,
        emit=lambda event_type, payload: (
            stages.append(payload["stage"]) if event_type == "ui_scan.status" else None
        ),
    )
    return stages


def test_stage_events_follow_the_declared_lifecycle(fixture_server: str) -> None:
    stages = _stages_of(
        f"{fixture_server}/index.html",
        capture_screenshot=False,
        capture_accessibility=False,
    )
    assert stages[0] == "STARTING_BROWSER"
    assert "NAVIGATING" in stages
    assert "SCANNING_DOM" in stages
    assert "VALIDATING_LOCATORS" in stages
    assert stages[-1] == "COMPLETED"
    # Disabled steps must not be announced.
    assert "CAPTURING_SCREENSHOT" not in stages
    assert "CAPTURING_ACCESSIBILITY" not in stages


def _backwards_transitions(stages: list[str]) -> list[tuple[str, str]]:
    """Stage pairs that move backwards, ignoring the AUTHENTICATING exception.

    Signing in is not a point in the sequence: it happens after the requested
    page has been scanned, and can recur mid-crawl. Every other stage is
    strictly forward-only, and the backend drops anything that is not.
    """
    order = {stage: index for index, stage in enumerate(UI_SCAN_STAGES)}
    return [
        (before, after)
        for before, after in zip(stages, stages[1:])
        if order[after] < order[before] and after != "AUTHENTICATING"
    ]


def test_stages_only_ever_move_forwards(fixture_server: str) -> None:
    stages = _stages_of(f"{fixture_server}/index.html")
    assert not _backwards_transitions(stages)


def test_logs_never_contain_credentials(fixture_server: str) -> None:
    messages: list[str] = []
    options = ScanOptions(
        url=f"{fixture_server}/index.html",
        headless=True,
        allow_private_network=True,
        use_llm_fallback=False,
        username="qa@example.com",
        password="sup3r-s3cret-value",
        capture_screenshot=False,
    )
    _run_scan_in_worker(
        options,
        emit=lambda event_type, payload: (
            messages.append(payload.get("message", ""))
            if event_type == "ui_scan.log"
            else None
        ),
    )
    joined = "\n".join(messages)
    assert "sup3r-s3cret-value" not in joined


# --- authenticating against a single-page application ----------------------


def test_signs_in_to_a_late_rendering_login_form(fixture_server: str) -> None:
    """The login form mounts after load; the scanner must wait for it.

    Looking for the form once, immediately after `domcontentloaded`, is what
    produced "No login form was found on the page" against every SPA.
    """
    result = _scan(
        f"{fixture_server}/spa-login.html",
        username="qa",
        password="correct-horse",
    )
    assert result["status"] == "COMPLETED"
    assert _by_key(result, "sign-out"), "the post-sign-in page should be scanned"


def test_the_target_page_is_scanned_before_signing_in(fixture_server: str) -> None:
    """A scan aimed at a login page must return that page's own controls.

    They are precisely the locators a login test case is built from, and
    signing in first threw them away.
    """
    result = _scan(
        f"{fixture_server}/spa-login.html",
        username="qa",
        password="correct-horse",
    )
    keys = {e["elementKey"] for e in result["elements"]}
    assert any("username" in key for key in keys), keys
    assert any("password" in key for key in keys), keys
    assert any("login" in key for key in keys), keys


def test_login_page_controls_get_usable_locators(fixture_server: str) -> None:
    result = _scan(
        f"{fixture_server}/spa-login.html",
        username="qa",
        password="correct-horse",
    )
    for needle in ("username", "password", "login"):
        matches = [e for e in result["elements"] if needle in e["elementKey"]]
        assert matches, needle
        best = _recommended(matches[0])
        assert best is not None and best["unique"] is True, needle


def test_signing_in_adds_a_page_rather_than_replacing_the_target(
    fixture_server: str,
) -> None:
    """The default budget of one page still covers both sides of a sign-in."""
    result = _scan(
        f"{fixture_server}/spa-login.html",
        username="qa",
        password="correct-horse",
    )
    assert result["metrics"]["pagesScanned"] == 2


def test_wrong_credentials_report_the_application_s_own_message(
    fixture_server: str,
) -> None:
    result = _scan(
        f"{fixture_server}/spa-login.html", username="qa", password="wrong"
    )
    assert result["status"] == "FAILED"
    assert result["error"]["code"] == "UI_SCAN_AUTH_FAILED"
    assert result["error"]["stage"] == "AUTHENTICATING"
    # The application said why; quoting it beats a generic failure.
    assert "Invalid credentials" in result["error"]["message"]


def test_a_page_with_no_login_form_fails_with_actionable_guidance(
    fixture_server: str,
) -> None:
    result = _scan(
        f"{fixture_server}/frame.html", username="qa", password="correct-horse"
    )
    assert result["status"] == "FAILED"
    assert result["error"]["code"] == "UI_SCAN_AUTH_NO_FORM"
    assert "login URL" in result["error"]["message"]


def test_credentials_never_appear_in_a_failed_sign_in(fixture_server: str) -> None:
    messages: list[str] = []
    options = ScanOptions(
        url=f"{fixture_server}/spa-login.html",
        headless=True,
        allow_private_network=True,
        use_llm_fallback=False,
        username="qa",
        password="wrong-but-secret",
    )
    result = _run_scan_in_worker(
        options,
        emit=lambda event_type, payload: (
            messages.append(payload.get("message", ""))
            if event_type == "ui_scan.log"
            else None
        ),
    )
    assert "wrong-but-secret" not in "\n".join(messages)
    assert "wrong-but-secret" not in result["error"]["message"]


# --- crawling an application (§15) -----------------------------------------


def test_single_page_is_the_default(scan_result: dict) -> None:
    """Crawling is opt-in: one page unless the user asks for more."""
    assert scan_result["metrics"]["pagesScanned"] == 1
    pages = {e["pageUrl"] for e in scan_result["elements"]}
    assert len(pages) == 1


def test_crawl_follows_in_app_links(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_pages=3)
    assert result["status"] == "COMPLETED"
    assert result["metrics"]["pagesScanned"] == 3

    paths = {e["pageUrl"].rsplit("/", 1)[-1] for e in result["elements"]}
    assert "index.html" in paths
    assert "reports.html" in paths
    assert "settings.html" in paths

    # Controls that only exist on the crawled pages must be found and resolved.
    run_report = _by_key(result, "run-report")
    assert run_report, "a button on the second page should be discovered"
    best = _recommended(run_report[0])
    assert best is not None and best["unique"] is True


def test_crawl_never_signs_itself_out(fixture_server: str) -> None:
    """Following a logout link would turn the rest of the crawl into the login
    page — the single most damaging thing an authenticated crawl can do."""
    result = _scan(f"{fixture_server}/index.html", max_pages=6)
    assert not [e for e in result["elements"] if "logout" in e["pageUrl"]]


def test_crawl_never_follows_a_destructive_link(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_pages=6)
    assert not [e for e in result["elements"] if "action=delete" in e["pageUrl"]]


def test_crawl_stays_inside_the_application(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_pages=6)
    for element in result["elements"]:
        assert element["pageUrl"].startswith("http://127.0.0.1")


def test_crawl_honours_the_page_limit(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_pages=2)
    assert result["metrics"]["pagesScanned"] == 2


def test_crawled_locators_are_validated_against_their_own_page(
    fixture_server: str,
) -> None:
    """Every recommended locator must have been proved on the page it came
    from — validating page two against page one would reject all of it."""
    result = _scan(f"{fixture_server}/index.html", max_pages=3)
    for element in result["elements"]:
        best = _recommended(element)
        if best is None:
            continue
        assert best["matchCount"] >= 1, (
            f"{element['elementKey']} on {element['pageUrl']} was validated "
            "against the wrong page"
        )


def test_element_keys_stay_stable_per_page(fixture_server: str) -> None:
    """The same control on two pages keeps the same key.

    The duplicate counter resets per page, so a key never depends on how many
    pages happened to be crawled before it — which is what lets an approved
    locator still match after the next scan.
    """
    result = _scan(f"{fixture_server}/index.html", max_pages=3)
    by_page: dict[str, set[str]] = {}
    for element in result["elements"]:
        by_page.setdefault(element["pageUrl"], set()).add(element["elementKey"])
    # "Primary" navigation exists on every page and must key identically.
    nav_keys = [
        key for keys in by_page.values() for key in keys if key.endswith("primary")
    ]
    assert len(nav_keys) >= 2
    assert len(set(nav_keys)) == 1


def test_crawl_stages_still_only_move_forwards(fixture_server: str) -> None:
    stages = _stages_of(f"{fixture_server}/index.html", max_pages=3)
    assert not _backwards_transitions(stages)
    assert stages[-1] == "COMPLETED"


def test_artefacts_describe_the_entry_page_after_a_crawl(fixture_server: str) -> None:
    result = _scan(f"{fixture_server}/index.html", max_pages=3)
    assert result["finalUrl"].endswith("index.html")
    assert result["screenshotBase64"]


# --- naming and scoping inside tables ---------------------------------------


def test_accessible_names_are_word_separated_not_glued(scan_result: dict) -> None:
    """A container's name is built from its children as separate words.

    `textContent` glues them together ("Alice BakerEngineerEdit"), which is not
    what Playwright computes — and a name Playwright disagrees with produces a
    locator that matches nothing. A plain `<tr>` is not itself a scan target,
    so the property is observed on the containers reported for a row's button.
    """
    edits = [
        e
        for e in scan_result["elements"]
        if e["accessibleName"] == "Edit" and e["tagName"] == "button"
    ]
    assert edits, "the fixture table should contribute row actions"
    row_scopes = [
        scope
        for element in edits
        for scope in element["context"]["scopes"]
        if scope["role"] == "row"
    ]
    assert row_scopes, "a row action should report its row as a container"
    for scope in row_scopes:
        # Cell values must be separate words, never run together.
        for glued in ("BakerEngineer", "DiazDesigner", "EditView"):
            assert glued not in scope["name"], scope["name"]
    joined = " | ".join(scope["name"] for scope in row_scopes)
    assert "Alice Baker Engineer" in joined or "Carl Diaz Designer" in joined, joined


def test_repeated_row_actions_resolve_via_their_own_row(scan_result: dict) -> None:
    """Two rows, identical buttons: only row scoping can separate them."""
    edits = [
        e
        for e in scan_result["elements"]
        if e["accessibleName"] == "Edit" and e["tagName"] == "button"
    ]
    assert len(edits) == 2, "the fixture has an Edit button in each row"
    expressions = set()
    for element in edits:
        best = _recommended(element)
        assert best is not None, "a row action should still resolve"
        assert best["unique"] is True
        expressions.add(best["expression"])
    assert len(expressions) == 2, "each row's Edit button needs its own locator"
    # The disambiguator should be the row, not a page-wide container.
    assert any("row" in e for e in expressions), expressions


def test_scoping_prefers_the_nearest_named_container(scan_result: dict) -> None:
    """A button in a row inside a region scopes to the row.

    Scoping to the outer region leaves every row matching, which is the
    difference between a usable locator and a "matched 40 elements" warning.
    """
    edits = [
        e
        for e in scan_result["elements"]
        if e["accessibleName"] == "Edit" and e["tagName"] == "button"
    ]
    scopes = edits[0]["context"]["scopes"]
    assert scopes, "the button should report its containers"
    # Nearest first: the row must come before the table.
    roles = [s["role"] for s in scopes]
    assert roles.index("row") < roles.index("table")
