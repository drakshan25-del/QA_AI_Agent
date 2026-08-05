"""Static safety and quality checks for generated test code (FR-VAL-001..005).

Every check function is pure with respect to the code under inspection: it
receives source text (plus context) and returns ``list[ValidationIssue]``.
Nothing in this module calls the LLM — the validation gate inspects the
actual generated artefacts independently of any model-reported status
(SRS §13.1 "tool parameters validated independently of model output",
SEC-005).

Checks:
    check_syntax          FR-VAL-001  ``ast.parse``.
    check_collection      FR-VAL-002  ``pytest --collect-only`` subprocess.
    check_forbidden       FR-VAL-003  dangerous calls / imports / shell strings.
    check_secrets         FR-VAL-003  hard-coded credentials.
    check_domains         FR-VAL-004  URL allow-list enforcement.
    check_locator_policy  FR-AUT-003  brittle locators (warnings).
    check_sleeps          FR-AUT-004  fixed waits are forbidden.
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path

from app.core.security import extract_urls, find_secrets, is_domain_allowed, redact_secrets
from app.models.schemas import ValidationIssue

REPO_ROOT = Path(__file__).resolve().parent.parent
_VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"

# ---------------------------------------------------------------------------
# FR-VAL-001: syntax
# ---------------------------------------------------------------------------


def check_syntax(code: str, filename: str) -> list[ValidationIssue]:
    """Parse the code with ``ast.parse`` and report syntax errors (FR-VAL-001).

    Args:
        code: Python source text.
        filename: Repo-relative path used in issue locations.

    Returns:
        One error-severity issue per syntax failure (at most one; ast stops
        at the first error), empty list if the code parses.
    """
    try:
        ast.parse(code, filename=filename)
    except SyntaxError as exc:
        return [
            ValidationIssue(
                check="syntax",
                severity="error",
                message=f"SyntaxError: {exc.msg}",
                location=f"{filename}:{exc.lineno or 0}",
            )
        ]
    return []


# ---------------------------------------------------------------------------
# FR-VAL-003 / SEC-005: forbidden constructs
# ---------------------------------------------------------------------------

_FORBIDDEN_MODULES = {"subprocess", "socket", "ctypes", "importlib", "runpy", "multiprocessing"}

# Fully-qualified callables that must never appear in generated tests.
_FORBIDDEN_CALLS = {
    "os.system": "os.system executes arbitrary shell commands",
    "os.popen": "os.popen executes arbitrary shell commands",
    "os.remove": "os.remove deletes files outside the sandbox",
    "os.unlink": "os.unlink deletes files outside the sandbox",
    "os.rmdir": "os.rmdir deletes directories outside the sandbox",
    "shutil.rmtree": "shutil.rmtree recursively deletes directories",
    "pickle.loads": "pickle.loads deserialises untrusted data (code execution)",
    "pickle.load": "pickle.load deserialises untrusted data (code execution)",
    "socket.socket": "raw socket access is not allowed in generated tests",
}

_FORBIDDEN_BUILTINS = {
    "eval": "eval() executes dynamic code",
    "exec": "exec() executes dynamic code",
    "compile": "compile() builds dynamic code objects",
    "__import__": "__import__ enables dynamic module loading",
    # Dynamic attribute access defeats the static call analysis (e.g.
    # getattr(os, 'sys' + 'tem')), so it is not allowed in generated tests.
    "getattr": "getattr() enables dynamic attribute access that bypasses static checks",
    "setattr": "setattr() enables dynamic attribute mutation",
    "delattr": "delattr() enables dynamic attribute deletion",
    "globals": "globals() exposes the module namespace for dynamic access",
    "locals": "locals() exposes the local namespace for dynamic access",
    "vars": "vars() exposes object namespaces for dynamic access",
}

# Filesystem-mutating methods flagged on ANY receiver: a static gate cannot
# resolve `Path("/etc/x").write_text(...)` (the receiver is a call result),
# so these method names are refused outright in generated tests (SEC-005).
_FORBIDDEN_METHODS = {
    "write_text": "Path.write_text writes files outside the open() sandbox check",
    "write_bytes": "Path.write_bytes writes files outside the open() sandbox check",
    "unlink": "unlink deletes files",
    "rmdir": "rmdir deletes directories",
    "rename": "rename moves files on disk",
    "replace": "replace overwrites files on disk",
    "chmod": "chmod changes file permissions",
    "symlink_to": "symlink_to creates filesystem links",
    "hardlink_to": "hardlink_to creates filesystem links",
    "rmtree": "recursive directory deletion is forbidden",
}

# Directories generated code may legitimately write into (FR-VAL-003).
_ALLOWED_WRITE_ROOTS = ("artifacts", "reports", "automation")

_WRITE_MODE_CHARS = set("wax+")

# Regex-only patterns that the AST cannot see (strings / encoded payloads).
_RM_RF_RE = re.compile(r"\brm\s+-[a-z]*[rf][a-z]*[rf][a-z]*\b")
_B64_DECODE_RE = re.compile(r"\bb(?:16|32|64|85)decode\b")
_DYNAMIC_EXEC_RE = re.compile(r"\b(?:exec|eval|compile)\s*\(")

# Fallback textual patterns used only when the source does not parse, so a
# syntactically broken file still cannot smuggle dangerous calls past the gate.
_FALLBACK_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bos\.system\s*\("), "os.system executes arbitrary shell commands"),
    (re.compile(r"\bsubprocess\b"), "subprocess usage is forbidden in generated tests"),
    (re.compile(r"\beval\s*\("), "eval() executes dynamic code"),
    (re.compile(r"\bexec\s*\("), "exec() executes dynamic code"),
    (re.compile(r"\bshutil\.rmtree\s*\("), "shutil.rmtree recursively deletes directories"),
    (re.compile(r"\bos\.(remove|unlink|rmdir)\s*\("), "os file/directory deletion is forbidden"),
    (re.compile(r"\b(import\s+socket|socket\.socket)\b"), "raw socket access is forbidden"),
    (re.compile(r"\bctypes\b"), "ctypes enables arbitrary native calls"),
    (re.compile(r"\bpickle\.loads?\s*\("), "pickle deserialisation is forbidden"),
    (re.compile(r"\b__import__\s*\("), "__import__ enables dynamic module loading"),
    (re.compile(r"\bimportlib\b"), "importlib enables dynamic module loading"),
    (re.compile(r"\bgetattr\s*\("), "getattr() enables dynamic attribute access"),
    (re.compile(r"\.write_(?:text|bytes)\s*\("), "Path write methods are forbidden"),
    (re.compile(r"\.(?:unlink|rmdir|rename|replace|chmod|symlink_to|hardlink_to)\s*\("),
     "filesystem mutation methods are forbidden"),
]


def _code_part(line: str) -> str:
    """Best-effort strip of a trailing comment so commented-out mentions do not flag."""
    return line.split("#", 1)[0]


def _scan_lines(
    code: str,
    patterns: list[tuple[re.Pattern[str], str]],
    check: str,
    severity: str,
    filename: str,
) -> list[ValidationIssue]:
    """Match line-oriented regex patterns and emit one issue per hit."""
    issues: list[ValidationIssue] = []
    for lineno, line in enumerate(code.splitlines(), start=1):
        stripped = _code_part(line)
        for pattern, message in patterns:
            if pattern.search(stripped):
                issues.append(
                    ValidationIssue(
                        check=check,
                        severity=severity,
                        message=message,
                        location=f"{filename}:{lineno}",
                    )
                )
    return issues


def _dotted_name(node: ast.AST) -> str:
    """Return the dotted name of an Attribute/Name chain, or '' if dynamic."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return ""


