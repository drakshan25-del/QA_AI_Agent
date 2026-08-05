"""Unit tests for binding automation generation to scanned locators (FR-UIS-025).

These cover the engine side of the integration without a browser and without a
model: how a locator's Playwright code is built from its machine-readable
definition, how invented selectors are detected in generated code, what the
agent is actually told, and what it is allowed to return.

The rule under test throughout is the one the whole feature exists for: the
generator may use locators the UI Scanner validated, and nothing else.
"""

from __future__ import annotations

import ast
import json
import re

import pytest

from agents import automation_agent
from agents.automation_agent import (
    _allowed_expressions,
    _check_no_invented_locators,
    _locator_expression,
    _scanned_locators_payload,
)
from app.models.schemas import AutomationOutput, GeneratedFile
from engine.uiscanner.locator_code import (
    InventedLocatorError,
    assert_only_scanned_locators,
    build_python_expression,
    build_ts_expression,
    extract_locator_chains,
    find_invented_locators,
    validate_locator_data,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Machine-readable locator reconstruction (§6, §7)
# ---------------------------------------------------------------------------


def test_role_locator_renders_the_documented_playwright_call():
    data = {"strategy": "role", "role": "button", "name": "Login", "exact": True}
    assert build_ts_expression(data) == (
        "page.getByRole('button', { name: 'Login', exact: true })"
    )
    assert build_python_expression(data) == (
        'page.get_by_role("button", name="Login", exact=True)'
    )


def test_label_locator_renders_with_exact_matching_preserved():
    data = {"strategy": "label", "value": "Email address", "exact": True}
    assert build_ts_expression(data) == "page.getByLabel('Email address', { exact: true })"
    assert build_python_expression(data) == 'page.get_by_label("Email address", exact=True)'


def test_scoped_locator_keeps_its_parent_scope():
    data = {
        "strategy": "scopedRole",
        "parent": {"strategy": "role", "role": "region", "name": "Profile", "exact": True},
        "child": {"strategy": "role", "role": "button", "name": "Save", "exact": True},
    }
    assert build_ts_expression(data) == (
        "page.getByRole('region', { name: 'Profile', exact: true })"
        ".getByRole('button', { name: 'Save', exact: true })"
    )
    assert build_python_expression(data) == (
        'page.get_by_role("region", name="Profile", exact=True)'
        '.get_by_role("button", name="Save", exact=True)'
    )


def test_frame_locator_keeps_its_frame_chain():
    data = {
        "strategy": "role",
        "role": "button",
        "name": "Pay now",
        "exact": True,
        "frame": {"path": ['iframe[title="Payment"]']},
    }
    assert build_ts_expression(data).startswith(
        "page.frameLocator('iframe[title=\"Payment\"]')"
    )
    assert build_python_expression(data).startswith(
        'page.frame_locator("iframe[title=\\"Payment\\"]")'
    )


@pytest.mark.parametrize(
    "data, reason",
    [
        ({"strategy": "wishful"}, "unsupported"),
        ({"strategy": "role"}, "needs a role"),
        ({"strategy": "label"}, "needs a value"),
        ({"strategy": "css"}, "needs a selector"),
        ({"strategy": "scopedRole", "parent": {"strategy": "role", "role": "x"}}, "parent and a child"),
        (
            {"strategy": "role", "role": "button", "frame": {"path": ["a", "b", "c", "d", "e", "f"]}},
            "five nested frames",
        ),
    ],
)
def test_a_locator_that_cannot_be_rebuilt_is_rejected(data, reason):
    with pytest.raises(ValueError) as excinfo:
        validate_locator_data(data)
    assert reason in str(excinfo.value)


def test_locator_expression_is_rendered_from_the_structure_not_the_stored_string():
    """The structure is the truth: a stale stored string never wins (§6)."""
    step = {
        "locator": {
            "locator_data": {"strategy": "role", "role": "button", "name": "Login", "exact": True},
            "python_expression": 'page.get_by_role("button", name="Stale")',
        }
    }
    assert _locator_expression(step) == 'page.get_by_role("button", name="Login", exact=True)'


def test_locator_expression_falls_back_when_the_structure_is_unusable():
    step = {
        "locator": {
            "locator_data": {"strategy": "nonsense"},
            "python_expression": 'page.get_by_role("button", name="Login")',
        }
    }
    assert _locator_expression(step) == 'page.get_by_role("button", name="Login")'


# ---------------------------------------------------------------------------
# Invention detection (§12)
# ---------------------------------------------------------------------------

ALLOWED = [
    'page.get_by_role("button", name="Login", exact=True)',
    'page.get_by_label("Email address", exact=True)',
    'page.get_by_role("region", name="Profile", exact=True)'
    '.get_by_role("button", name="Save", exact=True)',
]


def test_generated_code_using_only_scanned_locators_passes():
    code = (
        'def test_login(page):\n'
        '    page.get_by_label("Email address", exact=True).fill(credentials.username)\n'
        '    page.get_by_role("button", name="Login", exact=True).click()\n'
    )
    assert find_invented_locators(code, ALLOWED) == []
    assert_only_scanned_locators(code, ALLOWED)


def test_a_css_selector_the_scanner_never_produced_is_caught():
    code = 'page.locator("#login-button").click()'
    assert find_invented_locators(code, ALLOWED) == ['page.locator("#login-button")']


def test_an_xpath_selector_is_caught():
    code = 'page.locator("//button[@id=\'login\']").click()'
    assert find_invented_locators(code, ALLOWED)


def test_a_plausible_but_unscanned_role_locator_is_caught():
    """The failure mode this feature exists to stop: a *good-looking* guess."""
    code = 'page.get_by_role("button", name="Sign in", exact=True).click()'
    assert find_invented_locators(code, ALLOWED)


def test_narrowing_a_scanned_locator_with_nth_is_caught():
    code = 'page.get_by_role("button", name="Login", exact=True).nth(2).click()'
    assert find_invented_locators(code, ALLOWED)


def test_a_scoped_locators_parent_alone_is_allowed_as_a_page_object_field():
    code = 'self.profile = page.get_by_role("region", name="Profile", exact=True)'
    assert find_invented_locators(code, ALLOWED) == []


def test_quote_and_whitespace_differences_do_not_count_as_invention():
    code = "page.get_by_role('button', name='Login', exact=True).click()"
    assert find_invented_locators(code, ALLOWED) == []


def test_an_expect_assertion_around_a_scanned_locator_is_allowed():
    code = 'expect(page.get_by_label("Email address", exact=True)).to_be_visible()'
    assert find_invented_locators(code, ALLOWED) == []


def test_chains_stop_at_the_action_not_at_the_end_of_the_line():
    chains = extract_locator_chains(
        'page.get_by_role("button", name="Login", exact=True).click()'
    )
    assert chains == ['page.get_by_role("button", name="Login", exact=True)']


def test_page_objects_are_checked_as_strictly_as_tests():
    files = [
        GeneratedFile(
            path="automation/pages/login_page.py",
            kind="page_object",
            content='self.login = self.page.locator(".btn-primary")',
        )
    ]
    assert _check_no_invented_locators(files, set(ALLOWED))


def test_invented_locator_error_names_the_offenders():
    with pytest.raises(InventedLocatorError) as excinfo:
        assert_only_scanned_locators('page.locator("#nope")', ALLOWED)
    assert 'page.locator("#nope")' in str(excinfo.value)


# ---------------------------------------------------------------------------
# What the agent is given (§8, §12)
# ---------------------------------------------------------------------------


def resolved_step(**overrides) -> dict:
    step = {
        "test_step_id": "tc-1:step-1",
        "test_case_id": "tc-1",
        "sequence": 1,
        "action": "click",
        "description": "Click Login",
        "value_reference": "",
        "element_name": "Login",
        "page_name": "Login",
        "page_url_pattern": "http://localhost:8001/login",
        "locator": {
            "locator_id": "locator-login",
            "locator_version": 3,
            "strategy": "role",
            "locator_data": {"strategy": "role", "role": "button", "name": "Login", "exact": True},
            "python_expression": 'page.get_by_role("button", name="Login", exact=True)',
            "confidence": 0.98,
            "validation_status": "unique",
        },
    }
    step.update(overrides)
    return step


def test_scanned_locators_payload_carries_identity_and_version():
    payload = _scanned_locators_payload([resolved_step()], None)
    assert payload[0]["locator_id"] == "locator-login"
    assert payload[0]["locator_version"] == 3
    assert payload[0]["test_step_id"] == "tc-1:step-1"
    assert payload[0]["python_expression"] == (
        'page.get_by_role("button", name="Login", exact=True)'
    )


def test_allowed_expressions_are_exactly_what_was_supplied():
    payload = _scanned_locators_payload([resolved_step()], None)
    assert _allowed_expressions(payload) == {
        'page.get_by_role("button", name="Login", exact=True)'
    }


def test_the_prompt_forbids_inventing_locators():
    prompt = automation_agent._SYSTEM_PROMPT
    assert "SCANNED_LOCATORS" in prompt
    assert "Do not create, infer, guess, or modify locators" in prompt
    assert "NO APPROVED LOCATOR MATCHED" in prompt
    # The forbidden forms are named individually so there is no room to read
    # the rule as "no CSS, but a test id is fine".
    for forbidden in ("CSS selectors", "XPath", "test IDs", "role names", "labels", "placeholders"):
        assert forbidden in prompt


def test_the_prompt_requires_preserving_page_frame_scope_and_version():
    prompt = automation_agent._SYSTEM_PROMPT
    assert "Preserve each locator's page, frame, parent scope" in prompt.replace("\n", " ") or (
        "page, frame, parent scope, exact-matching option, locator id" in prompt.replace("\n", " ")
    )


# ---------------------------------------------------------------------------
# Generation behaviour (§11, §12, §14)
# ---------------------------------------------------------------------------


class _FakeModel:
    """A stand-in for the chat model that returns pre-scripted files."""

    def __init__(self, responses: list[AutomationOutput]) -> None:
        self._responses = list(responses)
        self.prompts: list[str] = []

    def with_structured_output(self, _schema):  # noqa: D401 - mirrors langchain
        return self

    def invoke(self, messages):
        self.prompts.append(messages[-1].content)
        return self._responses.pop(0)


@pytest.fixture
def fake_model(monkeypatch):
    """Install a scripted model in place of Ollama for the agent under test."""

    def install(responses: list[AutomationOutput]) -> _FakeModel:
        model = _FakeModel(responses)
        monkeypatch.setattr(automation_agent, "require_ollama", lambda *a, **k: None)
        monkeypatch.setattr(automation_agent, "get_chat_model", lambda *a, **k: model)
        monkeypatch.setattr(
            automation_agent,
            "generation_metadata",
            lambda *a, **k: {"model": "test-model", "temperature": 0.1},
        )
        return model

    return install


def _output(content: str) -> AutomationOutput:
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


GOOD_TEST = '''import pytest
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.generated]


# TC: TC-001 Login
# REQ: REQ-1
def test_login(page: Page, base_url: str, credentials, target_available) -> None:
    page.goto(base_url)
    # UI Scanner Locator: locator-login-v3
    page.get_by_role("button", name="Login", exact=True).click()
'''

INVENTED_TEST = '''import pytest
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.generated]


def test_login(page: Page, base_url: str, credentials, target_available) -> None:
    page.locator("#login-btn").click()
'''


def test_generation_accepts_code_built_from_the_supplied_locators(fake_model):
    fake_model([_output(GOOD_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    assert 'page.get_by_role("button", name="Login", exact=True)' in result.files[0].content
    assert "1 UI Scanner locator(s) supplied" in result.notes


def test_generation_rejects_invented_locators_and_retries(fake_model):
    model = fake_model([_output(INVENTED_TEST), _output(GOOD_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    assert 'page.locator("#login-btn")' not in result.files[0].content
    # The retry is told exactly what was wrong, so it has a chance of being right.
    assert "REJECTED" in model.prompts[-1]
    assert 'page.locator("#login-btn")' in model.prompts[-1]


def test_an_uncooperative_model_yields_review_markers_not_a_failed_job(fake_model, monkeypatch):
    """§11: the answer to "no validated locator" is a marker, never a crash.

    Found in production: a project whose scan covered only the login page had
    every User Management step invented by the model, and the hard failure
    killed the whole generation job with a 500 — leaving the user with nothing
    to review and no stated cause.
    """
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_max_retries", 1)
    fake_model([_output(INVENTED_TEST), _output(INVENTED_TEST)])

    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )

    content = result.files[0].content
    # The invented selector is gone…
    assert 'page.locator("#login-btn").click()' not in content
    assert find_invented_locators(content, [resolved_step()["locator"]["python_expression"]]) == []
    # …replaced by a marker that says what happened…
    assert "NO APPROVED LOCATOR MATCHED" in content
    # …and the file still parses.
    import ast

    ast.parse(content)
    assert "LOCATOR REVIEW REQUIRED" in result.notes


def test_stripping_a_locator_that_breaks_the_file_yields_a_valid_skipped_stub(
    fake_model, monkeypatch
):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_max_retries", 0)
    # Commenting out the body of `if` would leave a syntax error behind.
    broken = _output(
        "import pytest\n\npytestmark = [pytest.mark.generated]\n\n\n"
        "def test_login(page, base_url, credentials, target_available):\n"
        "    if True:\n"
        '        page.locator("#login-btn").click()\n'
    )
    fake_model([broken])

    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )

    import ast

    content = result.files[0].content
    ast.parse(content)  # always valid Python
    assert "pytest.skip" in content
    assert "#login-btn" not in content.split("# NO APPROVED LOCATOR MATCHED")[0]


def test_a_validated_library_locator_is_not_treated_as_invented(fake_model):
    """The regression that rejected the scanner's own work.

    The matcher binds one locator per step, but the library holds others that
    were validated just as thoroughly. Using one of those is not invention —
    reporting it as such made generation fail on a project whose library
    contained the very locator being flagged.
    """
    library_expression = 'page.get_by_role("button", name="Login", exact=True)'
    uses_library = _output(
        "import pytest\n\npytestmark = [pytest.mark.generated]\n\n\n"
        "def test_login(page, base_url, credentials, target_available):\n"
        f"    {library_expression}.click()\n"
    )
    fake_model([uses_library])

    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        # No step resolved to it; it is simply in the project's library.
        resolved_steps=[],
        approved_locators=[
            {
                "locator_id": "locator-login",
                "locator_version": 2,
                "element_name": "Login",
                "expression": library_expression,
                "confidence": 0.98,
            }
        ],
    )

    assert library_expression in result.files[0].content
    assert "LOCATOR REVIEW REQUIRED" not in result.notes


def test_a_library_locator_gets_its_own_traceability_comment(fake_model):
    library_expression = 'page.get_by_role("button", name="Login", exact=True)'
    fake_model(
        [
            _output(
                "import pytest\n\npytestmark = [pytest.mark.generated]\n\n\n"
                "def test_login(page, base_url, credentials, target_available):\n"
                f"    {library_expression}.click()\n"
            )
        ]
    )
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[],
        approved_locators=[
            {
                "locator_id": "locator-login",
                "locator_version": 2,
                "element_name": "Login",
                "expression": library_expression,
                "confidence": 0.98,
            }
        ],
    )
    assert "# UI Scanner Locator: locator-login-v2" in result.files[0].content


def test_unresolved_steps_reach_the_prompt_as_review_markers(fake_model):
    review_only = _output(
        'import pytest\n\npytestmark = [pytest.mark.generated]\n\n\n'
        'def test_membership(page, base_url, credentials, target_available):\n'
        '    # NO APPROVED LOCATOR MATCHED:\n'
        '    # No validated UI Scanner locator was found for:\n'
        '    # "Click Confirm Membership"\n'
        '    pytest.skip("locator review required")\n'
    )
    model = fake_model([review_only])
    result = automation_agent.generate_automation(
        [{"id": "tc-9", "case_key": "TC-009", "title": "Membership", "steps": ["Click Confirm Membership"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[],
        unresolved_steps=[
            {
                "test_step_id": "tc-9:step-1",
                "test_step": "Click Confirm Membership",
                "reason": "No validated scanned locator matches this test step.",
                "suggested_action": "Run a targeted UI scan for the Membership page.",
            }
        ],
    )
    assert "NO APPROVED LOCATOR MATCHED" in result.files[0].content
    assert "Click Confirm Membership" in model.prompts[0]
    assert "no validated locator exists for any step" in model.prompts[0]
    # With nothing scanned, no locator call is permissible at all — and none
    # was emitted.
    assert find_invented_locators(result.files[0].content, []) == []


def test_the_prompt_carries_the_scanned_locators_as_json(fake_model):
    model = fake_model([_output(GOOD_TEST)])
    automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    prompt = model.prompts[0]
    body = prompt.split("<<<SCANNED_LOCATORS_JSON")[1].split("SCANNED_LOCATORS_JSON>>>")[0]
    payload = json.loads(body)
    assert payload[0]["locator_id"] == "locator-login"
    assert payload[0]["test_step_id"] == "tc-1:step-1"


def test_disabling_metadata_comments_changes_the_instruction_only(fake_model):
    model = fake_model([_output(GOOD_TEST)])
    automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
        locator_comments=False,
    )
    assert "omit those comment lines" in model.prompts[0]


# ---------------------------------------------------------------------------
# Traceability comments (§14)
# ---------------------------------------------------------------------------


COMMENTED_TEST = '''import pytest

pytestmark = [pytest.mark.generated]


def test_login(page, base_url, credentials, target_available):
    # UI Scanner Locator: locator-copied-from-the-example-v9
    page.get_by_role("button", name="Login", exact=True).click()
'''


def test_traceability_comments_are_rewritten_from_the_resolution_result(fake_model):
    """A comment the model wrote is decoration; this makes it traceability."""
    fake_model([_output(COMMENTED_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    content = result.files[0].content
    assert "# UI Scanner Locator: locator-login-v3" in content
    assert "locator-copied-from-the-example" not in content


def test_the_comment_sits_directly_above_its_own_locator(fake_model):
    fake_model([_output(COMMENTED_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    lines = result.files[0].content.splitlines()
    index = next(i for i, line in enumerate(lines) if "get_by_role" in line)
    assert lines[index - 1].strip() == "# UI Scanner Locator: locator-login-v3"
    # And it keeps the indentation of the code it annotates.
    assert lines[index - 1].startswith("    ")


def test_disabling_metadata_comments_removes_them_from_the_code(fake_model):
    fake_model([_output(COMMENTED_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
        locator_comments=False,
    )
    content = result.files[0].content
    assert "UI Scanner Locator" not in content
    # The locator itself is untouched — only the comment goes.
    assert 'page.get_by_role("button", name="Login", exact=True)' in content


def test_a_locator_quoted_in_a_comment_is_not_executable_and_not_flagged():
    """A removed locator stays visible to the reviewer without re-tripping the gate."""
    code = (
        "def test_login(page):\n"
        "    # NO APPROVED LOCATOR MATCHED:\n"
        "    # No validated UI Scanner locator was found for this step; the\n"
        "    # generator's own proposal was removed rather than executed:\n"
        '    # page.locator("#login-btn").click()\n'
        '    page.get_by_role("button", name="Login", exact=True).click()\n'
    )
    assert find_invented_locators(code, ALLOWED) == []


def test_a_hash_inside_a_css_selector_is_not_mistaken_for_a_comment():
    """`#` starts every id selector — stripping it naively would corrupt code."""
    from engine.uiscanner.locator_code import strip_comments

    code = 'page.locator("#login-btn").click()  # a real comment\n'
    stripped = strip_comments(code)
    assert '"#login-btn"' in stripped
    assert "a real comment" not in stripped


# ---------------------------------------------------------------------------
# Selector shorthand and non-Python output (§12) — found in production
# ---------------------------------------------------------------------------

JS_ANSWER = """import { test, expect } from '@playwright/test';

test('TC-001 - Successful Login', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.fill('#email', QA_TEST_EMAIL);
  await page.click('text=Login');
  await page.getByRole('button', { name: 'Sign in' }).click();
});
"""


def test_selector_shorthand_is_an_invented_locator():
    """`page.fill("#email", value)` never looks like a chain — but it is a
    selector, and a raw selector is by definition unscanned."""
    code = (
        "def test_login(page):\n"
        '    page.fill("#email", credentials.username)\n'
        '    page.click("text=Login")\n'
        '    page.wait_for_selector(".spinner")\n'
    )
    offenders = find_invented_locators(code, ALLOWED)
    assert 'page.fill("#email")' in offenders
    assert 'page.click("text=Login")' in offenders
    assert 'page.wait_for_selector(".spinner")' in offenders


def test_a_typescript_answer_does_not_slip_past_the_locator_gate():
    """A model answering in TypeScript wrote raw CSS into a .py file and the
    Python-only chain scanner saw nothing at all."""
    offenders = find_invented_locators(JS_ANSWER, ALLOWED)
    assert any("#email" in o for o in offenders)
    assert any("text=Login" in o for o in offenders)
    assert any("Sign in" in o for o in offenders)


def test_navigation_is_not_mistaken_for_a_selector():
    assert find_invented_locators('page.goto("https://example.com/login")', ALLOWED) == []


def test_a_value_passed_to_a_locator_is_not_a_selector():
    """`locator.fill("someone@example.com")` fills a value; only `page.fill`
    takes a selector."""
    assert find_invented_locators('self.email_input.fill("someone@example.com")', ALLOWED) == []


def test_a_selector_that_belongs_to_a_scanned_locator_is_allowed():
    allowed = ['page.locator("[data-cy=\\"status-chip\\"]")']
    code = 'page.click("[data-cy=\\"status-chip\\"]")\n'
    assert find_invented_locators(code, allowed) == []


def test_generation_rejects_a_typescript_answer_and_retries(fake_model):
    model = fake_model([_output(JS_ANSWER), _output(GOOD_TEST)])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    import ast

    ast.parse(result.files[0].content)
    assert "@playwright/test" not in result.files[0].content
    # The retry is told the language was wrong, not just "try again".
    assert "not valid Python" in model.prompts[-1]
    assert "TypeScript" in model.prompts[-1]


# ---------------------------------------------------------------------------
# A review-required test must not report a green pass (§11)
# ---------------------------------------------------------------------------

VACUOUS_TEST = '''import pytest
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.generated]


# NO APPROVED LOCATOR MATCHED:
# No validated UI Scanner locator was found for:
# "Click the submit button."
def test_successful_login(page: Page, base_url: str, credentials, target_available) -> None:
    page.goto(base_url)

    # pytest.skip("locator review required")
'''


def test_a_noted_test_still_runs(fake_model):
    """A step with no approved match is a note, never a skip (§5).

    Approval is final, so one unmatched step does not take a suite out of
    service: the steps that did match still execute, and the note says which
    one did not.
    """
    fake_model(
        [
            _output(
                "import pytest\n"
                "from playwright.sync_api import Page, expect\n\n"
                "pytestmark = [pytest.mark.generated]\n\n\n"
                "def test_login(page, base_url, credentials, target_available):\n"
                "    page.goto(base_url)\n"
                "    # NO APPROVED LOCATOR MATCHED:\n"
                '    # "Click Confirm"\n',
            )
        ]
    )
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    content = result.files[0].content
    ast.parse(content)
    assert "pytest.skip(" not in content
    assert "NO APPROVED LOCATOR MATCHED" in content


def test_a_model_written_review_skip_is_removed(fake_model):
    """A model reaching for `pytest.skip` would reinstate the old workflow."""
    fake_model(
        [
            _output(
                "import pytest\n"
                "from playwright.sync_api import Page, expect\n\n"
                "pytestmark = [pytest.mark.generated]\n\n\n"
                "def test_login(page, base_url, credentials, target_available):\n"
                '    pytest.skip("locator review required")\n'
                "    page.goto(base_url)\n",
            )
        ]
    )
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    content = result.files[0].content
    ast.parse(content)
    assert "pytest.skip(" not in content
    assert "page.goto(base_url)" in content


def test_a_file_with_no_interactions_keeps_its_skip(fake_model):
    """A stub must not report green.

    Removing the gate does not mean a test that exercises nothing may pass:
    a body of `pass` claims coverage that never ran, which is worse than the
    workflow this change removes.
    """
    fake_model(
        [
            _output(
                "import pytest\n\n"
                "pytestmark = [pytest.mark.generated]\n\n\n"
                "def test_login(page, base_url, credentials, target_available):\n"
                '    pytest.skip("locator review required")\n',
            )
        ]
    )
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    content = result.files[0].content
    ast.parse(content)
    assert "pytest.skip(" in content


def test_removing_a_skip_never_leaves_an_unparseable_file(fake_model):
    """The strip must not empty a function body it leaves behind."""
    fake_model(
        [
            _output(
                "import pytest\n"
                "from playwright.sync_api import Page, expect\n\n"
                "pytestmark = [pytest.mark.generated]\n\n\n"
                "def test_login(page, base_url, credentials, target_available):\n"
                '    pytest.skip("locator review required")\n'
                "    page.goto(base_url)\n"
                '    page.get_by_role("button", name="Login", exact=True).click()\n',
            )
        ]
    )
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    content = result.files[0].content
    ast.parse(content)
    assert "pytest.skip(" not in content
    assert 'page.get_by_role("button", name="Login", exact=True).click()' in content


def test_an_unmatched_step_is_a_warning_not_a_blocking_error():
    """Approval is final: a gap in the scan never blocks the generated file."""
    from tools.code_validation import check_unmatched_locator_notes

    issues = check_unmatched_locator_notes(VACUOUS_TEST, "test_successful_login.py")
    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert "approve its locators" in issues[0].message


def test_a_file_with_every_step_matched_raises_nothing():
    from tools.code_validation import check_unmatched_locator_notes

    clean = VACUOUS_TEST.replace("NO APPROVED LOCATOR MATCHED", "Step")
    assert check_unmatched_locator_notes(clean, "test_successful_login.py") == []


# ---------------------------------------------------------------------------
# Language enforcement (§11, §18) — found in production
# ---------------------------------------------------------------------------


def test_the_prompt_contains_no_javascript_comment_syntax():
    """A `//` comment in the prompt is enough to nudge the model into JS.

    The empty-locator placeholder used to render as `[]  // no validated
    locators…`, and the model answered in JavaScript for exactly the projects
    that hit that branch.
    """
    prompt = automation_agent._HUMAN_TEMPLATE.format(
        base_url="http://localhost:8001",
        page_objects_summary="(none)",
        comment_rule="",
        scanned_locators_json="[]\n(The list is empty.)",
        unresolved_steps_json="[]",
        test_cases_json="[]",
    )
    # `//` after a scheme is a URL; `//` on its own is a JS comment.
    comment_re = re.compile(r"(?<!:)//")
    for line in prompt.splitlines():
        assert not comment_re.search(line), (
            f"JavaScript comment syntax in the prompt: {line!r}"
        )


def test_the_prompt_demands_python_before_anything_else():
    prompt = automation_agent._SYSTEM_PROMPT
    head = prompt[:800]
    assert "Python" in head and "pytest" in head
    assert "Never TypeScript, never JavaScript" in prompt
    assert "@playwright/test" in prompt  # named as the thing not to write


def test_a_fenced_answer_is_unwrapped_rather_than_rejected(fake_model):
    fenced = _output("```python\n" + GOOD_TEST + "```\n")
    fake_model([fenced])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click Login"]}],
        "http://localhost:8001",
        "",
        resolved_steps=[resolved_step()],
    )
    import ast

    ast.parse(result.files[0].content)
    assert "```" not in result.files[0].content


def test_a_model_that_only_speaks_javascript_yields_a_skipped_review_stub(
    fake_model, monkeypatch
):
    """§11: an unusable answer must still leave the user something to review."""
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_max_retries", 1)
    fake_model([_output(JS_ANSWER), _output(JS_ANSWER)])

    result = automation_agent.generate_automation(
        [
            {
                "id": "tc-1",
                "case_key": "TC-001",
                "title": "Successful login",
                "steps": ["Click the submit button."],
            }
        ],
        "http://localhost:8001",
        "",
        resolved_steps=[],
        unresolved_steps=[
            {
                "test_case_id": "tc-1",
                "test_step_id": "tc-1:step-1",
                "test_step": "Click the submit button.",
                "reason": "No scanned element matches this test step.",
            }
        ],
    )

    import ast

    from engine.uiscanner.locator_code import strip_comments

    assert result.files, "a stub must be emitted rather than the job failing"
    content = result.files[0].content
    ast.parse(content)                                   # valid Python
    assert result.files[0].path.endswith(".py")
    assert "@playwright/test" not in content             # nothing of the JS answer
    assert find_invented_locators(content, []) == []     # and no selector at all
    assert "NO APPROVED LOCATOR MATCHED" in content
    assert "Click the submit button." in content
    assert "pytest.skip(" in strip_comments(content)     # cannot pass silently
    assert "did not return usable Python" in result.notes


def test_a_review_marked_file_gets_the_imports_it_needs_to_collect(fake_model):
    """A missing `Page` import is a collection error, and one collection error
    takes the whole directory with it — the shape of "0 passed, 0 failed"."""
    missing_imports = _output(
        "# TC: TC-001 Login\n"
        "# NO APPROVED LOCATOR MATCHED:\n"
        "# No validated UI Scanner locator was found for:\n"
        '# "Click the submit button."\n'
        "def test_login(page: Page, base_url: str, credentials, target_available) -> None:\n"
        "    page.goto(base_url)\n"
    )
    fake_model([missing_imports])
    result = automation_agent.generate_automation(
        [{"id": "tc-1", "case_key": "TC-001", "title": "Login", "steps": ["Click the submit button."]}],
        "http://localhost:8001",
        "",
        resolved_steps=[],
    )
    content = result.files[0].content
    assert "from playwright.sync_api import Page" in content
    assert "import pytest" in content
    # And every name the module uses now resolves.
    import ast

    tree = ast.parse(content)
    imported = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert {"pytest", "Page"} <= imported


# ---------------------------------------------------------------------------
# Deterministic assembly from validated locators
# ---------------------------------------------------------------------------


class TestAssembleFromResolvedSteps:
    """Building tests without the model (§11).

    Every input is already decided and already verified: the scanner chose the
    locator and proved it on the running application, the resolver bound it to
    a step with an action and a fixture-backed value. Turning that into pytest
    is transcription, so a model that cannot return usable Python is no reason
    to hand the user a placeholder.
    """

    @staticmethod
    def _step(sequence, action, description, value, expression, locator_id="loc-1"):
        return {
            "test_step_id": f"s{sequence}",
            "test_case_id": "tc1",
            "sequence": sequence,
            "action": action,
            "description": description,
            "value_reference": value,
            "element_name": "Element",
            "page_name": "Login",
            "page_url_pattern": "https://example.test/login",
            "locator": {
                "locator_id": locator_id,
                "locator_version": 2,
                "strategy": "role",
                "python_expression": expression,
                "confidence": 1.0,
                "validation_status": "unique",
            },
        }

    @staticmethod
    def _case():
        return {
            "id": "tc1",
            "case_key": "TC-001",
            "title": "TC-001: Successful login",
            "expected_results": ["The user is signed in."],
            "requirement_ids": ["REQ-1"],
        }

    def _assemble(self, steps, unresolved=None, comments=True):
        return automation_agent._assemble_from_resolved_steps(
            [self._case()], steps, unresolved or [], comments
        )

    def test_produces_valid_python(self):
        out = self._assemble(
            [
                self._step(1, "fill", "Enter the username.", "credentials.username",
                           'page.get_by_role("textbox", name="Username", exact=True)'),
                self._step(2, "click", "Click submit.", "",
                           'page.get_by_role("button", name="Submit", exact=True)', "loc-2"),
            ]
        )
        assert out is not None
        content = out.files[0].content
        compile(content, "generated.py", "exec")

    def test_uses_only_the_supplied_locators(self):
        expression = 'page.get_by_role("button", name="Submit", exact=True)'
        out = self._assemble([self._step(1, "click", "Click submit.", "", expression)])
        content = out.files[0].content
        assert expression in content
        # Nothing else that looks like a locator may appear.
        for invented in ("get_by_test_id", "locator(", "xpath=", "css="):
            assert invented not in content, invented

    def test_credentials_come_from_fixtures_never_literals(self):
        out = self._assemble(
            [self._step(1, "fill", "Enter the password.", "credentials.password",
                        'page.get_by_label("Password", exact=True)')]
        )
        content = out.files[0].content
        assert ".fill(credentials.password)" in content
        assert "Password123" not in content

    def test_assertions_use_web_first_expect(self):
        out = self._assemble(
            [self._step(1, "assert", "The heading is shown.", "",
                        'page.get_by_role("heading", name="Done", exact=True)')]
        )
        content = out.files[0].content
        assert "expect(" in content and "to_be_visible()" in content
        assert "time.sleep" not in content

    def test_a_runnable_test_is_not_skipped(self):
        out = self._assemble(
            [self._step(1, "click", "Click submit.", "",
                        'page.get_by_role("button", name="Submit", exact=True)')]
        )
        assert "pytest.skip" not in out.files[0].content

    def test_a_step_without_a_value_is_noted_not_guessed(self):
        """A fill with no resolved value has no legitimate data to type.

        It is noted and left out — never skipped, because approval is final and
        a single unmatched step does not take the suite out of service (§5).
        """
        out = self._assemble(
            [self._step(1, "fill", "Enter the username.", "",
                        'page.get_by_role("textbox", name="Username", exact=True)')]
        )
        content = out.files[0].content
        assert "NO APPROVED LOCATOR MATCHED" in content
        assert "pytest.skip" not in content
        assert ".fill(" not in content

    def test_unmatched_steps_are_noted_without_blocking_the_suite(self):
        """The matched steps still run; the unmatched one is reported."""
        out = self._assemble(
            [self._step(1, "click", "Click submit.", "",
                        'page.get_by_role("button", name="Submit", exact=True)')],
            unresolved=[{"test_case_id": "tc1", "description": "Open the menu."}],
        )
        content = out.files[0].content
        assert "Open the menu." in content
        assert "NO APPROVED LOCATOR MATCHED" in content
        assert "pytest.skip" not in content
        # The step that did match is still executed.
        assert 'page.get_by_role("button", name="Submit", exact=True).click()' in content

    def test_traceability_comments_carry_the_locator_version(self):
        out = self._assemble(
            [self._step(1, "click", "Click submit.", "",
                        'page.get_by_role("button", name="Submit", exact=True)', "loc-9")]
        )
        assert "# UI Scanner Locator: loc-9-v2" in out.files[0].content

    def test_comments_can_be_disabled(self):
        out = self._assemble(
            [self._step(1, "click", "Click submit.", "",
                        'page.get_by_role("button", name="Submit", exact=True)')],
            comments=False,
        )
        assert "# UI Scanner Locator:" not in out.files[0].content

    def test_nothing_to_assemble_returns_none(self):
        """With no validated locator there is nothing to build, and the caller
        falls back to the review stub rather than inventing a test."""
        assert self._assemble([]) is None

    def test_steps_are_emitted_in_sequence_order(self):
        out = self._assemble(
            [
                self._step(2, "click", "Second.", "",
                           'page.get_by_role("button", name="Two", exact=True)', "loc-2"),
                self._step(1, "click", "First.", "",
                           'page.get_by_role("button", name="One", exact=True)', "loc-1"),
            ]
        )
        content = out.files[0].content
        assert content.index('name="One"') < content.index('name="Two"')


class TestBindUnresolvedStepsToLibrary:
    """Using the approved library for steps the matcher could not bind (§2).

    Per-step resolution is a convenience, not a gate. Every locator in the
    library was scanned, validated against the running application and
    approved, so choosing one is never an invention — and refusing to produced
    un-runnable suites over wording alone ("Login button" against a control the
    scan named "Submit").
    """

    PAGE = "https://app.test/login"

    def _library(self):
        return [
            {"locator_id": "loc-1", "locator_version": 1, "element_name": "Username",
             "role": "textbox", "page": self.PAGE, "strategy": "role",
             "expression": 'page.get_by_role("textbox", name="Username", exact=True)',
             "confidence": 1.0},
            {"locator_id": "loc-2", "locator_version": 1, "element_name": "Password",
             "role": "textbox", "page": self.PAGE, "strategy": "label",
             "expression": 'page.get_by_label("Password", exact=True)', "confidence": 1.0},
            {"locator_id": "loc-3", "locator_version": 1, "element_name": "Submit",
             "role": "button", "page": self.PAGE, "strategy": "role",
             "expression": 'page.get_by_role("button", name="Submit", exact=True)',
             "confidence": 1.0},
        ]

    @staticmethod
    def _step(step_id, text, sequence=1):
        return {"test_step_id": step_id, "test_case_id": "tc1",
                "sequence": sequence, "test_step": text, "reason": "unmatched"}

    def _bind(self, steps, library=None):
        return automation_agent._bind_unresolved_steps(
            steps, library if library is not None else self._library(), "https://app.test"
        )

    def test_wording_differences_do_not_block_generation(self):
        """"Login button" is satisfied by the page's only button, "Submit"."""
        bound, unresolved = self._bind([self._step("s1", "Click the 'Login' button.")])
        assert not unresolved
        assert bound[0]["action"] == "click"
        assert bound[0]["locator"]["locator_id"] == "loc-3"

    def test_email_step_binds_to_the_username_field(self):
        bound, unresolved = self._bind(
            [self._step("s1", "Enter a valid email address in the email field.")]
        )
        assert not unresolved
        assert bound[0]["locator"]["locator_id"] == "loc-1"
        assert bound[0]["value_reference"] == "credentials.username"

    def test_password_step_binds_to_the_password_field(self):
        bound, _ = self._bind([self._step("s1", "Enter the password in the password field.")])
        assert bound[0]["locator"]["locator_id"] == "loc-2"
        assert bound[0]["value_reference"] == "credentials.password"

    def test_the_role_must_fit_the_action(self):
        """A click never binds to a text box, however similar the names."""
        bound, unresolved = self._bind(
            [self._step("s1", "Click the Username control.")],
            library=[e for e in self._library() if e["role"] == "textbox"],
        )
        assert bound == []
        assert len(unresolved) == 1

    def test_an_ambiguous_choice_is_left_for_review(self):
        """Two equally plausible buttons and no way to tell them apart."""
        library = [
            {"locator_id": "a", "locator_version": 1, "element_name": "Save",
             "role": "button", "page": self.PAGE, "strategy": "role",
             "expression": 'page.get_by_role("button", name="Save", exact=True)'},
            {"locator_id": "b", "locator_version": 1, "element_name": "Send",
             "role": "button", "page": self.PAGE, "strategy": "role",
             "expression": 'page.get_by_role("button", name="Send", exact=True)'},
        ]
        bound, unresolved = self._bind([self._step("s1", "Click the action control.")], library)
        assert bound == []
        assert len(unresolved) == 1

    def test_a_fill_without_a_fixture_value_is_not_guessed(self):
        """There is no fixture for arbitrary data, so nothing may be typed."""
        library = [
            {"locator_id": "x", "locator_version": 1, "element_name": "Postcode",
             "role": "textbox", "page": self.PAGE, "strategy": "role",
             "expression": 'page.get_by_role("textbox", name="Postcode", exact=True)'},
        ]
        bound, unresolved = self._bind([self._step("s1", "Enter the postcode.")], library)
        assert bound == []
        assert len(unresolved) == 1

    def test_locators_from_the_application_under_test_are_preferred(self):
        other = {"locator_id": "other", "locator_version": 1, "element_name": "Login",
                 "role": "button", "page": "https://elsewhere.test/login",
                 "strategy": "role",
                 "expression": 'page.get_by_role("button", name="Login", exact=True)'}
        bound, _ = self._bind([self._step("s1", "Click the 'Login' button.")],
                              [*self._library(), other])
        # Name overlap favours the other application's "Login"; the origin
        # preference must keep the choice inside the app being tested.
        assert bound[0]["locator"]["locator_id"] == "loc-3"

    def test_nothing_is_bound_without_a_library(self):
        bound, unresolved = self._bind([self._step("s1", "Click the 'Login' button.")], [])
        assert bound == []
        assert len(unresolved) == 1

    def test_bound_steps_only_ever_carry_library_expressions(self):
        library = self._library()
        allowed = {e["expression"] for e in library}
        bound, _ = self._bind(
            [
                self._step("s1", "Enter a valid email address.", 1),
                self._step("s2", "Enter the password.", 2),
                self._step("s3", "Click the 'Login' button.", 3),
            ],
            library,
        )
        assert len(bound) == 3
        for step in bound:
            assert step["locator"]["python_expression"] in allowed
