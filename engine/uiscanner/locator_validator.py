"""Locator validation against the live page (§11).

Every generated candidate is rebuilt through the Playwright API from its
machine-readable ``locator_data`` — never by executing the displayable
expression string — and then probed against the real DOM.

One ``evaluate_all`` round trip per candidate returns everything the scorer
needs: how many elements matched, whether the *first* match is the element the
candidate was generated for (proved by the temporary scan uid), and the tag,
role, visibility and enabled state of that match. Doing it in one call keeps a
250-element page inside a few seconds instead of tens of thousands of
individual protocol round trips.

Verdicts:

* zero matches            → invalid
* one match, right element→ unique
* one match, wrong element→ invalid (a look-alike is worse than nothing)
* many matches            → valid but not unique; ranked below scoped locators
"""

from __future__ import annotations

from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import FrameLocator, Locator, Page

from engine.uiscanner.types import UID_ATTRIBUTE, LocatorCandidate

#: Matches inspected per candidate; beyond this the verdict is already "many".
MAX_INSPECTED_MATCHES = 20

#: Runs against the candidate's matches; pure DOM reads, no navigation.
_PROBE_JS = r"""
(elements, options) => {
  const { uidAttr, limit } = options;
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  return {
    total: elements.length,
    matches: elements.slice(0, limit).map((el) => ({
      uid: el.getAttribute(uidAttr) || '',
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      visible: isVisible(el),
      enabled: !(el.disabled === true || el.getAttribute('aria-disabled') === 'true'),
    })),
  };
}
"""


def build_locator(page: Page, data: dict[str, Any]) -> Locator:
    """Rebuild a locator from its machine-readable description.

    Raises:
        ValueError: When the description is malformed or names an unknown
            strategy — a candidate that cannot be rebuilt is never executed.
    """
    root: Page | FrameLocator | Locator = page
    frame = data.get("frame") or {}
    for selector in frame.get("path", []) or []:
        if not isinstance(selector, str) or not selector:
            raise ValueError("frame path entries must be non-empty selectors")
        root = root.frame_locator(selector)
    return _apply(root, data)


def _apply(root: Page | FrameLocator | Locator, data: dict[str, Any]) -> Locator:
    strategy = data.get("strategy")
    if strategy == "scopedRole":
        parent = data.get("parent")
        child = data.get("child")
        if not isinstance(parent, dict) or not isinstance(child, dict):
            raise ValueError("scopedRole requires both a parent and a child definition")
        return _apply(_apply(root, parent), child)

    name = data.get("name") or None
    exact = data.get("exact")
    value = data.get("value") or ""
    selector = data.get("selector") or ""

    if strategy == "role":
        role = data.get("role")
        if not role:
            raise ValueError("role locator requires a role")
        kwargs: dict[str, Any] = {}
        if name:
            kwargs["name"] = name
            if exact is not None:
                kwargs["exact"] = bool(exact)
        return root.get_by_role(role, **kwargs)  # type: ignore[arg-type]
    if strategy == "label":
        return root.get_by_label(value, exact=bool(exact))
    if strategy == "placeholder":
        return root.get_by_placeholder(value, exact=bool(exact))
    if strategy == "text":
        return root.get_by_text(value, exact=bool(exact))
    if strategy == "testId":
        if data.get("attribute") == "data-testid" and value:
            return root.get_by_test_id(value)
        if not selector:
            raise ValueError("testId locator requires a selector or a data-testid value")
        return root.locator(selector)
    if strategy in {"name", "css", "xpath"}:
        if not selector:
            raise ValueError(f"{strategy} locator requires a selector")
        return root.locator(selector)
    raise ValueError(f"unknown locator strategy '{strategy}'")


def validate_candidate(
    page: Page,
    candidate: LocatorCandidate,
    expected: dict[str, Any],
) -> LocatorCandidate:
    """Probe one candidate and record the verdict on it (mutates + returns it).

    Args:
        page: The page the scan is running against.
        candidate: The candidate to validate.
        expected: The scanned element it was generated for — at minimum
            ``uid``, ``tagName``, ``inferredRole`` and the ``states`` map.
    """
    try:
        locator = build_locator(page, candidate.locator_data)
        probe = locator.evaluate_all(
            _PROBE_JS, {"uidAttr": UID_ATTRIBUTE, "limit": MAX_INSPECTED_MATCHES}
        )
    except (PlaywrightError, ValueError) as exc:
        candidate.valid = False
        candidate.unique = False
        candidate.match_count = 0
        candidate.warnings.append(f"Locator could not be evaluated: {exc}")
        return candidate

    total = int(probe.get("total", 0))
    matches: list[dict[str, Any]] = probe.get("matches", [])
    candidate.match_count = total

    if total == 0:
        candidate.valid = False
        candidate.unique = False
        candidate.warnings.append("Matched no elements on the page")
        return candidate

    first = matches[0] if matches else {}
    expected_uid = expected.get("uid", "")
    candidate.identity_match = bool(expected_uid) and first.get("uid") == expected_uid
    matched_here = any(m.get("uid") == expected_uid for m in matches)

    expected_states = expected.get("states", {}) or {}
    candidate.visible_match = bool(first.get("visible")) == bool(
        expected_states.get("visible", True)
    )
    candidate.enabled_match = bool(first.get("enabled")) == bool(
        expected_states.get("enabled", True)
    )

    if candidate.identity_match:
        candidate.role_match = True
        candidate.name_match = True
    else:
        expected_tag = (expected.get("tagName") or "").lower()
        expected_role = (expected.get("explicitRole") or "").lower()
        candidate.role_match = (
            first.get("tag") == expected_tag
            and (first.get("role") or "").lower() == expected_role
        )
        # Without an identity match the accessible name cannot be assumed
        # equal; the scorer treats `None` as "unproven", not "equal".
        candidate.name_match = None

    if total == 1:
        # A single match that is a *different* element is a wrong locator, not
        # a unique one — never let it be recommended (§11).
        if candidate.identity_match:
            candidate.valid = True
            candidate.unique = True
            candidate.reasons.append("Matched exactly one element — the intended one")
        else:
            candidate.valid = False
            candidate.unique = False
            candidate.warnings.append(
                "Matched a single but different element; the locator is ambiguous "
                "with another part of the page"
            )
        return candidate

    candidate.valid = True
    candidate.unique = False
    candidate.warnings.append(
        f"Matched {total} elements; scope it to a parent container to make it unique"
    )
    if not matched_here:
        candidate.warnings.append("None of the inspected matches is the intended element")
        candidate.valid = False
    return candidate


def validate_candidates(
    page: Page,
    candidates: list[LocatorCandidate],
    expected: dict[str, Any],
) -> list[LocatorCandidate]:
    """Validate every candidate generated for one element."""
    return [validate_candidate(page, candidate, expected) for candidate in candidates]
