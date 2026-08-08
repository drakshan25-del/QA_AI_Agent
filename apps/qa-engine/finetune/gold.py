"""Expand :mod:`finetune.seeds` specs into gold training labels.

Produces exactly the structures the agents must emit at inference time:
``TestCasesOutput`` / ``TestPlanOutput`` dicts for the planner model and
``AutomationOutput`` dicts (page objects + pytest files following every
framework rule) for the coder model. All output is deterministic.
"""

from __future__ import annotations

from finetune.seeds import Feature, FormField, case_id, pascal, slugify

XSS_PAYLOAD = "<script>alert(1)</script>"


# ---------------------------------------------------------------------------
# Test cases (planner gold)
# ---------------------------------------------------------------------------


def _entry_step(f: FormField, value: str) -> str:
    verb = {
        "select": "Select", "checkbox": "Tick", "file": "Attach",
    }.get(f.kind, "Enter")
    if f.kind == "checkbox":
        return f"Tick the '{f.label}' checkbox."
    if f.kind == "file":
        return f"Attach the file {value} to '{f.label}'."
    return f"{verb} '{value}' into the '{f.label}' field."


def _valid_value(f: FormField) -> str:
    if f.secret_env:
        return f.secret_env
    return f.valid_example or "N/A"


def _base_steps(feature: Feature, overrides: dict[str, str | None]) -> list[str]:
    """Numbered steps filling every field with its valid value unless
    overridden; an override of ``None`` means 'leave the field empty'."""
    steps = [f"Navigate to {feature.path}."]
    for f in feature.fields:
        if f.attr in overrides and overrides[f.attr] is None:
            steps.append(f"Leave the '{f.label}' field empty.")
            continue
        value = overrides.get(f.attr) or _valid_value(f)
        if not f.required and f.attr not in overrides:
            continue  # optional fields are only filled when the case needs them
        steps.append(_entry_step(f, value))
    steps.append(f"Click the '{feature.submit_label}' button.")
    return [f"{i}. {s}" for i, s in enumerate(steps, start=1)]


def _base_data(feature: Feature, overrides: dict[str, str | None]) -> dict[str, str]:
    data: dict[str, str] = {}
    for f in feature.fields:
        if f.attr in overrides:
            value = overrides[f.attr]
            data[f.label] = "(empty)" if value is None else value
        elif f.required:
            data[f.label] = _valid_value(f)
    return data or {"data": "N/A"}


def _success_expectation(feature: Feature) -> list[str]:
    if feature.success_kind == "message":
        return [f'The page shows "{feature.success_text}".']
    if feature.success_kind == "redirect":
        return [
            f"The browser is redirected to {feature.success_path}.",
            f'The "{feature.success_text}" heading is visible.',
        ]
    return [f"{feature.success_text}."]


def _preconditions(feature: Feature) -> list[str]:
    return [feature.precondition or "The application is reachable."]


