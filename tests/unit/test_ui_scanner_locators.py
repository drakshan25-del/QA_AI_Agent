"""Unit tests for the UI Scanner's deterministic locator pipeline (FR-UIS-*).

These cover the parts that decide *what* a locator is and *how good* it is —
generation, stability heuristics, scoring, rendering and redaction — without a
browser. Anything that needs a real page lives in the integration suite.
"""

from __future__ import annotations

import pytest

from engine.uiscanner.locator_generator import (
    generate_candidates,
    is_dynamic_id,
    is_random_class,
    render_expression,
    render_python,
    usable_classes,
)
from engine.uiscanner.locator_scoring import (
    rank_candidates,
    recommend,
    score_candidate,
    to_confidence,
)
from engine.uiscanner.locator_validator import build_locator
from engine.uiscanner.redaction import (
    looks_sensitive,
    redact_mapping,
    redact_text,
    safe_value,
)
from engine.uiscanner.frames import frame_selector
from engine.uiscanner.types import FrameDefinition, LocatorCandidate, ScanOptions

pytestmark = pytest.mark.unit


def element(**overrides) -> dict:
    """A scanned-element dict with sensible defaults for one control."""
    base = {
        "uid": "f0-1",
        "tagName": "button",
        "explicitRole": "",
        "inferredRole": "button",
        "accessibleName": "Save",
        "accessibleNameSource": "content",
        "visibleText": "Save",
        "inputType": "",
        "name": "",
        "id": "",
        "placeholder": "",
        "title": "",
        "alt": "",
        "href": "",
        "value": "",
        "testIds": {},
        "classes": [],
        "ariaLabel": "",
        "sensitive": False,
        "states": {"visible": True, "enabled": True, "clickable": True},
        "position": {"x": 10, "y": 20, "width": 80, "height": 30},
        "context": {"associatedLabel": "", "scopes": []},
    }
    base.update(overrides)
    return base


# --- stability heuristics --------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        ":r3:",  # React useId
        "mui-48392",
        "radix-:r1:",
        "field-9f2c1a4b8e7d6f5a",  # hash-like
        "user-1234567",  # long numeric run
        "8c1f3f9c-1a2b-4c3d-9e8f-0a1b2c3d4e5f",  # uuid
        "12345",
        "",
    ],
)
def test_dynamic_ids_are_detected(value: str) -> None:
    dynamic, reason = is_dynamic_id(value)
    assert dynamic is True
    assert reason


@pytest.mark.parametrize("value", ["login-submit", "email", "billing_address", "saveBtn"])
def test_stable_ids_are_kept(value: str) -> None:
    dynamic, _ = is_dynamic_id(value)
    assert dynamic is False


@pytest.mark.parametrize(
    "value",
    ["css-1q2w3e", "sc-AbCdEf", "jsx-1234567", "Button_root__x8Fk2", "px-4", "sm:mt-2"],
)
def test_random_or_utility_classes_are_rejected(value: str) -> None:
    assert is_random_class(value) is True


def test_semantic_classes_survive_filtering() -> None:
    assert usable_classes(
        ["css-1q2w3e", "primary-button", "px-4", "checkout-form"]
    ) == ["primary-button", "checkout-form"]


# --- generation ------------------------------------------------------------


def test_role_and_name_is_the_first_candidate() -> None:
    candidates = generate_candidates(element(), "f0:button:button:save")
    assert candidates[0].strategy == "role"
    assert candidates[0].expression == (
        "page.getByRole('button', { name: 'Save', exact: true })"
    )
    assert candidates[0].python_expression == (
        'page.get_by_role("button", name="Save", exact=True)'
    )


def test_label_locator_generated_for_form_controls() -> None:
    candidates = generate_candidates(
        element(
            tagName="input",
            inferredRole="textbox",
            accessibleName="Email address",
            inputType="email",
            placeholder="Enter email",
            context={"associatedLabel": "Email address", "scopes": []},
        ),
        "f0:input:textbox:email",
    )
    strategies = [c.strategy for c in candidates]
    assert "label" in strategies
    assert "placeholder" in strategies
    label = next(c for c in candidates if c.strategy == "label")
    assert label.expression == "page.getByLabel('Email address', { exact: true })"


