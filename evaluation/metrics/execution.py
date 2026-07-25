"""Optional 'execution success' metric — actually run the generated tests.

The strongest possible objective signal for the automation task: do the
generated Playwright tests *run and pass* against the live sample app? This is
opt-in (``--run-execution``) because it is slower and needs the sample app on
:8001 plus ``playwright install chromium``.

Isolation & safety:
* Files are written to a unique throwaway subdirectory *under*
  ``automation/generated_tests/`` so the tree's ``conftest.py`` fixtures and the
  ``automation.pages.*`` imports resolve, then the subdirectory is deleted.
* pytest runs in a subprocess with a JUnit-XML report we parse — no reliance on
  return-code semantics alone.
* Tests that request ``target_available`` SKIP (not fail) when the app is down,
  so a missing target yields ``value=None`` ("not executed"), never a false 0.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from evaluation.config import REPO_ROOT

_GENERATED_DIR = REPO_ROOT / "automation" / "generated_tests"


def score_executability(gate_detail: Mapping[str, Any], exec_result: Mapping[str, Any] | None = None) -> dict:
    """Compose the Executability metric from the gate result (+ optional execution).

    Build status is always available from the validation gate (syntax +
    collection). When real execution ran, its pass rate contributes; otherwise
    the score is static (build/collection/gate). Returns ``{score, metrics,
    detail}`` in the standard per-run shape.

    Args:
        gate_detail: the ``detail`` dict from ``deterministic.score_automation``.
        exec_result: optional ``run_execution`` result (``value`` + ``detail``).
    """
    by_check = gate_detail.get("issues_by_check", {}) or {}
    syntax_ok = by_check.get("syntax", {}).get("error", 0) == 0
    collection_ok = by_check.get("collection", {}).get("error", 0) == 0
    gate_pass = bool(gate_detail.get("passed"))

    metrics: dict[str, Any] = {
        "build_status": 1.0 if syntax_ok else 0.0,
        "collection_success": 1.0 if collection_ok else 0.0,
    }
    detail: dict[str, Any] = {
        "build_status": "pass" if syntax_ok else "fail",
        "collection_status": "pass" if collection_ok else "fail",
        "gate_passed": gate_pass,
        "failure_reason": _first_error(gate_detail) if not gate_pass else None,
    }

    pass_rate = exec_result.get("value") if exec_result else None
    if exec_result is not None:
        detail["execution"] = exec_result.get("detail")
        metrics["execution_pass_rate"] = pass_rate

    if pass_rate is not None:
        score = 0.4 * metrics["build_status"] + 0.2 * metrics["collection_success"] + 0.4 * pass_rate
        detail["execution_status"] = "executed"
    else:
        score = 0.5 * metrics["build_status"] + 0.3 * metrics["collection_success"] + 0.2 * (1.0 if gate_pass else 0.0)
        detail["execution_status"] = "static-only"

    metrics["executability_score"] = round(score, 4)
    return {"score": round(score, 4), "metrics": metrics, "detail": detail}


def _first_error(gate_detail: Mapping[str, Any]) -> str | None:
    for issue in gate_detail.get("issues", []) or []:
        if issue.get("severity") == "error":
            return f"[{issue.get('check')}] {issue.get('message')}"
    return None


def run_execution(files: list[Mapping[str, Any]], timeout_s: int = 180) -> dict:
    """Write, execute and score the generated test files.

    Returns:
        ``{"value": 0..1 | None, "detail": {...}}`` — value is the fraction of
        non-skipped tests that passed, or None if nothing ran (e.g. target down)
        or execution could not be attempted.
    """
    if not files:
        return {"value": 0.0, "detail": {"error": "no files to execute"}}

    work = _GENERATED_DIR / f"_eval_{uuid.uuid4().hex[:8]}"
    junit = work / "_result.xml"
    try:
        work.mkdir(parents=True, exist_ok=True)
        written = _write_test_files(files, work)
        if not written:
            return {"value": None, "detail": {"error": "no test_*.py files to run"}}

        proc = subprocess.run(
            [
                sys.executable, "-m", "pytest", str(work),
                "-q", "-p", "no:cacheprovider",
                "--override-ini=addopts=",  # drop repo -ra so our args win cleanly
                f"--junit-xml={junit}",
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        return _score_junit(junit, proc)
    except subprocess.TimeoutExpired:
        return {"value": 0.0, "detail": {"error": f"execution timed out after {timeout_s}s"}}
    except Exception as exc:  # noqa: BLE001 - optional metric, never crash the run
        return {"value": None, "detail": {"error": f"{type(exc).__name__}: {exc}"}}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _write_test_files(files: list[Mapping[str, Any]], work: Path) -> list[Path]:
    written: list[Path] = []
    for f in files:
        name = Path(str(f.get("path", ""))).name
        if not (name.startswith("test_") and name.endswith(".py")):
            continue
        target = work / name
        target.write_text(str(f.get("content", "")), encoding="utf-8")
        written.append(target)
    return written


def _score_junit(junit: Path, proc: subprocess.CompletedProcess) -> dict:
    if not junit.is_file():
        return {
            "value": None,
            "detail": {
                "error": "no JUnit report produced",
                "returncode": proc.returncode,
                "stderr_tail": proc.stderr[-500:],
            },
        }
    root = ElementTree.parse(junit).getroot()
    suites = root.findall(".//testsuite") or [root]
    tests = failures = errors = skipped = 0
    for s in suites:
        tests += int(s.get("tests", 0))
        failures += int(s.get("failures", 0))
        errors += int(s.get("errors", 0))
        skipped += int(s.get("skipped", 0))

    ran = tests - skipped
    if ran <= 0:
        return {
            "value": None,
            "detail": {"tests": tests, "skipped": skipped, "note": "all skipped (target unavailable?)"},
        }
    passed = ran - failures - errors
    return {
        "value": round(max(0, passed) / ran, 4),
        "detail": {
            "tests": tests, "passed": passed, "failures": failures,
            "errors": errors, "skipped": skipped,
        },
    }