def make_cases(feature: Feature) -> list[dict]:
    """10+ §8.5 test cases across categories, TestCaseOutput-shaped."""
    cases: list[dict] = []

    def add(title: str, objective: str, category: str, priority: str,
            steps: list[str], expected: list[str], data: dict[str, str],
            suitability: str = "automatable") -> None:
        key = f"TC-{len(cases) + 1:03d}"
        cases.append({
            "case_key": key,
            "requirement_ids": [feature.req_id],
            "title": title,
            "objective": objective,
            "category": category,
            "priority": priority,
            "preconditions": _preconditions(feature),
            "test_data": data,
            "steps": steps,
            "expected_results": expected,
            "automation_suitability": suitability,
        })

    # Positive path.
    add(
        f"{feature.name}: valid submission succeeds",
        f"Prove that a {feature.actor} completes {feature.name.lower()} with valid input.",
        "positive", "critical",
        _base_steps(feature, {}), _success_expectation(feature), _base_data(feature, {}),
    )

    # Free-text search features get search-behaviour cases (only when the
    # query is a text field — select-driven searches get field cases instead).
    if feature.success_kind == "results" and feature.fields[0].kind == "text":
        term, gibberish = feature.results_terms
        add(
            f"{feature.name}: no matches shows the empty state",
            "Prove the empty state appears when nothing matches the query.",
            "negative", "high",
            _base_steps(feature, {feature.fields[0].attr: gibberish}),
            [f'The page shows "{feature.empty_results_text}".'],
            _base_data(feature, {feature.fields[0].attr: gibberish}),
        )
        add(
            f"{feature.name}: query matching is case-insensitive",
            "Prove that letter case does not change the result set.",
            "positive", "medium",
            _base_steps(feature, {feature.fields[0].attr: term.upper()}),
            [f"{feature.success_text} for '{term}' regardless of case."],
            _base_data(feature, {feature.fields[0].attr: term.upper()}),
        )
        add(
            f"{feature.name}: surrounding whitespace is ignored",
            "Prove leading/trailing spaces in the query are trimmed before matching.",
            "validation", "low",
            _base_steps(feature, {feature.fields[0].attr: f"  {term}  "}),
            [f"{feature.success_text}, identical to searching for '{term}'."],
            _base_data(feature, {feature.fields[0].attr: f"  {term}  "}),
        )

    # One negative case per required field.
    for f in feature.fields:
        if not (f.required and f.error_required):
            continue
        label = "unticked" if f.kind == "checkbox" else "empty"
        add(
            f"{feature.name}: {f.label} {label} is rejected",
            f"Prove submission is blocked when '{f.label}' is missing.",
            "negative", "high",
            _base_steps(feature, {f.attr: None}),
            [f'The page shows "{f.error_required}".', "The form is not submitted."],
            _base_data(feature, {f.attr: None}),
        )

    # Validation cases for fields with an invalid example.
    for f in feature.fields:
        if not (f.error_invalid and f.invalid_example):
            continue
        add(
            f"{feature.name}: invalid {f.label} is rejected",
            f"Prove '{f.label}' rejects a malformed value.",
            "validation", "high",
            _base_steps(feature, {f.attr: f.invalid_example}),
            [f'The page shows "{f.error_invalid}".'],
            _base_data(feature, {f.attr: f.invalid_example}),
        )

    # Boundary cases for numeric ranges and length limits.
    for f in feature.fields:
        if f.kind == "number" and f.min_value is not None and f.max_value is not None:
            add(
                f"{feature.name}: {f.label} at the minimum ({f.min_value}) is accepted",
                f"Prove the inclusive lower bound of '{f.label}'.",
                "boundary", "medium",
                _base_steps(feature, {f.attr: str(f.min_value)}),
                _success_expectation(feature),
                _base_data(feature, {f.attr: str(f.min_value)}),
            )
            add(
                f"{feature.name}: {f.label} above the maximum ({f.max_value}) is rejected",
                f"Prove the inclusive upper bound of '{f.label}'.",
                "boundary", "medium",
                _base_steps(feature, {f.attr: str(f.max_value + 1)}),
                [f'The page shows "{f.error_invalid}".'],
                _base_data(feature, {f.attr: str(f.max_value + 1)}),
            )
        elif f.max_len and f.error_invalid and f.kind in ("text", "textarea"):
            add(
                f"{feature.name}: {f.label} over {f.max_len} characters is rejected",
                f"Prove the {f.max_len}-character limit of '{f.label}'.",
                "boundary", "medium",
                _base_steps(feature, {f.attr: f"a string of {f.max_len + 1} characters"}),
                [f'The page shows "{f.error_invalid}".'],
                _base_data(feature, {f.attr: f"{f.max_len + 1} chars"}),
            )

    if feature.roles:
        privileged, unprivileged = feature.roles[0], feature.roles[-1]
        add(
            f"{feature.name}: {unprivileged} role is denied",
            f"Prove a {unprivileged} cannot perform this {privileged}-only action.",
            "role_based", "high",
            [f"1. Sign in with a {unprivileged} account.",
             f"2. Navigate to {feature.path}.",
             f"3. Attempt to use '{feature.submit_label}'."],
            [f'The page shows "{feature.role_error}".'],
            {"role": unprivileged},
            suitability="needs_review",
        )

    if feature.duplicate_error:
        add(
            f"{feature.name}: duplicate submission is rejected",
            "Prove resubmitting the same data is refused.",
            "error_handling", "medium",
            _base_steps(feature, {}) + [f"{len(_base_steps(feature, {})) + 1}. Repeat the submission with identical data."],
            [f'The page shows "{feature.duplicate_error}".'],
            _base_data(feature, {}),
            suitability="needs_review",
        )

    if feature.server_error:
        add(
            f"{feature.name}: backend failure shows a safe error",
            "Prove a server-side failure is reported without data loss.",
            "error_handling", "medium",
            [f"1. Simulate a backend failure for {feature.path}.",
             "2. Submit the form with valid data."],
            [f'The page shows "{feature.server_error}".'],
            {"data": "N/A"},
            suitability="manual_only",
        )

    if feature.security_error:
        target = next(
            (f for f in feature.fields if f.kind in ("text", "textarea")),
            feature.fields[0],
        )
        add(
            f"{feature.name}: script markup in {target.label} is rejected",
            f"Prove '{target.label}' rejects HTML/script injection attempts.",
            "security", "high",
            _base_steps(feature, {target.attr: XSS_PAYLOAD}),
            [f'The page shows "{feature.security_error}".',
             "The payload is never rendered as markup."],
            _base_data(feature, {target.attr: XSS_PAYLOAD}),
        )

    return cases