def _write_path_allowed(raw: str) -> bool:
    """True if a string-literal write target stays inside the sandboxed dirs.

    Allowed roots are ``artifacts/``, ``reports/`` and ``automation/``
    (FR-VAL-003). Absolute paths are allowed only when they resolve inside
    those roots under the repository.
    """
    p = raw.replace("\\", "/")
    if p.startswith("./"):
        p = p[2:]
    if p.startswith("/"):
        try:
            p = Path(p).resolve().relative_to(REPO_ROOT).as_posix()
        except ValueError:
            return False
    if ".." in Path(p).parts:
        return False
    return p.split("/", 1)[0] in _ALLOWED_WRITE_ROOTS


class _ForbiddenVisitor(ast.NodeVisitor):
    """AST walker collecting forbidden imports and calls (FR-VAL-003)."""

    def __init__(self, filename: str) -> None:
        self.filename = filename
        self.issues: list[ValidationIssue] = []
        # local name -> fully-qualified name, so aliased imports are caught
        # (e.g. ``import os as o`` / ``from os import system as run_cmd``).
        self.aliases: dict[str, str] = {}

    def _add(self, message: str, node: ast.AST) -> None:
        self.issues.append(
            ValidationIssue(
                check="forbidden",
                severity="error",
                message=message,
                location=f"{self.filename}:{getattr(node, 'lineno', 0)}",
            )
        )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            self.aliases[alias.asname or alias.name.split(".")[0]] = root
            if root in _FORBIDDEN_MODULES:
                self._add(f"import of forbidden module '{root}'", node)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = (node.module or "").split(".")[0]
        if module in _FORBIDDEN_MODULES:
            self._add(f"import from forbidden module '{module}'", node)
        for alias in node.names:
            qualified = f"{module}.{alias.name}" if module else alias.name
            self.aliases[alias.asname or alias.name] = qualified
            if qualified in _FORBIDDEN_CALLS:
                self._add(f"import of forbidden callable '{qualified}'", node)
        self.generic_visit(node)

    def _resolve(self, dotted: str) -> str:
        if not dotted:
            return dotted
        head, _, rest = dotted.partition(".")
        full = self.aliases.get(head, head)
        return f"{full}.{rest}" if rest else full

    def visit_Call(self, node: ast.Call) -> None:
        name = self._resolve(_dotted_name(node.func))
        if name in _FORBIDDEN_BUILTINS:
            self._add(_FORBIDDEN_BUILTINS[name], node)
        elif name in _FORBIDDEN_CALLS:
            self._add(_FORBIDDEN_CALLS[name], node)
        elif name.split(".")[0] in _FORBIDDEN_MODULES:
            self._add(f"call into forbidden module '{name.split('.')[0]}'", node)
        elif name in {"open", "io.open"}:
            self._check_open(node)
        elif isinstance(node.func, ast.Attribute) and node.func.attr in _FORBIDDEN_METHODS:
            # Catches receivers the resolver cannot name, e.g. Path(...).write_text.
            self._add(_FORBIDDEN_METHODS[node.func.attr], node)
        elif isinstance(node.func, ast.Attribute) and node.func.attr == "open" and not name:
            # Path(...).open(mode) — same sandbox rules as builtin open();
            # the mode is the first positional argument for the method form.
            self._check_open(node, mode_arg_index=0, path_from_receiver=True)
        self.generic_visit(node)

    def _check_open(
        self,
        node: ast.Call,
        *,
        mode_arg_index: int = 1,
        path_from_receiver: bool = False,
    ) -> None:
        """Flag write-mode open() targeting paths outside the sandbox dirs.

        Handles both the builtin form ``open(path, mode)`` and the method
        form ``Path(...).open(mode)`` (``mode_arg_index=0``, path taken from
        the receiver expression, which is dynamic by definition).
        """
        mode: str | None = "r"
        if len(node.args) > mode_arg_index:
            arg = node.args[mode_arg_index]
            mode = arg.value if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else None
        for kw in node.keywords:
            if kw.arg == "mode":
                v = kw.value
                mode = v.value if isinstance(v, ast.Constant) and isinstance(v.value, str) else None
        if mode is None:
            self._add("open() with a dynamic mode cannot be verified as read-only", node)
            return
        if not _WRITE_MODE_CHARS.intersection(mode):
            return  # read-only open is fine
        target = None if path_from_receiver else (node.args[0] if node.args else None)
        if isinstance(target, ast.Constant) and isinstance(target.value, str):
            if not _write_path_allowed(target.value):
                self._add(
                    f"open('{target.value}', '{mode}') writes outside "
                    "artifacts/, reports/ or automation/",
                    node,
                )
        else:
            self._add(
                f"open(..., '{mode}') with a dynamic path cannot be verified "
                "to stay inside artifacts/, reports/ or automation/",
                node,
            )


