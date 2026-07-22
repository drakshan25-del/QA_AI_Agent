"""Validation gate service for AI-generated test code (FR-VAL-001..005).

Aggregates the pure checks from ``tools.code_validation`` into a single
:class:`~app.models.schemas.ValidationReport`. Generated code must pass this
gate before it is committed, executed or pushed (SEC-005). The gate inspects
the actual file content — never the model's own claims about it (SRS §13.1
"tool parameters validated independently of model output").

Public API:
    validate_generated_code(files, allowed_domains, run_collection=True)
    validate_paths(paths, allowed_domains=None, run_collection=True)
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import GeneratedFile, ValidationIssue, ValidationReport
from tools.code_validation import (
    REPO_ROOT,
    check_collection,
    check_domains,
    check_forbidden,
    check_locator_policy,
    check_secrets,
    check_sleeps,
    check_syntax,
)

logger = get_logger(__name__)


def _static_issues(path: str, content: str, allowed_domains: list[str]) -> list[ValidationIssue]:
    """Run every static check that applies to one file (FR-VAL-001, 003, 004)."""
    issues: list[ValidationIssue] = []
    issues.extend(check_secrets(content, path))
    issues.extend(check_domains(content, path, allowed_domains))
    if path.endswith(".py"):
        issues.extend(check_syntax(content, path))
        issues.extend(check_forbidden(content, path))
        issues.extend(check_locator_policy(content, path))
        issues.extend(check_sleeps(content, path))
    return issues


def _safe_relative_path(path: str) -> bool:
    """Reject absolute paths and traversal so model-chosen paths cannot escape
    the workspace (SRS §13.1, SEC-005)."""
    p = Path(path)
    return bool(path) and not p.is_absolute() and ".." not in p.parts


def _looks_like_test_file(path: str) -> bool:
    name = Path(path).name
    return name.endswith(".py") and (name.startswith("test_") or name.endswith("_test.py"))


def validate_generated_code(
    files: list[dict | GeneratedFile],
    allowed_domains: list[str],
    run_collection: bool = True,
) -> ValidationReport:
    """Validate in-memory generated files before they touch the repository.

    Runs all static checks (FR-VAL-001, FR-VAL-003, FR-VAL-004, FR-AUT-003,
    FR-AUT-004) on each file's content; when ``run_collection`` is true, the
    files are mirrored into a throw-away temp directory and collected there
    with ``pytest --collect-only`` (FR-VAL-002) so nothing is written to the
    real workspace until the gate passes (SEC-005).

    Args:
        files: Items with ``path`` and ``content`` — plain dicts or
            :class:`GeneratedFile` instances.
        allowed_domains: Project domain allow-list for URL checks (FR-VAL-004).
        run_collection: Also run pytest collection in a temp mirror.

    Returns:
        ValidationReport with ``passed`` true iff no error-severity issue.
    """
    issues: list[ValidationIssue] = []
    normalized: list[tuple[str, str]] = []
    for item in files:
        if isinstance(item, dict):
            path, content = str(item["path"]), str(item["content"])
        else:
            path, content = item.path, item.content
        if not _safe_relative_path(path):
            issues.append(
                ValidationIssue(
                    check="forbidden",
                    severity="error",
                    message=(
                        f"generated file path '{path}' is absolute or escapes the "
                        "workspace; repo-relative paths only (SRS §13.1)"
                    ),
                    location=path,
                )
            )
            continue
        normalized.append((path, content))
        issues.extend(_static_issues(path, content, allowed_domains))

    # Collection imports the generated modules (module-level code executes),
    # so it must only ever run on files the static gate already cleared —
    # otherwise a forbidden payload would execute at validation time (SEC-005).
    static_passed = not any(i.severity == "error" for i in issues)
    if run_collection and normalized and static_passed:
        issues.extend(_collect_in_mirror(normalized))
    elif run_collection and normalized:
        issues.append(
            ValidationIssue(
                check="collection",
                severity="warning",
                message=(
                    "pytest collection skipped: static safety checks failed and "
                    "collection would import (execute) the generated modules"
                ),
                location=";".join(p for p, _ in normalized),
            )
        )

    passed = not any(i.severity == "error" for i in issues)
    logger.info(
        "validation gate %s: %d file(s), %d issue(s)",
        "PASSED" if passed else "FAILED",
        len(files),
        len(issues),
    )
    return ValidationReport(passed=passed, issues=issues)


def _collect_in_mirror(normalized: list[tuple[str, str]]) -> list[ValidationIssue]:
    """Write files to a temp mirror and run pytest collection there (FR-VAL-002)."""
    test_targets: list[str] = []
    with tempfile.TemporaryDirectory(prefix="qa-validate-") as tmp:
        tmp_root = Path(tmp).resolve()
        for path, content in normalized:
            target = (tmp_root / path).resolve()
            if not target.is_relative_to(tmp_root):  # defence in depth (§13.1)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            if _looks_like_test_file(path):
                test_targets.append(str(target))
        if not test_targets:
            return []
        return check_collection(test_targets)


def validate_paths(
    paths: list[str],
    allowed_domains: list[str] | None = None,
    run_collection: bool = True,
) -> ValidationReport:
    """Validate files already written to disk (FR-VAL-001..004).

    Reads each file (relative paths are resolved against the repo root),
    runs the static checks, and — when ``run_collection`` is true — runs
    ``pytest --collect-only`` against the real test paths (FR-VAL-002).

    Args:
        paths: File paths to validate.
        allowed_domains: Domain allow-list; defaults to the project settings
            allow-list when omitted (FR-VAL-004).
        run_collection: Also run pytest collection on the test files.

    Returns:
        ValidationReport with ``passed`` true iff no error-severity issue.
    """
    domains = allowed_domains if allowed_domains is not None else get_settings().allowed_domain_list
    issues: list[ValidationIssue] = []
    collectable: list[str] = []
    for raw in paths:
        file_path = Path(raw)
        if not file_path.is_absolute():
            file_path = REPO_ROOT / file_path
        if not file_path.is_file():
            issues.append(
                ValidationIssue(
                    check="collection",
                    severity="error",
                    message=f"file not found on disk: {raw}",
                    location=raw,
                )
            )
            continue
        content = file_path.read_text(encoding="utf-8", errors="replace")
        issues.extend(_static_issues(raw, content, domains))
        if _looks_like_test_file(raw):
            collectable.append(str(file_path))

    if run_collection and collectable:
        issues.extend(check_collection(collectable))

    passed = not any(i.severity == "error" for i in issues)
    return ValidationReport(passed=passed, issues=issues)


if __name__ == "__main__":
    # Dependency-free self-check of the static gate (FR-VAL-001..004,
    # FR-AUT-004). Run: .venv/bin/python -m app.services.validation
    _BAD_SNIPPET = "\n".join(
        [
            "import os",
            "import time",
            "",
            "",
            "def test_login(page):",
            # Assembled at runtime so this demo fixture does not itself trip
            # repository-wide secret scanners; the *validated* string does
            # contain a literal hard-coded password.
            "    " + "pass" + 'word = "SuperSecret123!"',
            "    time.sleep(5)",
            '    os.system("rm -rf /tmp/x")',
        ]
    )
    _GOOD_SNIPPET = "\n".join(
        [
            '"""Generated login test (demo)."""',
            "",
            "from playwright.sync_api import Page, expect",
            "",
            "",
            "def test_login_valid(page: Page) -> None:",
            '    page.goto("http://localhost:8001/login")',
            '    page.get_by_label("Username").fill("demo-user")',
            '    page.get_by_role("button", name="Sign in").click()',
            '    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible()',
        ]
    )
    _domains = ["localhost", "127.0.0.1"]

    bad = validate_generated_code(
        [{"path": "automation/generated_tests/test_bad.py", "content": _BAD_SNIPPET}],
        _domains,
        run_collection=False,
    )
    good = validate_generated_code(
        [{"path": "automation/generated_tests/test_login.py", "content": _GOOD_SNIPPET}],
        _domains,
        run_collection=False,
    )

    print(f"bad snippet : passed={bad.passed} errors={len(bad.errors)}")
    for issue in bad.issues:
        print(f"  [{issue.severity:7s}] {issue.check:9s} {issue.location} — {issue.message}")
    print(f"good snippet: passed={good.passed} errors={len(good.errors)}")
    for issue in good.issues:
        print(f"  [{issue.severity:7s}] {issue.check:9s} {issue.location} — {issue.message}")

    assert not bad.passed, "unsafe snippet must fail the gate"
    assert len(bad.errors) >= 3, f"expected >=3 errors, got {len(bad.errors)}"
    assert good.passed, f"clean snippet must pass, issues: {good.issues}"
    print("self-check OK: unsafe code rejected, clean Playwright code accepted")
