"""Scan → locator → generated automation, against a real browser (FR-UIS-025).

This is the join between the two halves of the feature. The scanner runs for
real against the fixture application; the locators it produces are then fed
through the automation-generation contract exactly as the backend feeds them,
with a scripted model standing in for Ollama so the assertions are about the
*binding*, not about a language model's mood.

What it proves:

* the locator that reaches generated code is the one the scan validated;
* that locator, rebuilt from its machine-readable form, still resolves to the
  one intended element on the live page;
* duplicate element names are separated by their containing section rather than
  by position;
* a step with no scanned element yields a review marker, never a selector.

Marked ``integration`` because it launches a real Chromium.
"""

from __future__ import annotations

import functools
import http.server
import socketserver
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from agents import automation_agent
from app.models.schemas import AutomationOutput, GeneratedFile
from engine.uiscanner.locator_code import build_python_expression, find_invented_locators
from engine.uiscanner.locator_validator import build_locator
from engine.uiscanner.scanner import run_scan
from engine.uiscanner.types import ScanOptions

pytestmark = pytest.mark.integration

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "ui_scanner"


class _QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@pytest.fixture(scope="module")
def fixture_server() -> Iterator[str]:
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

    worker = threading.Thread(target=probe, name="locator-binding-probe")
    worker.start()
    worker.join()
    if not box.get("ok"):
        pytest.skip(f"Chromium is not available: {box.get('error')}")
    return True


def _in_worker(fn):
    """Run a Playwright call on a worker thread, as the engine does."""
    box: dict = {}

    def target() -> None:
        try:
            box["result"] = fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised on the caller
            box["error"] = exc

    worker = threading.Thread(target=target, name="locator-binding-worker")
    worker.start()
    worker.join()
    if "error" in box:
        raise box["error"]
    return box["result"]


@pytest.fixture(scope="module")
def scan_result(fixture_server: str, chromium_available: bool) -> dict:
    assert chromium_available
    options = ScanOptions(
        url=f"{fixture_server}/index.html",
        headless=True,
        allow_private_network=True,
        use_llm_fallback=False,
    )
    return _in_worker(lambda: run_scan(options, emit=lambda *_: None))


def _element(result: dict, needle: str) -> dict:
    matches = [e for e in result["elements"] if needle in e["elementKey"]]
    assert matches, f"no scanned element matching {needle!r}"
    return matches[0]


def _recommended(element: dict) -> dict:
    best = next(
        (c for c in element["candidates"] if c["id"] == element["recommendedLocatorId"]),
        None,
    )
    assert best is not None, f"{element['elementKey']} has no recommended locator"
    return best


def _resolved_step(element: dict, *, step_id: str, description: str, action: str) -> dict:
    """The resolution contract the backend hands the agent (§8)."""
    candidate = _recommended(element)
    return {
        "test_step_id": step_id,
        "test_case_id": "tc-1",
        "sequence": int(step_id.rsplit("-", 1)[-1]),
        "action": action,
        "description": description,
        "value_reference": "credentials.username" if action == "fill" else "",
        "element_name": element.get("accessibleName") or element["elementKey"],
        "page_name": "Account",
        "page_url_pattern": element["pageUrl"],
        "locator": {
            "locator_id": f"locator-{element['elementKey']}",
            "locator_version": 1,
            "strategy": candidate["strategy"],
            "locator_data": candidate["locatorData"],
            "python_expression": candidate["pythonExpression"],
            "confidence": candidate["confidence"],
            "validation_status": "unique" if candidate["unique"] else "valid",
        },
    }


class _ScriptedModel:
    """Returns generated files built from whatever locators it was given."""

    def __init__(self, build) -> None:
        self._build = build
        self.prompts: list[str] = []

    def with_structured_output(self, _schema):
        return self

    def invoke(self, messages):
        self.prompts.append(messages[-1].content)
        return self._build(messages[-1].content)


@pytest.fixture
def scripted(monkeypatch):
    def install(build) -> _ScriptedModel:
        model = _ScriptedModel(build)
        monkeypatch.setattr(automation_agent, "require_ollama", lambda: None)
        monkeypatch.setattr(automation_agent, "get_chat_model", lambda *a, **k: model)
        monkeypatch.setattr(
            automation_agent,
            "generation_metadata",
            lambda *a, **k: {"model": "scripted", "temperature": 0.0},
        )
        return model

    return install


def _file(content: str) -> AutomationOutput:
    return AutomationOutput(
        files=[
            GeneratedFile(
                path="automation/generated_tests/test_login.py",
                kind="test_file",
                content=content,
                test_case_ids=["tc-1"],
            )
        ]
    )


# ---------------------------------------------------------------------------