def test_test_id_locator_prefers_data_testid() -> None:
    candidates = generate_candidates(
        element(testIds={"data-testid": "login-submit"}), "f0:button:button:login"
    )
    test_id = next(c for c in candidates if c.strategy == "testId")
    assert test_id.expression == "page.getByTestId('login-submit')"
    assert test_id.locator_data["attribute"] == "data-testid"


def test_non_standard_test_id_uses_an_attribute_selector() -> None:
    candidates = generate_candidates(
        element(testIds={"data-cy": "status-chip"}), "f0:span:none:status"
    )
    test_id = next(c for c in candidates if c.strategy == "testId")
    assert test_id.expression == "page.locator('[data-cy=\"status-chip\"]')"


def test_duplicate_elements_get_a_scoped_semantic_locator() -> None:
    candidates = generate_candidates(
        element(context={"associatedLabel": "", "scopes": [{"role": "region", "name": "Profile"}]}),
        "f0:button:button:save",
    )
    scoped = next(c for c in candidates if c.strategy == "scopedRole")
    assert scoped.expression == (
        "page.getByRole('region', { name: 'Profile', exact: true })"
        ".getByRole('button', { name: 'Save', exact: true })"
    )
    assert scoped.locator_data["parent"]["role"] == "region"
    assert scoped.locator_data["child"]["role"] == "button"


def test_dynamic_id_candidate_carries_a_warning() -> None:
    candidates = generate_candidates(element(id="mui-48392"), "f0:button:button:save")
    css = next(c for c in candidates if c.strategy == "css")
    assert css.warnings
    assert "generated" in css.warnings[0]


def test_xpath_is_relative_and_last() -> None:
    candidates = generate_candidates(element(), "f0:button:button:save")
    xpath = next(c for c in candidates if c.strategy == "xpath")
    assert xpath.locator_data["selector"].startswith("xpath=//button[")
    assert not xpath.locator_data["selector"].startswith("xpath=/html")
    assert xpath.base_score == min(c.base_score for c in candidates)


def test_frame_locators_carry_their_frame_chain() -> None:
    frame = FrameDefinition(path=['iframe[title="Payment"]'], title="Payment", index=1)
    candidates = generate_candidates(
        element(accessibleName="Pay now"), "f1:button:button:pay-now", frame
    )
    assert candidates[0].expression.startswith(
        "page.frameLocator('iframe[title=\"Payment\"]')"
    )
    assert candidates[0].locator_data["frame"]["path"] == ['iframe[title="Payment"]']


def test_frame_selector_prefers_stable_attributes() -> None:
    assert frame_selector({"title": "Payment"}, 0) == 'iframe[title="Payment"]'
    assert frame_selector({"name": "checkout"}, 0) == 'iframe[name="checkout"]'
    # Nothing identifying at all falls back to position, the weakest option.
    assert frame_selector({}, 2) == "iframe >> nth=2"


# --- scoring ---------------------------------------------------------------


def _validated(strategy: str, **verdict) -> LocatorCandidate:
    data = {"strategy": strategy, "role": "button", "name": "Save", "exact": True}
    candidate = LocatorCandidate(
        id=f"c-{strategy}",
        strategy=strategy,  # type: ignore[arg-type]
        expression="page.getByRole('button', { name: 'Save' })",
        python_expression='page.get_by_role("button", name="Save")',
        locator_data=data,
        base_score=100,
    )
    for key, value in verdict.items():
        setattr(candidate, key, value)
    return candidate


def test_unique_match_scores_above_multiple_matches() -> None:
    unique = score_candidate(
        _validated("role", valid=True, unique=True, match_count=1, role_match=True),
        element(),
    )
    ambiguous = score_candidate(
        _validated("role", valid=True, unique=False, match_count=3, role_match=True),
        element(),
    )
    assert unique.final_score > ambiguous.final_score
    assert unique.confidence > ambiguous.confidence


def test_zero_matches_is_heavily_penalised_and_unusable() -> None:
    scored = score_candidate(
        _validated("role", valid=False, unique=False, match_count=0), element()
    )
    assert scored.final_score < 20
    assert scored.confidence == 0.0