# ---------------------------------------------------------------------------
# Test plan (planner gold)
# ---------------------------------------------------------------------------


def make_plan(app: str, base_url: str, features: list[Feature]) -> dict:
    """TestPlanOutput-shaped dict for one app's requirement set."""
    req_list = ", ".join(f.req_id for f in features)
    has_security = any(f.security_error for f in features)
    has_secrets = any(any(ff.secret_env for ff in f.fields) for f in features)
    has_roles = any(f.roles for f in features)
    has_search = any(f.success_kind == "results" for f in features)

    objectives = [
        f"Demonstrate that every supplied {app} requirement ({req_list}) meets its acceptance criteria before release.",
    ] + [
        f"Verify {f.name.lower()} ({f.req_id}) end to end, including its validation and error behaviour."
        for f in features
    ]
    scope = [f"[{f.req_id}] {f.name} — {f.path}" for f in features]
    exclusions = [
        "Performance and load testing — no throughput or latency targets were supplied with these requirements.",
        "Native mobile applications — the requirements describe the web UI only.",
        "Backend data migrations — outside the scope of the supplied requirements.",
    ]
    test_types = [
        f"UI: every requirement ({req_list}) describes browser-facing forms and messages, so UI testing is the primary type.",
        "regression: validation messages and success flows are re-run on every build to catch behaviour drift.",
        "smoke: the happy path of each flow forms a fast gate before deeper suites run.",
    ]
    if has_secrets or has_security:
        test_types.append(
            "security: flows handle credentials or reject injected markup, so negative security probes are required."
        )
    if has_roles:
        test_types.append(
            "security: role-gated actions must be verified as denied for unprivileged roles."
        )
    if has_search:
        test_types.append(
            "integration: search results depend on backend indexing, so UI checks run against seeded data."
        )
    test_types.append(
        "accessibility: all forms are label-driven; controls must be reachable by keyboard and announced by screen readers."
    )

    environments = [
        f"Local test environment at {base_url} with seeded, resettable data.",
        "Playwright browsers: Chromium (primary), plus Firefox and WebKit for cross-browser regression.",
        "One clean browser context per test; no shared session state between tests.",
    ]
    test_data = [
        "Seeded test account referenced only through environment variables (QA_TEST_USERNAME / QA_TEST_PASSWORD).",
    ] + [
        f"{f.name}: {', '.join(sorted({ff.label for ff in f.fields if ff.required}))} values seeded per the acceptance criteria."
        for f in features if f.fields
    ]
    entry_criteria = [
        f"The {app} build under test is deployed and reachable at {base_url}.",
        "All supplied requirements and their analyses are approved.",
        "Seed data and test accounts are provisioned.",
    ]
    exit_criteria = [
        "100% of approved test cases executed.",
        "All critical and high priority cases pass; no open critical defects.",
        f"Requirement coverage is 100% across {req_list}.",
    ]
    risks = [
        "Validation messages may change wording during development — mitigated by reviewing copy with each build.",
        "Seeded data drift can break deterministic assertions — mitigated by resetting data before each run.",
    ]
    if has_roles:
        risks.append("Role misconfiguration could hide permission defects — mitigated by dedicated role-based cases.")
    if has_secrets:
        risks.append("Credential leakage in logs — mitigated by referencing secrets only via environment variables.")
    deliverables = [
        "Approved test plan (this document) and requirement-linked test cases.",
        "Automated Playwright suites for the automatable cases.",
        "Execution reports with pass/fail metrics and evidence per run.",
        "Defect reports for failed cases with reproduction steps.",
    ]
    return {
        "objectives": objectives,
        "scope": scope,
        "exclusions": exclusions,
        "test_types": test_types,
        "environments": environments,
        "test_data": test_data,
        "entry_criteria": entry_criteria,
        "exit_criteria": exit_criteria,
        "risks": risks,
        "deliverables": deliverables,
    }


