"""Result parsing and evidence collection (SRS FR-RES-001, FR-EXE-004, FR-AUT-008).

Turns the JUnit XML produced by a pytest run into structured metrics and
per-test outcomes, and walks the pytest-playwright ``test-output`` directory
to map failure evidence (screenshots, traces, videos) back to tests.
Deterministic code only — no LLM involvement (raw results feed the analysis
agent elsewhere, FR-RES-002).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from app.core.logging import get_logger
from app.core.security import redact_secrets

logger = get_logger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_MAX_MESSAGE_CHARS = 4000

_SCREENSHOT_EXTS = {".png", ".jpg", ".jpeg"}
_TRACE_EXTS = {".zip"}
_VIDEO_EXTS = {".webm", ".mp4"}

# (junit child tag, normalised outcome) checked in priority order.
_OUTCOME_TAGS = (("failure", "failed"), ("error", "error"), ("skipped", "skipped"))


def _node_id_from(classname: str, name: str) -> str:
    """Best-effort reconstruction of a pytest node id from junit attributes.

    xunit2 stores the dotted module (and optional class) path in ``classname``.
    When the dotted path maps onto an existing ``.py`` file under the repo
    root the familiar ``path/to/file.py::[Class::]test`` form is produced;
    otherwise ``classname::name`` is returned as a stable identifier.
    """
    if not classname:
        return name
    parts = classname.split(".")
    # Try the full dotted path as a module file, then treat the last segment
    # as a test class and retry.
    for split_at in (len(parts), len(parts) - 1):
        if split_at <= 0:
            continue
        candidate = Path(*parts[:split_at]).with_suffix(".py")
        if (REPO_ROOT / candidate).is_file():
            suffix = "::".join([*parts[split_at:], name])
            return f"{candidate.as_posix()}::{suffix}"
    return f"{classname}::{name}"


def _case_outcome(case: ET.Element) -> tuple[str, str]:
    """Extract (outcome, message) for one <testcase>; message is redacted."""
    for tag, outcome in _OUTCOME_TAGS:
        node = case.find(tag)
        if node is not None:
            message = (node.get("message") or "").strip()
            detail = (node.text or "").strip()
            if detail:
                message = f"{message}\n{detail}".strip()
            return outcome, redact_secrets(message)[:_MAX_MESSAGE_CHARS]
    return "passed", ""


def parse_junit(junit_path: str | Path) -> dict:
    """Parse a pytest JUnit XML report into metrics + per-test results.

    Implements FR-RES-001 (structured result capture) and supplies the
    pass/fail/skip/error counters and duration required by FR-EXE-004.

    Args:
        junit_path: Path to the ``junit.xml`` written by ``run_pytest``.

    Returns:
        dict with keys ``passed``, ``failed``, ``skipped``, ``errors``
        (ints), ``duration_seconds`` (float) and ``tests`` — a list of
        ``{node_id, outcome, duration, message}`` dicts, one per test case.

    Raises:
        FileNotFoundError: If the report does not exist.
        xml.etree.ElementTree.ParseError: If the XML is malformed.
    """
    junit_path = Path(junit_path)
    root = ET.parse(junit_path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))

    tests: list[dict] = []
    suite_duration = 0.0

    for suite in suites:
        try:
            suite_duration += float(suite.get("time") or 0.0)
        except ValueError:
            pass
        for case in suite.iter("testcase"):
            outcome, message = _case_outcome(case)
            try:
                duration = float(case.get("time") or 0.0)
            except ValueError:
                duration = 0.0
            tests.append(
                {
                    "node_id": _node_id_from(case.get("classname") or "", case.get("name") or ""),
                    "outcome": outcome,
                    "duration": duration,
                    "message": message,
                }
            )

    counts = {
        "passed": sum(1 for t in tests if t["outcome"] == "passed"),
        "failed": sum(1 for t in tests if t["outcome"] == "failed"),
        "skipped": sum(1 for t in tests if t["outcome"] == "skipped"),
        "errors": sum(1 for t in tests if t["outcome"] == "error"),
    }
    duration = suite_duration if suite_duration > 0 else sum(t["duration"] for t in tests)

    logger.info(
        "parsed junit report %s: %s tests (%s passed, %s failed, %s skipped, %s errors)",
        junit_path,
        len(tests),
        counts["passed"],
        counts["failed"],
        counts["skipped"],
        counts["errors"],
    )
    return {**counts, "duration_seconds": round(duration, 3), "tests": tests}


def collect_evidence(output_dir: str | Path) -> dict[str, dict[str, list[str]]]:
    """Collect failure evidence written by pytest-playwright (FR-AUT-008).

    pytest-playwright places per-test artifacts in a slug-named subdirectory
    of the ``--output`` directory (e.g. ``test-login-py-test-valid-chromium``)
    containing screenshots (``.png``), traces (``trace.zip``) and, when
    enabled, videos (``.webm``).

    Args:
        output_dir: The run's ``test-output`` directory.

    Returns:
        Mapping of test slug -> ``{"screenshots": [...], "traces": [...],
        "videos": [...]}`` with absolute file paths as strings. Empty dict
        when the directory does not exist (e.g. an all-green run).
    """
    output_dir = Path(output_dir)
    evidence: dict[str, dict[str, list[str]]] = {}
    if not output_dir.is_dir():
        return evidence

    def _bucket(slug: str) -> dict[str, list[str]]:
        return evidence.setdefault(slug, {"screenshots": [], "traces": [], "videos": []})

    def _classify(slug: str, file: Path) -> None:
        ext = file.suffix.lower()
        if ext in _SCREENSHOT_EXTS:
            _bucket(slug)["screenshots"].append(str(file))
        elif ext in _TRACE_EXTS:
            _bucket(slug)["traces"].append(str(file))
        elif ext in _VIDEO_EXTS:
            _bucket(slug)["videos"].append(str(file))

    for entry in sorted(output_dir.iterdir()):
        if entry.is_dir():
            for file in sorted(p for p in entry.rglob("*") if p.is_file()):
                _classify(entry.name, file)
        elif entry.is_file():
            _classify("_run", entry)

    # Drop slugs where nothing classifiable was found.
    return {slug: files for slug, files in evidence.items() if any(files.values())}