def test_generated_automation_uses_the_scanned_locator_verbatim(scan_result, scripted):
    email = _element(scan_result, "input:textbox:email-address")
    login = _element(scan_result, "button:button:login")
    steps = [
        _resolved_step(email, step_id="tc-1:step-1", description="Enter the email address", action="fill"),
        _resolved_step(login, step_id="tc-1:step-2", description="Click Login", action="click"),
    ]
    expressions = [s["locator"]["python_expression"] for s in steps]

    scripted(
        lambda _prompt: _file(
            "import pytest\n"
            "from playwright.sync_api import Page, expect\n\n"
            "pytestmark = [pytest.mark.generated]\n\n\n"
            "# TC: TC-001 Login\n"
            "# REQ: REQ-1\n"
            "def test_login(page: Page, base_url: str, credentials, target_available) -> None:\n"
            "    page.goto(base_url)\n"
            f"    # UI Scanner Locator: {steps[0]['locator']['locator_id']}-v1\n"
            f"    {expressions[0]}.fill(credentials.username)\n"
            f"    # UI Scanner Locator: {steps[1]['locator']['locator_id']}-v1\n"
            f"    {expressions[1]}.click()\n"
        )
    )

    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Enter the email address", "Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=steps,
    )

    content = result.files[0].content
    for expression in expressions:
        assert expression in content, f"{expression} should appear verbatim"
    # And nothing else that looks like a locator.
    assert find_invented_locators(content, expressions) == []
    # The traceability comment carries the id and version (§14).
    assert "# UI Scanner Locator:" in content


def test_the_generated_locator_still_resolves_one_element_on_the_live_page(
    scan_result, fixture_server, chromium_available
):
    """The point of the whole exercise: the code addresses the real control."""
    assert chromium_available
    login = _element(scan_result, "button:button:login")
    data = _recommended(login)["locatorData"]
    # Rebuilt from the machine-readable form — the expression string is never
    # executed anywhere in this system (SEC-005).
    expression = build_python_expression(data)
    assert "get_by_role" in expression or "get_by_test_id" in expression

    def probe() -> int:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(f"{fixture_server}/index.html", wait_until="domcontentloaded")
                return build_locator(page, data).count()
            finally:
                browser.close()

    assert _in_worker(probe) == 1


def test_duplicate_names_are_separated_by_their_section_not_by_position(scan_result):
    """Two Save buttons, two different scoped locators — never `.nth()` (§3)."""
    saves = [
        e
        for e in scan_result["elements"]
        if e.get("accessibleName") == "Save" and e.get("inferredRole") == "button"
    ]
    assert len(saves) >= 2, "the fixture has Save in Profile, Billing and the dialog"

    expressions = {build_python_expression(_recommended(e)["locatorData"]) for e in saves}
    assert len(expressions) == len(saves), "each Save must get its own locator"
    for expression in expressions:
        assert ".nth(" not in expression
    # At least one is scoped to its containing region, which is what makes it
    # unique without counting siblings.
    assert any("get_by_role" in e and e.count("get_by_role") > 1 for e in expressions)


def test_a_step_with_no_scanned_element_produces_a_review_marker_not_a_selector(
    scan_result, scripted
):
    login = _element(scan_result, "button:button:login")
    steps = [_resolved_step(login, step_id="tc-1:step-1", description="Click Login", action="click")]
    expression = steps[0]["locator"]["python_expression"]

    scripted(
        lambda _prompt: _file(
            "import pytest\n"
            "from playwright.sync_api import Page, expect\n\n"
            "pytestmark = [pytest.mark.generated]\n\n\n"
            "def test_login(page: Page, base_url: str, credentials, target_available) -> None:\n"
            "    page.goto(base_url)\n"
            f"    {expression}.click()\n"
            "    # LOCATOR_REVIEW_REQUIRED:\n"
            "    # No validated UI Scanner locator was found for:\n"
            '    # "Click Confirm Membership"\n'
        )
    )

    result = automation_agent.generate_automation(
        [
            {
                "id": "tc-1",
                "case_key": "TC-001",
                "title": "Membership",
                "steps": ["Click Login", "Click Confirm Membership"],
            }
        ],
        "http://localhost:8001",
        "",
        resolved_steps=steps,
        unresolved_steps=[
            {
                "test_step_id": "tc-1:step-2",
                "test_step": "Click Confirm Membership",
                "reason": "No validated scanned locator matches this test step.",
                "suggested_action": "Run a targeted UI scan for the Membership page.",
            }
        ],
    )

    content = result.files[0].content
    assert "LOCATOR_REVIEW_REQUIRED" in content
    assert "Click Confirm Membership" in content
    # The unresolved step contributed no locator of any kind.
    assert find_invented_locators(content, [expression]) == []
    assert "1 step(s) left for locator review" in result.notes


def test_frame_locators_keep_their_frame_when_generated(scan_result):
    """An element inside an iframe must stay addressed through that iframe."""
    framed = [
        e
        for e in scan_result["elements"]
        if (e.get("frame") or {}).get("path")
    ]
    if not framed:
        pytest.skip("the fixture scan produced no in-frame elements")
    expression = build_python_expression(_recommended(framed[0])["locatorData"])
    assert expression.startswith("page.frame_locator(")


def test_revalidating_against_an_unreachable_page_returns_a_structured_error(
    chromium_available,
):
    """§18: a page that cannot be opened is an outcome, not a crash."""
    assert chromium_available
    from engine.uiscanner.revalidate import revalidate_locators
    from engine.uiscanner.types import ScanOptions, UiScanError

    options = ScanOptions(
        # Port 1 on loopback: nothing is listening, and nothing ever will be.
        url="http://127.0.0.1:1/index.html",
        headless=True,
        allow_private_network=True,
        timeout_ms=5_000,
    )
    locators = [{"id": "locator-1", "locatorData": {"strategy": "role", "role": "button"}}]

    with pytest.raises(UiScanError) as excinfo:
        _in_worker(lambda: revalidate_locators(options, locators))

    error = excinfo.value.to_dict()
    assert error["code"] == "UI_SCAN_NAVIGATION_FAILED"
    assert "could not be opened" in error["message"]
    assert error["recoverable"] is True