def check_forbidden(code: str, filename: str) -> list[ValidationIssue]:
    """Scan for dangerous constructs via AST plus regex (FR-VAL-003, SEC-005).

    Flags (all error severity): os.system/popen, subprocess, eval/exec,
    shutil.rmtree, os.remove/unlink/rmdir, socket, ctypes, pickle.loads,
    ``__import__``, write-mode ``open()`` outside ``artifacts/``, ``reports/``
    or ``automation/``, ``rm -rf`` shell strings, and base64-decoded
    exec/eval payloads.

    Args:
        code: Python source text.
        filename: Repo-relative path used in issue locations.

    Returns:
        Error-severity issues, one per finding.
    """
    issues: list[ValidationIssue] = []

    parsed = True
    try:
        tree = ast.parse(code, filename=filename)
    except SyntaxError:
        parsed = False
    if parsed:
        visitor = _ForbiddenVisitor(filename)
        visitor.visit(tree)
        issues.extend(visitor.issues)
    else:
        # Broken syntax already fails check_syntax; still scan text so a
        # malformed file cannot hide dangerous calls from review output.
        issues.extend(_scan_lines(code, _FALLBACK_PATTERNS, "forbidden", "error", filename))

    # String/encoded payloads the AST cannot classify.
    for lineno, line in enumerate(code.splitlines(), start=1):
        stripped = _code_part(line)
        if _RM_RF_RE.search(stripped):
            issues.append(
                ValidationIssue(
                    check="forbidden",
                    severity="error",
                    message="destructive shell string 'rm -rf' detected",
                    location=f"{filename}:{lineno}",
                )
            )
        if _B64_DECODE_RE.search(stripped) and _DYNAMIC_EXEC_RE.search(stripped):
            issues.append(
                ValidationIssue(
                    check="forbidden",
                    severity="error",
                    message="base64-decoded dynamic execution pattern detected",
                    location=f"{filename}:{lineno}",
                )
            )

    # Deduplicate (AST and fallback passes can overlap on odd inputs).
    seen: set[tuple[str, str]] = set()
    unique: list[ValidationIssue] = []
    for issue in issues:
        key = (issue.message, issue.location)
        if key not in seen:
            seen.add(key)
            unique.append(issue)
    return unique