# ---------------------------------------------------------------------------
# Automation (coder gold)
# ---------------------------------------------------------------------------


def po_module(feature: Feature) -> str:
    return f"{feature.key}_page"


def po_class(feature: Feature) -> str:
    return f"{pascal(feature.key)}Page"


def make_page_object(feature: Feature) -> str:
    cls = po_class(feature)
    lines: list[str] = [
        "from playwright.sync_api import Locator, Page",
        "",
        "from automation.pages.base_page import BasePage",
        "",
        "",
        f"class {cls}(BasePage):",
        f'    path = "{feature.path}"',
        "",
        "    def __init__(self, page: Page, base_url: str) -> None:",
        "        super().__init__(page, base_url)",
        f'        self.heading: Locator = self.by_role("heading", name="{feature.heading}")',
    ]
    for f in feature.fields:
        lines.append(
            f'        self.{f.attr}_field: Locator = self.by_label("{f.label}")'
        )
    lines.append(
        f'        self.submit_button: Locator = self.by_role("button", name="{feature.submit_label}")'
    )
    lines.append('        self.error_message: Locator = self.by_role("alert")')
    if feature.success_kind == "results":
        lines.append('        self.results: Locator = self.by_test_id("results")')
        lines.append('        self.empty_message: Locator = self.by_role("status")')
    else:
        lines.append('        self.success_message: Locator = self.by_role("status")')
    lines.append("")
    for f in feature.fields:
        if f.kind == "select":
            lines += [
                f"    def select_{f.attr}(self, value: str) -> None:",
                f'        self.select(self.{f.attr}_field, value, label="{f.label}")',
                "",
            ]
        elif f.kind == "checkbox":
            lines += [
                f"    def check_{f.attr}(self) -> None:",
                f'        self.check(self.{f.attr}_field, label="{f.label}")',
                "",
            ]
        elif f.kind == "file":
            lines += [
                f"    def attach_{f.attr}(self, file_path: str) -> None:",
                f'        self.upload(self.{f.attr}_field, file_path, label="{f.label}")',
                "",
            ]
        else:
            lines += [
                f"    def enter_{f.attr}(self, value: str) -> None:",
                f'        self.fill(self.{f.attr}_field, value, label="{f.label}")',
                "",
            ]
    lines += [
        "    def submit(self) -> None:",
        f'        self.click(self.submit_button, label="{feature.submit_label}")',
    ]
    return "\n".join(lines) + "\n"


