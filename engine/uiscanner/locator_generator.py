"""Locator candidate generation (§9, §10, §13).

For every discovered element this module proposes several ways to reach it,
ordered by how well each survives a UI change:

    role + accessible name > label > test id > placeholder > scoped semantic
    > visible text > name attribute > stable id > CSS attribute > relative CSS
    > XPath

Every candidate carries two representations:

* ``expression`` / ``python_expression`` — displayable Playwright code, shown
  in the UI and pasted into generated tests;
* ``locator_data`` — a machine-readable description the validator rebuilds
  through the Playwright API. The expression string is *never* executed
  (SEC-005: no ``eval``, no string-to-code path anywhere in this package).

Fragile shapes are not silently emitted: framework-generated ids, hashed CSS
module classes, index-based selection and absolute XPath are either skipped or
kept with an explicit warning and a scoring penalty.
"""

from __future__ import annotations

import re
from typing import Any

from engine.uiscanner.types import (
    MAX_CANDIDATES_PER_ELEMENT,
    FrameDefinition,
    LocatorCandidate,
)

#: Base scores per strategy (§12). Adjustments are applied after validation.
BASE_SCORES: dict[str, float] = {
    "role": 100,
    "label": 95,
    "testId": 92,
    "placeholder": 85,
    "scopedRole": 82,
    "text": 75,
    "name": 65,
    "css": 60,  # stable id
    "cssAttribute": 50,
    "relativeCss": 35,
    "xpath": 15,
}

#: Roles whose accessible name is normally authored and stable enough to key on.
NAMEABLE_ROLES = frozenset(
    {
        "button",
        "link",
        "textbox",
        "searchbox",
        "checkbox",
        "radio",
        "combobox",
        "listbox",
        "option",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "tab",
        "switch",
        "slider",
        "spinbutton",
        "heading",
        "dialog",
        "alertdialog",
        "region",
        "cell",
        "columnheader",
        "rowheader",
        "img",
        "progressbar",
        "status",
        "alert",
        "treeitem",
        # Landmarks and containers: naming them is what makes scoped locators
        # possible, so they must be reachable by role + name too (§13).
        "navigation",
        "main",
        "form",
        "banner",
        "contentinfo",
        "complementary",
        "group",
        "list",
        "listitem",
        "row",
        "table",
        "grid",
        "gridcell",
        "tabpanel",
        "menu",
        "menubar",
        "toolbar",
        "article",
        "figure",
        "tree",
        "treegrid",
    }
)

#: Elements whose visible text is a reasonable locator key.
TEXT_TAGS = frozenset({"a", "button", "summary", "option", "label", "td", "th", "li"})

#: Longest visible text still usable as a `getByText` key.
MAX_TEXT_LENGTH = 60

#: Scoped candidates offered per element, nearest container first.
MAX_SCOPED_CANDIDATES = 2

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
_LONG_DIGITS_RE = re.compile(r"\d{4,}")
_HEX_CHUNK_RE = re.compile(r"\b[0-9a-f]{8,}\b", re.IGNORECASE)
_MIXED_HASH_RE = re.compile(r"^(?=.*[a-z])(?=.*\d)[a-z0-9]{7,}$", re.IGNORECASE)

#: Prefixes emitted by UI frameworks; such ids change on every render.
_FRAMEWORK_ID_PREFIXES = (
    "mui-",
    "radix-",
    "headlessui-",
    "ember",
    "ng-",
    "react-select-",
    "react-aria-",
    "downshift-",
    "rc_select_",
    "rc-tabs-",
    "chakra-",
    "mantine-",
    "aria-selection",
    "__next",
    "cdk-",
)

#: CSS-in-JS / CSS-module class shapes that carry a build hash.
_RANDOM_CLASS_RE = (
    re.compile(r"^css-[a-z0-9]{5,}$", re.IGNORECASE),
    re.compile(r"^sc-[A-Za-z0-9]{5,}$"),
    re.compile(r"^jsx-\d{4,}$"),
    re.compile(r"^[\w-]+__[A-Za-z0-9]{5,}$"),  # Block__hash
    re.compile(r"^[\w-]+_[\w-]+__[A-Za-z0-9]{4,}$"),  # Block_element__hash
    re.compile(r"^_[A-Za-z0-9]{5,}$"),
)

#: Utility-first frameworks emit many non-identifying classes.
_UTILITY_CLASS_RE = re.compile(
    # The responsive/state variant is optional: `px-4` is as much a utility
    # class as `sm:px-4`, and neither identifies an element.
    r"^(?:(?:sm|md|lg|xl|2xl|hover|focus|active|dark|group|peer):)?"
    r"(?:[mp][trblxy]?-\d|w-|h-|text-|bg-|border|flex|grid|gap-|items-|justify-|"
    r"rounded|shadow|font-|leading-|space-|overflow-|absolute|relative|fixed|"
    r"inline|block|hidden|z-|opacity-|cursor-|transition|transform|col-|row-)",
    re.IGNORECASE,
)