# ---------------------------------------------------------------------------
# FR-VAL-003: hard-coded secrets
# ---------------------------------------------------------------------------


def check_secrets(code: str, filename: str) -> list[ValidationIssue]:
    """Flag hard-coded credentials using the shared secret patterns (FR-VAL-003).

    Generated tests must reference credentials via environment variables
    (FR-PROJ-004, SEC-002); any literal password/token/api-key fails the gate.

    Returns:
        One error-severity issue per secret-looking match (snippet redacted).
    """
    return [
        ValidationIssue(
            check="secrets",
            severity="error",
            message=(
                f"hard-coded secret detected ({snippet!r}); reference an "
                "environment variable instead"
            ),
            location=filename,
        )
        for snippet in find_secrets(code)
    ]


# ---------------------------------------------------------------------------
# FR-VAL-004: domain allow-list
# ---------------------------------------------------------------------------


def check_domains(code: str, filename: str, allowed_domains: list[str]) -> list[ValidationIssue]:
    """Verify every URL literal targets an allow-listed domain (FR-VAL-004, SEC-003).

    Args:
        code: Source text to scan for http(s) URLs.
        filename: Repo-relative path used in issue locations.
        allowed_domains: Project domain allow-list (e.g. ["localhost"]).

    Returns:
        One error-severity issue per URL whose host is not allow-listed.
    """
    issues: list[ValidationIssue] = []
    flagged: set[tuple[str, int]] = set()
    for lineno, line in enumerate(code.splitlines(), start=1):
        for url in extract_urls(line):
            if not is_domain_allowed(url, allowed_domains) and (url, lineno) not in flagged:
                flagged.add((url, lineno))
                issues.append(
                    ValidationIssue(
                        check="domains",
                        severity="error",
                        message=(
                            f"URL '{url}' targets a domain outside the allow-list "
                            f"{allowed_domains}"
                        ),
                        location=f"{filename}:{lineno}",
                    )
                )
    return issues


# ---------------------------------------------------------------------------
# FR-AUT-003: locator policy (warnings)
# ---------------------------------------------------------------------------