def _code_value(f: FormField) -> str:
    """Python expression for a field's valid value inside a test.

    Passwords are never literals (FR-AUT-005): seeded secrets come from the
    ``credentials`` fixture and new-password fields derive from it.
    """
    if f.from_credentials:
        return f"credentials.{f.from_credentials}"
    if f.secret_env == "QA_TEST_PASSWORD" or (f.kind == "password" and not f.secret_env):
        return "credentials.password"
    if f.secret_env:
        return 'credentials.password + "-N3w!"'
    return repr(f.valid_example or "value")


def _fill_lines(feature: Feature, overrides: dict[str, str | None],
                required_only: bool = True) -> list[str]:
    lines: list[str] = []
    for f in feature.fields:
        if f.attr in overrides and overrides[f.attr] is None:
            if f.kind in ("checkbox", "select", "file"):
                continue  # leaving these untouched IS the empty state
            lines.append(f"    pg.enter_{f.attr}('')")
            continue
        override = overrides.get(f.attr)
        if override is None and required_only and not f.required:
            continue
        if override is not None and override.startswith("__REPEAT__:"):
            value_expr = f'"A" * {int(override.split(":", 1)[1])}'
        elif override is not None and f.kind == "password":
            # An intentionally-invalid password sample must still not look
            # like a real credential literal (FR-AUT-005 / SEC-002).
            value_expr = f'"x" * {len(override)}'
        else:
            value_expr = repr(override) if override is not None else _code_value(f)
        if f.kind == "select":
            lines.append(f"    pg.select_{f.attr}({value_expr})")
        elif f.kind == "checkbox":
            lines.append(f"    pg.check_{f.attr}()")
        elif f.kind == "file":
            lines.append(f'    sample = tmp_path / {repr(f.valid_example or "upload.pdf")}')
            lines.append('    sample.write_text("generated test payload")')
            lines.append(f"    pg.attach_{f.attr}(str(sample))")
        else:
            lines.append(f"    pg.enter_{f.attr}({value_expr})")
    return lines


def _success_assert_lines(feature: Feature) -> list[str]:
    if feature.success_kind == "message":
        return [f"    expect(pg.success_message).to_contain_text({repr(feature.success_text)})"]
    if feature.success_kind == "redirect":
        return [f"    pg.assert_url_contains({repr(feature.success_path)})"]
    return ["    expect(pg.results).to_be_visible()"]


def make_test_file(feature: Feature, cases: list[dict], include_req: bool) -> tuple[str, list[str]]:
    """Gold pytest file for the automatable UI cases; returns (source, case ids)."""
    cls, mod = po_class(feature), po_module(feature)
    uses_tmp = any(f.kind == "file" for f in feature.fields)
    fixtures = "page: Page, base_url: str, credentials, target_available"
    if uses_tmp:
        fixtures += ", tmp_path"

    covered: list[str] = []
    blocks: list[str] = []
    seen_names: set[str] = set()
    for case in cases:
        if case["automation_suitability"] != "automatable":
            continue
        title = case["title"]
        fn = "test_" + slugify(title.split(":", 1)[-1])[:60].strip("_")
        while fn in seen_names:
            fn += "_2"
        seen_names.add(fn)
        req_comment = ",".join(case["requirement_ids"]) if include_req else "N/A"
        body: list[str] = [
            f"# TC: {case['case_key']} {title}",
            f"# REQ: {req_comment}",
            f"def {fn}({fixtures}) -> None:",
            f"    pg = {cls}(page, base_url)",
            "    pg.goto()",
        ]
        overrides = _overrides_for_case(feature, case)
        body += _fill_lines(feature, overrides)
        body.append("    pg.submit()")
        body += _assert_lines_for_case(feature, case)
        blocks.append("\n".join(body))
        covered.append(case_id(feature.key, case["case_key"]))

    header = [
        "import pytest",
        "from playwright.sync_api import Page, expect",
        "",
        f"from automation.pages.{mod} import {cls}",
        "",
        "pytestmark = [pytest.mark.generated]",
        "",
        "",
    ]
    return "\n".join(header) + "\n\n\n".join(blocks) + "\n", covered