# --- stability heuristics ---------------------------------------------------


def is_dynamic_id(value: str) -> tuple[bool, str]:
    """Classify an ``id`` as framework-generated/unstable (§12 penalties)."""
    ident = (value or "").strip()
    if not ident:
        return True, "empty id"
    if len(ident) > 60:
        return True, "id is unusually long"
    low = ident.lower()
    if low.startswith(":") and low.endswith(":"):
        return True, "React useId-style identifier"
    if any(low.startswith(prefix) for prefix in _FRAMEWORK_ID_PREFIXES):
        return True, "framework-generated id prefix"
    if _UUID_RE.search(ident):
        return True, "id contains a UUID"
    if _LONG_DIGITS_RE.search(ident):
        return True, "id contains a long numeric run"
    if _HEX_CHUNK_RE.search(ident):
        return True, "id contains a hash-like segment"
    if ident.isdigit():
        return True, "numeric id"
    return False, ""


def is_random_class(value: str) -> bool:
    """True when a class name carries a build hash or is a layout utility."""
    cls = (value or "").strip()
    if not cls or len(cls) < 3:
        return True
    if any(pattern.match(cls) for pattern in _RANDOM_CLASS_RE):
        return True
    if _UTILITY_CLASS_RE.match(cls):
        return True
    return bool(_MIXED_HASH_RE.match(cls))


def usable_classes(classes: list[str]) -> list[str]:
    """Semantic-looking classes worth trying, most specific first."""
    return [c for c in classes if not is_random_class(c)][:3]


# --- rendering --------------------------------------------------------------


def _ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _py_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _css_attr_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _xpath_literal(value: str) -> str:
    """XPath 1.0 has no escape syntax; concat() covers mixed quoting."""
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    parts = [f"'{piece}'" for piece in value.split("'")]
    return "concat(" + ', "\'", '.join(parts) + ")"


def render_expression(data: dict[str, Any], root: str = "page") -> str:
    """Render ``locator_data`` as displayable TypeScript Playwright code."""
    frame = data.get("frame") or {}
    prefix = root
    for selector in frame.get("path", []) or []:
        prefix += f".frameLocator({_ts_string(selector)})"
    return prefix + _render_chain_ts(data)


def _render_chain_ts(data: dict[str, Any]) -> str:
    strategy = data.get("strategy")
    if strategy == "scopedRole":
        return _render_chain_ts(data["parent"]) + _render_chain_ts(data["child"])
    name = data.get("name") or ""
    exact = data.get("exact")
    value = data.get("value") or ""
    selector = data.get("selector") or ""
    if strategy == "role":
        args = [_ts_string(data.get("role") or "")]
        if name:
            opts = f"name: {_ts_string(name)}"
            if exact is not None:
                opts += f", exact: {'true' if exact else 'false'}"
            args.append("{ " + opts + " }")
        return f".getByRole({', '.join(args)})"
    if strategy == "label":
        return f".getByLabel({_ts_string(value)}, {{ exact: true }})"
    if strategy == "placeholder":
        return f".getByPlaceholder({_ts_string(value)}, {{ exact: true }})"
    if strategy == "text":
        return f".getByText({_ts_string(value)}, {{ exact: true }})"
    if strategy == "testId":
        if data.get("attribute") == "data-testid":
            return f".getByTestId({_ts_string(value)})"
        return f".locator({_ts_string(selector)})"
    return f".locator({_ts_string(selector)})"


def render_python(data: dict[str, Any], root: str = "page") -> str:
    """Render ``locator_data`` as sync-Python Playwright code (this repo's tests)."""
    frame = data.get("frame") or {}
    prefix = root
    for selector in frame.get("path", []) or []:
        prefix += f".frame_locator({_py_string(selector)})"
    return prefix + _render_chain_py(data)


def _render_chain_py(data: dict[str, Any]) -> str:
    strategy = data.get("strategy")
    if strategy == "scopedRole":
        return _render_chain_py(data["parent"]) + _render_chain_py(data["child"])
    name = data.get("name") or ""
    exact = data.get("exact")
    value = data.get("value") or ""
    selector = data.get("selector") or ""
    if strategy == "role":
        args = [_py_string(data.get("role") or "")]
        if name:
            args.append(f"name={_py_string(name)}")
            if exact is not None:
                args.append(f"exact={'True' if exact else 'False'}")
        return f".get_by_role({', '.join(args)})"
    if strategy == "label":
        return f".get_by_label({_py_string(value)}, exact=True)"
    if strategy == "placeholder":
        return f".get_by_placeholder({_py_string(value)}, exact=True)"
    if strategy == "text":
        return f".get_by_text({_py_string(value)}, exact=True)"
    if strategy == "testId":
        if data.get("attribute") == "data-testid":
            return f".get_by_test_id({_py_string(value)})"
        return f".locator({_py_string(selector)})"
    return f".locator({_py_string(selector)})"