_CSS_ENGINE_RE = re.compile(r"\.locator\(\s*['\"]css=")
_XPATH_RE = re.compile(r"\.locator\(\s*['\"](?:xpath=|//)")
_NTH_RE = re.compile(r"\.nth\s*\(")
_LOCATOR_SELECTOR_RE = re.compile(r"\.locator\(\s*(['\"])(?P<sel>[^'\"]+)\1")
_USER_FACING_RE = re.compile(r"\.get_by_(?:role|label|test_id|placeholder|text)\s*\(")
_LONG_CHAIN_SEGMENTS = 4

_LOCATOR_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (_CSS_ENGINE_RE, "explicit 'css=' engine selector; prefer get_by_role/get_by_label/get_by_test_id"),
    (_XPATH_RE, "XPath selector; prefer get_by_role/get_by_label/get_by_test_id"),
    (_NTH_RE, ".nth() index-based selection is brittle; use a unique user-facing locator"),
]


def _is_test_file(filename: str) -> bool:
    name = Path(filename).name
    return name.startswith("test_") or name.endswith("_test.py")


def check_locator_policy(code: str, filename: str) -> list[ValidationIssue]:
    """Flag brittle locators as warnings (FR-AUT-003).

    Warns on ``locator('css=...')``, XPath (``//`` or ``xpath=``), ``.nth()``,
    long CSS descendant chains, and on test files that never use the
    user-facing ``get_by_role`` / ``get_by_label`` / ``get_by_test_id`` APIs.

    Returns:
        Warning-severity issues; these never fail the gate on their own.
    """
    issues = _scan_lines(code, _LOCATOR_PATTERNS, "locators", "warning", filename)

    for lineno, line in enumerate(code.splitlines(), start=1):
        for match in _LOCATOR_SELECTOR_RE.finditer(_code_part(line)):
            selector = match.group("sel")
            if selector.startswith(("css=", "xpath=", "//")):
                continue  # already covered above
            segments = [s for s in re.split(r"[\s>+~]+", selector.strip()) if s]
            if len(segments) >= _LONG_CHAIN_SEGMENTS:
                issues.append(
                    ValidationIssue(
                        check="locators",
                        severity="warning",
                        message=(
                            f"long CSS chain '{selector}' ({len(segments)} segments) "
                            "is brittle; prefer a user-facing locator"
                        ),
                        location=f"{filename}:{lineno}",
                    )
                )

    if (
        _is_test_file(filename)
        and re.search(r"\bdef test_", code)
        and re.search(r"\bpage\b", code)
        and not _USER_FACING_RE.search(code)
    ):
        issues.append(
            ValidationIssue(
                check="locators",
                severity="warning",
                message=(
                    "test file uses no user-facing locators "
                    "(get_by_role/get_by_label/get_by_test_id) — FR-AUT-003"
                ),
                location=filename,
            )
        )

    issues.extend(check_unmatched_locator_notes(code, filename))
    return issues


#: Note the automation agent emits for a step no approved locator matched.
_UNMATCHED_NOTE = "NO APPROVED LOCATOR MATCHED"


def check_unmatched_locator_notes(code: str, filename: str) -> list[ValidationIssue]:
    """Report steps no approved locator covered — as a warning, never a block.

    A user's approval of a locator is final, and a step the matcher could not
    cover is a gap in the scan, not a defect in the generated code. It is worth
    surfacing so the missing page can be scanned, but it must not stop the file
    from being approved or executed (§4, §5): the steps that did match are
    real, and blocking them helps nobody.
    """
    if not _is_test_file(filename) or _UNMATCHED_NOTE not in code:
        return []
    count = code.count(_UNMATCHED_NOTE)
    return [
        ValidationIssue(
            check="locators",
            severity="warning",
            message=(
                f"{count} test step(s) had no approved UI Scanner locator and were "
                "left out of the generated test. Scan the page those steps act on "
                "and approve its locators to cover them."
            ),
            location=filename,
        )
    ]


# ---------------------------------------------------------------------------
# FR-AUT-004: fixed waits
# ---------------------------------------------------------------------------

_SLEEP_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\btime\.sleep\s*\("), "time.sleep is forbidden; use Playwright auto-waiting/expect"),
    (re.compile(r"\basyncio\.sleep\s*\("), "asyncio.sleep is forbidden; use Playwright auto-waiting/expect"),
    (re.compile(r"\.wait_for_timeout\s*\("), "wait_for_timeout is forbidden; use expect() with conditions"),
    (re.compile(r"\bfrom\s+time\s+import\b[^\n]*\bsleep\b"), "importing time.sleep is forbidden (fixed waits)"),
]