def test_non_unique_confidence_is_capped() -> None:
    assert to_confidence(200, unique=False, valid=True) == 0.5
    assert to_confidence(200, unique=True, valid=True) == 1.0
    assert to_confidence(200, unique=True, valid=False) == 0.0


def test_recommendation_prefers_unique_over_higher_base_score() -> None:
    weak_but_unique = score_candidate(
        _validated("css", valid=True, unique=True, match_count=1), element()
    )
    weak_but_unique.base_score = 50
    strong_but_ambiguous = score_candidate(
        _validated("role", valid=True, unique=False, match_count=4), element()
    )
    best, status = recommend([strong_but_ambiguous, weak_but_unique])
    assert best is weak_but_unique
    assert status == "unique"


def test_recommendation_reports_multiple_matches_when_nothing_is_unique() -> None:
    ambiguous = score_candidate(
        _validated("role", valid=True, unique=False, match_count=2), element()
    )
    best, status = recommend([ambiguous])
    assert best is ambiguous
    assert status == "multiple_matches"


def test_ranking_puts_invalid_candidates_last() -> None:
    valid = score_candidate(
        _validated("role", valid=True, unique=True, match_count=1), element()
    )
    invalid = score_candidate(
        _validated("css", valid=False, unique=False, match_count=0), element()
    )
    assert rank_candidates([invalid, valid])[0] is valid


# --- rendering + rebuild safety --------------------------------------------


def test_expression_is_never_executed_only_rebuilt() -> None:
    """An unknown strategy is refused rather than interpreted (SEC-005)."""
    with pytest.raises(ValueError, match="unknown locator strategy"):
        build_locator(object(), {"strategy": "exec", "selector": "anything"})  # type: ignore[arg-type]


def test_rebuild_rejects_a_scoped_locator_without_both_halves() -> None:
    with pytest.raises(ValueError, match="parent and a child"):
        build_locator(object(), {"strategy": "scopedRole", "parent": {}})  # type: ignore[arg-type]


def test_rendering_escapes_quotes_in_both_languages() -> None:
    data = {"strategy": "text", "value": "It's here", "exact": True}
    assert render_expression(data) == "page.getByText('It\\'s here', { exact: true })"
    assert render_python(data) == 'page.get_by_text("It\'s here", exact=True)'


# --- redaction -------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["password", "userPassword", "otp-code", "api_key", "sessionId", "cvv"]
)
def test_credential_field_names_are_recognised(name: str) -> None:
    assert looks_sensitive(name) is True


def test_sensitive_values_are_dropped_entirely() -> None:
    assert safe_value("hunter2", sensitive=True) == ""


def test_token_shaped_values_are_masked_even_in_ordinary_fields() -> None:
    jwt = "eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM"
    assert safe_value(jwt) == "***"
    assert safe_value("Bearer abcdef1234567890") == "***"
    # 32+ hex characters is session-token shaped; shorter entity ids are not.
    assert safe_value("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6") == "***"
    assert safe_value("507f1f77bcf86cd799439011") == "507f1f77bcf86cd799439011"


def test_ordinary_values_survive_but_are_bounded() -> None:
    assert safe_value("  Save   changes ") == "Save changes"
    assert len(safe_value("x" * 500)) == 120


def test_free_text_redaction_masks_labelled_secrets() -> None:
    assert redact_text("token=abc123") == "token=***"
    assert redact_text("Navigating to https://example.com") == (
        "Navigating to https://example.com"
    )


def test_attribute_maps_are_redacted_recursively() -> None:
    out = redact_mapping({"name": "email", "nested": {"password": "hunter2"}})
    assert out["nested"]["password"] == "***"
    assert out["name"] == "email"


def test_scan_options_never_echo_credentials() -> None:
    options = ScanOptions(
        url="https://example.com",
        username="qa@example.com",
        password="hunter2",
        model="qwen2.5:latest",
    )
    sanitised = options.sanitised()
    assert "password" not in sanitised
    assert "username" not in sanitised
    assert sanitised["authenticated"] is True
    assert sanitised["model"] == "qwen2.5:latest"