# --- generation -------------------------------------------------------------


def _definition(
    strategy: str,
    *,
    role: str | None = None,
    name: str | None = None,
    exact: bool | None = None,
    value: str | None = None,
    selector: str | None = None,
    attribute: str | None = None,
) -> dict[str, Any]:
    """One link in a locator chain (no frame — the frame lives on the root)."""
    return {
        "strategy": strategy,
        "role": role,
        "name": name,
        "exact": exact,
        "value": value,
        "selector": selector,
        "attribute": attribute,
    }


def _candidate(
    element_key: str,
    ordinal: int,
    strategy: str,
    data: dict[str, Any],
    frame: FrameDefinition | None,
    base_score: float,
    reasons: list[str],
    warnings: list[str] | None = None,
) -> LocatorCandidate:
    payload = dict(data)
    payload["frame"] = frame.to_dict() if frame and frame.path else None
    return LocatorCandidate(
        id=f"{element_key}-c{ordinal}",
        strategy=strategy,  # type: ignore[arg-type]
        expression=render_expression(payload),
        python_expression=render_python(payload),
        locator_data=payload,
        base_score=base_score,
        reasons=reasons,
        warnings=warnings or [],
    )


def generate_candidates(
    element: dict[str, Any],
    element_key: str,
    frame: FrameDefinition | None = None,
) -> list[LocatorCandidate]:
    """Produce ranked-by-strategy locator candidates for one scanned element.

    The list is ordered by base score and truncated to
    ``MAX_CANDIDATES_PER_ELEMENT``; the validator later decides which of them
    actually resolve, and the scorer produces the final ranking.
    """
    out: list[LocatorCandidate] = []
    ordinal = 0

    def add(
        strategy: str,
        data: dict[str, Any],
        base: float,
        reasons: list[str],
        warnings: list[str] | None = None,
    ) -> None:
        nonlocal ordinal
        ordinal += 1
        out.append(
            _candidate(element_key, ordinal, strategy, data, frame, base, reasons, warnings)
        )

    role = (element.get("inferredRole") or "").strip()
    name = (element.get("accessibleName") or "").strip()
    tag = (element.get("tagName") or "").strip()
    input_type = (element.get("inputType") or "").strip()
    label = (element.get("context", {}) or {}).get("associatedLabel", "").strip()
    placeholder = (element.get("placeholder") or "").strip()
    visible_text = (element.get("visibleText") or "").strip()
    test_ids: dict[str, str] = element.get("testIds") or {}
    scopes: list[dict[str, Any]] = (element.get("context", {}) or {}).get("scopes", [])

    # 1. Role + accessible name — the most change-resistant locator.
    if role and name and role in NAMEABLE_ROLES:
        add(
            "role",
            _definition("role", role=role, name=name, exact=True),
            BASE_SCORES["role"],
            [f"Accessibility role '{role}' with the accessible name '{name}'"],
        )

    # 2. Associated <label> — the semantics a user reads on a form.
    if label and tag in {"input", "textarea", "select"}:
        add(
            "label",
            _definition("label", value=label, exact=True),
            BASE_SCORES["label"],
            [f"Form control labelled '{label}'"],
        )

    # 3. Explicit testing contract.
    for attribute in ("data-testid", "data-test", "data-cy"):
        value = (test_ids.get(attribute) or "").strip()
        if not value:
            continue
        add(
            "testId",
            _definition(
                "testId",
                value=value,
                attribute=attribute,
                selector=f'[{attribute}="{_css_attr_value(value)}"]',
            ),
            BASE_SCORES["testId"],
            [f"Explicit testing contract via {attribute}"],
        )
        break

    # 4. Placeholder — authored text, weaker than a label but still semantic.
    if placeholder and tag in {"input", "textarea"}:
        add(
            "placeholder",
            _definition("placeholder", value=placeholder, exact=True),
            BASE_SCORES["placeholder"],
            [f"Placeholder text '{placeholder}'"],
        )

    # 5. Scoped semantic locator — the preferred answer to duplicates (§13).
    #    The two nearest named containers are both offered: the nearest usually
    #    disambiguates a repeated control (a table row), while the next one out
    #    covers the case where the nearest container has an unstable name.
    if role and name and scopes:
        named_scopes = [s for s in scopes if s.get("name")][:MAX_SCOPED_CANDIDATES]
        for scope in named_scopes:
            # A container is matched on a short distinctive label with
            # `exact=False` (Playwright's substring match). Demanding the whole
            # accessible name exactly is what makes row scoping fail the moment
            # a column is added or reordered.
            scope_label = (scope.get("label") or "").strip()
            scope_name = scope_label or scope["name"]
            add(
                "scopedRole",
                {
                    "strategy": "scopedRole",
                    "parent": _definition(
                        "role",
                        role=scope["role"],
                        name=scope_name,
                        exact=not scope_label,
                    ),
                    "child": _definition("role", role=role, name=name, exact=True),
                },
                BASE_SCORES["scopedRole"],
                [
                    f"Scoped to the {scope['role']} '{scope_name}' so duplicates "
                    "elsewhere on the page cannot match"
                ],
            )

    # 6. Visible text — for links/buttons whose label *is* their text.
    if (
        visible_text
        and len(visible_text) <= MAX_TEXT_LENGTH
        and (tag in TEXT_TAGS or element.get("states", {}).get("clickable"))
    ):
        add(
            "text",
            _definition("text", value=visible_text, exact=True),
            BASE_SCORES["text"],
            [f"Visible text '{visible_text}'"],
        )

        # …and the same text scoped to its container, for elements that have no
        # role to key on. Without this, a label repeated elsewhere on the page
        # has nothing semantic left and falls all the way through to XPath.
        for scope in [s for s in scopes if s.get("name")][:1]:
            scope_label = (scope.get("label") or "").strip()
            scope_name = scope_label or scope["name"]
            add(
                "scopedRole",
                {
                    "strategy": "scopedRole",
                    "parent": _definition(
                        "role",
                        role=scope["role"],
                        name=scope_name,
                        exact=not scope_label,
                    ),
                    "child": _definition("text", value=visible_text, exact=True),
                },
                BASE_SCORES["scopedRole"] - 5,
                [
                    f"Visible text '{visible_text}' scoped to the {scope['role']} "
                    f"'{scope_name}'"
                ],
            )

    # 7. Stable name attribute — a server-side contract, survives restyling.
    name_attr = (element.get("name") or "").strip()
    if name_attr:
        selector = f'{tag}[name="{_css_attr_value(name_attr)}"]'
        add(
            "name",
            _definition("name", selector=selector, value=name_attr),
            BASE_SCORES["name"],
            [f"Form field name attribute '{name_attr}'"],
        )

    # 8. Stable CSS id.
    element_id = (element.get("id") or "").strip()
    if element_id:
        dynamic, why = is_dynamic_id(element_id)
        selector = f'{tag}[id="{_css_attr_value(element_id)}"]'
        if dynamic:
            add(
                "css",
                _definition("css", selector=selector, value=element_id),
                BASE_SCORES["css"],
                [f"Element id '{element_id}'"],
                [f"The id looks generated ({why}) and may change between builds"],
            )
        else:
            add(
                "css",
                _definition("css", selector=selector, value=element_id),
                BASE_SCORES["css"],
                [f"Stable element id '{element_id}'"],
            )

    # 9. CSS attribute selector built from stable, meaningful attributes.
    attribute_parts: list[str] = []
    if tag == "input" and input_type:
        attribute_parts.append(f'[type="{_css_attr_value(input_type)}"]')
    if element.get("ariaLabel"):
        attribute_parts.append(f'[aria-label="{_css_attr_value(element["ariaLabel"])}"]')
    if tag == "a" and element.get("href"):
        href = str(element["href"])
        if len(href) <= 120 and not href.startswith("javascript:"):
            attribute_parts.append(f'[href="{_css_attr_value(href)}"]')
    if attribute_parts:
        add(
            "css",
            _definition("css", selector=tag + "".join(attribute_parts)),
            BASE_SCORES["cssAttribute"],
            ["Attribute selector built from stable element attributes"],
        )

    # 10. Relative CSS from semantic classes — fragile, kept as a fallback.
    classes = usable_classes(element.get("classes") or [])
    if classes:
        selector = tag + "".join(f".{c}" for c in classes)
        add(
            "css",
            _definition("css", selector=selector),
            BASE_SCORES["relativeCss"],
            ["Relative CSS from semantic class names"],
            ["CSS classes are presentational and change with restyling"],
        )

    # 11. XPath — last resort only, and always relative, never absolute.
    if visible_text and len(visible_text) <= MAX_TEXT_LENGTH:
        expr = f"//{tag}[normalize-space(.)={_xpath_literal(visible_text)}]"
    elif name_attr:
        expr = f"//{tag}[@name={_xpath_literal(name_attr)}]"
    else:
        expr = ""
    if expr:
        add(
            "xpath",
            _definition("xpath", selector=f"xpath={expr}"),
            BASE_SCORES["xpath"],
            ["Relative XPath fallback"],
            ["XPath couples the test to the DOM structure; prefer a semantic locator"],
        )

    out.sort(key=lambda c: c.base_score, reverse=True)
    return out[:MAX_CANDIDATES_PER_ELEMENT]