def check_sleeps(code: str, filename: str) -> list[ValidationIssue]:
    """Flag fixed waits — ``time.sleep`` / ``wait_for_timeout`` (FR-AUT-004).

    Returns:
        Error-severity issues; generated tests must rely on Playwright's
        auto-waiting and ``expect`` assertions instead of hard sleeps.
    """
    return _scan_lines(code, _SLEEP_PATTERNS, "sleeps", "error", filename)


# ---------------------------------------------------------------------------
# FR-VAL-002: pytest collection
# ---------------------------------------------------------------------------

_COLLECT_ERROR_RE = re.compile(r"^ERROR\s+(?P<path>\S+)(?:\s*-\s*(?P<reason>.*))?$")
_COLLECT_SECTION_RE = re.compile(r"ERROR collecting (?P<path>\S+?)\s*_*$")
_COLLECT_E_LINE_RE = re.compile(r"^E\s+(?P<msg>.+)$")


def _parse_collection_errors(output: str) -> dict[str, str]:
    """Map failing path -> reason from pytest --collect-only output.

    Combines the ``ERRORS`` section (``ERROR collecting <path>`` headers
    followed by ``E   <exception>`` lines) with the short summary
    (``ERROR <path>[ - <reason>]``), preferring the richer reason.
    """
    reasons: dict[str, str] = {}
    current: str | None = None
    for raw in output.splitlines():
        line = raw.strip()
        section = _COLLECT_SECTION_RE.search(line)
        if section:
            current = section.group("path")
            reasons.setdefault(current, "")
            continue
        if current:
            e_line = _COLLECT_E_LINE_RE.match(line)
            if e_line:
                reasons[current] = e_line.group("msg").strip()
                continue
        summary = _COLLECT_ERROR_RE.match(line)
        if summary:
            path = summary.group("path")
            reason = (summary.group("reason") or "").strip()
            # The ERRORS section and the short summary may render the same
            # file under different relative paths; merge on basename.
            existing = next((k for k in reasons if Path(k).name == Path(path).name), None)
            if existing is None:
                reasons[path] = reason
            elif reason and not reasons[existing]:
                reasons[existing] = reason
    return reasons


def check_collection(paths: list[str], timeout_seconds: int = 60) -> list[ValidationIssue]:
    """Run ``pytest --collect-only -q`` on the given paths (FR-VAL-002).

    Collection catches import errors, missing fixtures at definition level and
    malformed test modules without executing any test code. Runs in a
    subprocess with the project virtualenv interpreter, cwd at the repo root,
    bounded by a timeout.

    Args:
        paths: Test file paths (absolute, or relative to the repo root).
        timeout_seconds: Subprocess timeout (default 60s).

    Returns:
        Error issues for collection failures, a single warning when nothing
        is collected, empty list on success.
    """
    if not paths:
        return []
    python = str(_VENV_PYTHON) if _VENV_PYTHON.exists() else sys.executable
    cmd = [python, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", *paths]
    try:
        proc = subprocess.run(  # noqa: S603 — fixed interpreter, validated gate tool
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return [
            ValidationIssue(
                check="collection",
                severity="error",
                message=f"pytest --collect-only timed out after {timeout_seconds}s",
                location=";".join(paths),
            )
        ]

    if proc.returncode == 0:
        return []
    output = redact_secrets((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if proc.returncode == 5:
        return [
            ValidationIssue(
                check="collection",
                severity="warning",
                message="pytest collected no tests from the generated files",
                location=";".join(paths),
            )
        ]

    issues = [
        ValidationIssue(
            check="collection",
            severity="error",
            message=reason or "collection error",
            location=path,
        )
        for path, reason in _parse_collection_errors(output).items()
    ]
    if not issues:
        tail = "\n".join(output.strip().splitlines()[-15:])
        issues.append(
            ValidationIssue(
                check="collection",
                severity="error",
                message=f"pytest collection failed (exit {proc.returncode}):\n{tail}",
                location=";".join(paths),
            )
        )
    return issues