def _overrides_for_case(feature: Feature, case: dict) -> dict[str, str | None]:
    """Reverse-engineer the input overrides a gold case encodes."""
    title = case["title"]
    category = case["category"]
    if category == "positive" and "case-insensitive" in title:
        return {feature.fields[0].attr: feature.results_terms[0].upper()}
    if category == "validation" and "whitespace" in title:
        return {feature.fields[0].attr: f"  {feature.results_terms[0]}  "}
    if category == "negative" and "empty state" in title:
        return {feature.fields[0].attr: feature.results_terms[1]}
    if category in ("negative",):
        f = _field_by_title(feature, title)
        return {f.attr: None} if f else {}
    if category == "validation":
        f = _field_by_title(feature, title)
        return {f.attr: f.invalid_example} if f else {}
    if category == "boundary":
        f = _field_by_title(feature, title)
        if f is None:
            return {}
        if "minimum" in title:
            return {f.attr: str(f.min_value)}
        if "maximum" in title:
            return {f.attr: str((f.max_value or 0) + 1)}
        if f.max_len:
            return {f.attr: f"__REPEAT__:{f.max_len + 1}"}
        return {}
    if category == "security":
        f = _field_by_title(feature, title)
        return {f.attr: XSS_PAYLOAD} if f else {}
    return {}


def _field_by_title(feature: Feature, title: str) -> FormField | None:
    best: FormField | None = None
    for f in feature.fields:
        if f.label in title and (best is None or len(f.label) > len(best.label)):
            best = f
    return best


def _assert_lines_for_case(feature: Feature, case: dict) -> list[str]:
    category = case["category"]
    title = case["title"]
    if category == "positive" or (category == "boundary" and "minimum" in title):
        return _success_assert_lines(feature)
    if category == "validation" and "whitespace" in title:
        return ["    expect(pg.results).to_be_visible()"]
    if "empty state" in title:
        return [f"    expect(pg.empty_message).to_contain_text({repr(feature.empty_results_text)})"]
    f = _field_by_title(feature, title)
    if category == "negative":
        msg = f.error_required if f else ""
    elif category == "security":
        msg = feature.security_error
    else:
        msg = f.error_invalid if f else ""
    return [f"    expect(pg.error_message).to_contain_text({repr(msg)})"]


def make_automation_output(
    feature: Feature, cases: list[dict], emit_page_object: bool, include_req: bool,
) -> dict:
    """AutomationOutput-shaped dict: test file plus (optionally) its page object."""
    code_cases = [c for c in cases if c["automation_suitability"] == "automatable"]
    test_src, covered = make_test_file(feature, code_cases, include_req)
    files = [{
        "path": f"automation/generated_tests/test_{feature.key}.py",
        "kind": "test_file",
        "content": test_src,
        "test_case_ids": covered,
    }]
    if emit_page_object:
        files.insert(0, {
            "path": f"automation/pages/{po_module(feature)}.py",
            "kind": "page_object",
            "content": make_page_object(feature),
            "test_case_ids": [],
        })
    notes = (
        f"Covered {len(covered)} automatable case(s) for {feature.name}. "
        "Cases marked manual_only or needs_review (role switching, forced backend "
        "failures, duplicate-state setups) were intentionally not automated."
    )
    return {"files": files, "notes": notes}


def prompt_cases(feature: Feature, cases: list[dict], include_req: bool) -> list[dict]:
    """Serialise gold cases exactly the way the backend sends them to the
    automation endpoint (id/case_key/title/steps/expected_results/test_data/
    preconditions, optionally requirement_ids)."""
    out: list[dict] = []
    for c in cases:
        if c["automation_suitability"] != "automatable":
            continue
        row = {
            "id": case_id(feature.key, c["case_key"]),
            "case_key": c["case_key"],
            "title": c["title"],
            "steps": c["steps"],
            "expected_results": c["expected_results"],
            "test_data": c["test_data"],
            "preconditions": c["preconditions"],
        }
        if include_req:
            row["requirement_ids"] = c["requirement_ids"]
        out.append(row)
    return out
