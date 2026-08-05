"""Trusted locator-code construction for automation generation (FR-UIS-025 §6).

Generated Playwright code must contain *only* locators the UI Scanner
discovered and validated. That guarantee needs two things, and this module is
both of them:

* **A builder.** A locator's Playwright code is *rendered from* its
  machine-readable ``locator_data`` — role, name, label, frame chain, parent
  scope — through the same renderers the scanner itself uses. The stored
  expression string is never parsed, never evaluated, never turned back into
  behaviour (SEC-005: there is no ``eval`` anywhere in this feature).

* **A detector.** After the model returns code, every locator call in that code
  is extracted and checked against the set of locators the model was actually
  given. Anything else is an invented selector, and invented selectors are the
  precise failure this integration exists to prevent (§12).

The detector is deliberately syntactic rather than semantic: it walks the
generated source, follows each ``page…`` locator chain with balanced-paren
tracking, and compares the chain to the allowed set. It cannot be talked out of
a verdict by a persuasive comment.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from engine.uiscanner.locator_generator import render_expression, render_python

#: Strategies a stored locator may use (mirrors LOCATOR_STRATEGIES).
VALID_STRATEGIES = frozenset(
    {
        "role",
        "label",
        "testId",
        "placeholder",
        "text",
        "scopedRole",
        "name",
        "css",
        "xpath",
    }
)

#: Deepest a scoped locator may nest before it is rejected as malformed.
MAX_NESTING_DEPTH = 3

#: Longest frame chain a locator may address.
MAX_FRAME_DEPTH = 5

#: Playwright methods that *narrow* a locator; a chain continues through them.
#:
#: The camelCase spellings are here because a model that answers in TypeScript
#: must not slip past this check: its locators are just as invented, and a
#: `.ts`-shaped answer written into a `.py` file is how one did exactly that.
LOCATOR_METHODS = (
    "frame_locator",
    "get_by_role",
    "get_by_label",
    "get_by_placeholder",
    "get_by_text",
    "get_by_test_id",
    "get_by_alt_text",
    "get_by_title",
    "locator",
    "filter",
    "nth",
    "first",
    "last",
    "frameLocator",
    "getByRole",
    "getByLabel",
    "getByPlaceholder",
    "getByText",
    "getByTestId",
    "getByAltText",
    "getByTitle",
)

#: Methods on `page`/`frame` whose FIRST argument is a raw selector string.
#:
#: These are the quiet hole in a chain-based check. `page.fill("#email", value)`
#: never looks like a locator chain — there is no `.locator(...)` in it — yet it
#: addresses an element by a selector nobody scanned. Playwright offers a
#: selector-shorthand for most actions, so every one of them has to be named.
SELECTOR_ARGUMENT_METHODS = (
    "fill",
    "click",
    "dblclick",
    "check",
    "uncheck",
    "hover",
    "press",
    "type",
    "tap",
    "focus",
    "select_option",
    "set_input_files",
    "set_checked",
    "drag_and_drop",
    "wait_for_selector",
    "query_selector",
    "query_selector_all",
    "is_visible",
    "is_hidden",
    "is_enabled",
    "is_disabled",
    "is_checked",
    "is_editable",
    "text_content",
    "input_value",
    "get_attribute",
    "inner_text",
    "inner_html",
    "dispatch_event",
    # camelCase spellings, for an answer written in TypeScript.
    "dblClick",
    "selectOption",
    "setInputFiles",
    "setChecked",
    "dragAndDrop",
    "waitForSelector",
    "querySelector",
    "querySelectorAll",
    "isVisible",
    "isHidden",
    "isEnabled",
    "isDisabled",
    "isChecked",
    "isEditable",
    "textContent",
    "inputValue",
    "getAttribute",
    "innerText",
    "innerHTML",
    "dispatchEvent",
)

_SELECTOR_CALL_RE = re.compile(
    r"\b(?:self\.)?(?:page|frame)\s*\.\s*"
    r"(?P<method>" + "|".join(SELECTOR_ARGUMENT_METHODS) + r"|\$\$?)\s*\(\s*"
    r"(?P<quote>['\"])(?P<selector>(?:[^'\"\\]|\\.)*)(?P=quote)"
)

#: Roots a locator chain can start from in generated code.
_CHAIN_ROOT_RE = re.compile(r"\b(?:self\.page|page)\b")


class InventedLocatorError(ValueError):
    """Raised when generated code contains a locator that was never scanned."""

    def __init__(self, offenders: list[str]) -> None:
        self.offenders = offenders
        super().__init__(
            "generated code contains "
            f"{len(offenders)} locator(s) that are not in SCANNED_LOCATORS: "
            + "; ".join(offenders[:5])
        )


def validate_locator_data(data: Any, depth: int = 0) -> dict[str, Any]:
    """Check that a locator description is one this system can rebuild.

    Raises:
        ValueError: When the description names an unknown strategy, is missing
            the fields that strategy needs, or nests beyond the supported
            depth. A locator that cannot be rebuilt is never generated from.
    """
    if not isinstance(data, dict):
        raise ValueError("locator data must be an object")
    if depth > MAX_NESTING_DEPTH:
        raise ValueError("locator is nested too deeply")

    strategy = data.get("strategy")
    if strategy not in VALID_STRATEGIES:
        raise ValueError(f"unsupported locator strategy {strategy!r}")

    if strategy == "scopedRole":
        parent, child = data.get("parent"), data.get("child")
        if not isinstance(parent, dict) or not isinstance(child, dict):
            raise ValueError("a scoped locator needs both a parent and a child")
        validate_locator_data(parent, depth + 1)
        validate_locator_data(child, depth + 1)
    elif strategy == "role":
        if not data.get("role"):
            raise ValueError("a role locator needs a role")
    elif strategy in {"label", "placeholder", "text"}:
        if not data.get("value"):
            raise ValueError(f"a {strategy} locator needs a value")
    elif strategy == "testId":
        if not data.get("value") and not data.get("selector"):
            raise ValueError("a test-id locator needs a value or a selector")
    elif not data.get("selector"):
        raise ValueError(f"a {strategy} locator needs a selector")

    if depth == 0:
        frame = data.get("frame") or {}
        path = frame.get("path") or [] if isinstance(frame, dict) else []
        if len(path) > MAX_FRAME_DEPTH:
            raise ValueError("locator addresses more than five nested frames")
        for selector in path:
            if not isinstance(selector, str) or not selector:
                raise ValueError("frame path entries must be non-empty selectors")
    return data


def build_python_expression(locator_data: dict[str, Any], root: str = "page") -> str:
    """Sync-Python Playwright code for a validated locator (this repo's form)."""
    return render_python(validate_locator_data(locator_data), root)


def build_ts_expression(locator_data: dict[str, Any], root: str = "page") -> str:
    """TypeScript Playwright code for a validated locator (display form)."""
    return render_expression(validate_locator_data(locator_data), root)


# ---------------------------------------------------------------------------
# Invention detection (§12)
# ---------------------------------------------------------------------------


def normalise_expression(expression: str) -> str:
    """Compare locator chains without tripping over formatting.

    Whitespace and quote style are the two things that differ between what the
    scanner rendered and what a model pastes back, and neither changes which
    element is addressed.
    """
    collapsed = re.sub(r"\s+", "", expression or "")
    return collapsed.replace("'", '"')


#: Internal alias kept for readability inside this module.
_normalise = normalise_expression


def _chain_suffix(expression: str) -> str:
    """The locator chain with its root (``page``) removed, normalised."""
    normalised = _normalise(expression)
    match = re.search(r"\bpage\b", normalised)
    return normalised[match.end() :] if match else normalised


def _consume_call(source: str, index: int) -> int:
    """Return the index just past a balanced ``(...)`` starting at ``index``."""
    depth = 0
    in_string: str | None = None
    while index < len(source):
        char = source[index]
        if in_string:
            if char == "\\":
                index += 2
                continue
            if char == in_string:
                in_string = None
        elif char in "\"'":
            in_string = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return index


def strip_comments(code: str) -> str:
    """Blank out Python comments, leaving string literals untouched.

    Needed because a locator only matters if it *runs*: a chain quoted inside a
    ``# NO APPROVED LOCATOR MATCHED`` note is a diagnostic, not a
    selector. The string tracking is not optional — ``#`` is the first
    character of every id selector, so a naive split would corrupt
    ``page.locator("#login")`` into a comment.
    """
    out: list[str] = []
    index = 0
    quote: str | None = None
    while index < len(code):
        char = code[index]
        if quote:
            out.append(char)
            if char == "\\" and index + 1 < len(code):
                out.append(code[index + 1])
                index += 2
                continue
            if code.startswith(quote, index):
                index += len(quote)
                out.append(code[index - len(quote) + 1 : index])
                quote = None
                continue
            index += 1
            continue
        if char in "\"'":
            triple = code[index : index + 3]
            quote = triple if triple in ('"""', "'''") else char
            out.append(code[index : index + len(quote)])
            index += len(quote)
            continue
        if char == "#":
            end = code.find("\n", index)
            if end == -1:
                break
            index = end
            continue
        out.append(char)
        index += 1
    return "".join(out)


def extract_locator_chains(code: str) -> list[str]:
    """Every ``page…`` locator chain in a block of generated Python.

    A chain ends at the first call that is not a locator method — ``.click()``,
    ``.fill()``, ``expect(...)`` and friends act *on* a locator rather than
    narrowing one, so they are where the locator itself stops. Comments are
    ignored: they do not execute.
    """
    chains: list[str] = []
    code = strip_comments(code)
    for root in _CHAIN_ROOT_RE.finditer(code):
        cursor = root.end()
        chain = code[root.start() : root.end()]
        while True:
            rest = code[cursor:]
            match = re.match(r"\s*\.\s*([A-Za-z_]\w*)", rest)
            if not match:
                break
            method = match.group(1)
            if method not in LOCATOR_METHODS:
                break
            after_name = cursor + match.end()
            # `.first` / `.last` are properties in the sync API: no call to eat.
            if method in {"first", "last"}:
                chain += f".{method}"
                cursor = after_name
                continue
            paren = re.match(r"\s*\(", code[after_name:])
            if not paren:
                break
            end = _consume_call(code, after_name + paren.end() - 1)
            chain += code[cursor:end]
            cursor = end
        if chain.strip() not in {"page", "self.page"}:
            chains.append(chain)
    return chains


def find_invented_locators(code: str, allowed: Iterable[str]) -> list[str]:
    """Locator chains in ``code`` that are not in the allowed set (§12).

    A chain counts as allowed when it matches a scanned locator exactly, or
    when it is a *prefix* of one — a page object that stores
    ``page.get_by_role("region", name="Profile")`` and narrows it to the Save
    button later is still addressing scanned ground.

    The prefix rule is one-directional on purpose. Extending a scanned locator
    (``….nth(2)``, ``….filter(has_text=…)``) narrows it to something the
    scanner never validated, which is exactly the fabrication this check
    exists to catch (§3 "do not automatically use .nth()").
    """
    allowed_list = [expression for expression in allowed if expression]
    allowed_suffixes = {_chain_suffix(expression) for expression in allowed_list}
    allowed_suffixes.discard("")
    offenders: list[str] = []
    for chain in extract_locator_chains(code):
        suffix = _chain_suffix(chain)
        if not suffix:
            continue
        if any(candidate.startswith(suffix) for candidate in allowed_suffixes):
            continue
        offenders.append(re.sub(r"\s+", " ", chain).strip())
    offenders.extend(find_selector_shorthand(code, allowed_list))
    return offenders


def find_selector_shorthand(code: str, allowed: Iterable[str]) -> list[str]:
    """Raw-selector calls such as ``page.fill("#email", value)`` (§12).

    A scanned locator is always a structured locator object, so a selector
    handed straight to an action is by construction one the scanner never
    validated. The one exception is a selector that appears verbatim inside an
    allowed expression — a stored `css` or `testId` locator addressing the same
    thing — which is scanned ground reached a clumsier way.
    """
    allowed_text = " ".join(allowed)
    offenders: list[str] = []
    for match in _SELECTOR_CALL_RE.finditer(strip_comments(code)):
        selector = match.group("selector")
        if selector and selector in allowed_text:
            continue
        offenders.append(
            f'page.{match.group("method")}({match.group("quote")}{selector}{match.group("quote")})'
        )
    return offenders


def assert_only_scanned_locators(code: str, allowed: Iterable[str]) -> None:
    """Raise :class:`InventedLocatorError` when the model invented a locator."""
    offenders = find_invented_locators(code, allowed)
    if offenders:
        raise InventedLocatorError(offenders)
