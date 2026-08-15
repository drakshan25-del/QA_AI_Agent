"""Engine-side Playwright execution that streams live step events (FR-EXE-006).

Runs pytest as a child process with the ``step_events`` plugin loaded and
``QA_EVENT_SINK``/``QA_RUN_ID`` pointed at the engine's own ingest endpoint.
Test code (page objects) POSTs each navigate/click/fill/assert step to that
endpoint, which republishes it onto the run's SSE stream (eventbus) for the
backend to forward to React. Final metrics come from the JUnit report parser
reused from V1 (FR-RES-001/FR-EXE-004).

Lifecycle guarantees (NFR-REL-001):
- ``eventbus.close(run_id)`` always runs, so SSE consumers never hang on a
  crashed worker; unexpected errors surface as a final ``error`` status event.
- Timeouts and cancellation kill the whole process group (pytest and its
  browser children) with SIGTERM → SIGKILL escalation.
- A ``runId`` already executing is refused instead of silently starting a
  second, uncancellable subprocess (FR-BE-003 idempotency).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import threading
from pathlib import Path

from app.core.security import redact_secrets
from app.services.results import collect_evidence, parse_junit
from engine.service import eventbus

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PYTHON_BIN = str(REPO_ROOT / ".venv" / "bin" / "python")

_RUNS: dict[str, subprocess.Popen] = {}
_LOCK = threading.Lock()

#: Grace period between SIGTERM and SIGKILL for a run's process group.
_KILL_GRACE_SECONDS = 10.0


def _sink_url(engine_port: int, run_id: str) -> str:
    """Ingest endpoint for step events. The token travels in a header
    (``X-Engine-Token``), never in the URL, so it cannot leak into logs."""
    return f"http://127.0.0.1:{engine_port}/internal/v1/runs/{run_id}/_ingest"


def _plugin_available(module: str) -> bool:
    """True when an optional pytest plugin is importable in the runner venv."""
    import importlib.util

    return importlib.util.find_spec(module) is not None


def is_running(run_id: str) -> bool:
    """True while ``run_id`` has a live subprocess."""
    with _LOCK:
        proc = _RUNS.get(run_id)
    return proc is not None and proc.poll() is None


#: Generated files may only ever be written under these repo-relative roots.
_MATERIALISE_ROOTS = ("automation",)

#: Framework files every generated test and page object depends on. They are
#: git-owned — the backend deliberately never sends them with a run
#: (RESERVED_AUTOMATION_BASENAMES) — so when one is missing from the workspace
#: the run must fail fast with a repair hint instead of dying later in pytest
#: collection with a truncated ModuleNotFoundError (AIQA-EXEC-003).
_FRAMEWORK_PREREQUISITES = (
    "automation/__init__.py",
    "automation/conftest.py",
    "automation/pages/__init__.py",
    "automation/pages/base_page.py",
)

#: Directory whose materialised ``test_*.py`` files are pytest collection
#: targets; everything else materialised (page objects) is import-only.
_GENERATED_TESTS_DIR = "automation/generated_tests"

#: Ownership record of every file this engine has materialised (repo-relative
#: path → sha256 of the content last written). FR-AUT-007 applied to the
#: runtime workspace: only files the engine itself wrote may be replaced.
_MATERIALISE_MANIFEST = "automation/.materialised.json"


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _load_materialise_manifest() -> dict:
    path = REPO_ROOT / _MATERIALISE_MANIFEST
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("files"), dict):
            return data
    except (OSError, ValueError):
        pass
    return {"files": {}}


def _save_materialise_manifest(manifest: dict) -> None:
    (REPO_ROOT / _MATERIALISE_MANIFEST).write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
    )


def materialise_files(files: list[dict]) -> tuple[list[str], list[str]]:
    """Write approved generated files into the workspace before a run.

    The backend (system of record) sends ``[{path, content}]``; the engine
    filesystem is only a runtime workspace. Every target is containment-checked
    against the repo root AND restricted to ``automation/`` so a malicious
    path can never escape or overwrite engine/backend code (SEC-005, §13.1).

    Ownership guard (AIQA-EXEC-003): a target that already exists with
    different content is only overwritten when this engine wrote what is on
    disk (tracked by content hash in ``automation/.materialised.json``).
    Anything else — the framework's own ``base_page.py``, hand-written page
    objects, files edited outside the system — is kept and reported, never
    clobbered: a generated ``base_page.py`` artifact once overwrote the real
    instrumented BasePage and broke every UI test with an AttributeError.

    Returns:
        ``(written, kept)``: repo-relative paths written (or already
        identical), and paths kept because the engine does not own them.
    """
    manifest = _load_materialise_manifest()
    written: list[str] = []
    kept: list[str] = []
    manifest_changed = False
    for f in files or []:
        path = str(f.get("path") or "").strip()
        content = f.get("content")
        if not path or not isinstance(content, str):
            continue
        rel = Path(path)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError(f"generated file path {path!r} escapes the workspace")
        if rel.parts[0] not in _MATERIALISE_ROOTS:
            raise ValueError(
                f"generated file path {path!r} is outside the allowed roots {_MATERIALISE_ROOTS}"
            )
        target = (REPO_ROOT / rel).resolve()
        if not target.is_relative_to(REPO_ROOT):
            raise ValueError(f"generated file path {path!r} escapes the repository")
        key = rel.as_posix()
        if target.exists():
            on_disk = target.read_text(encoding="utf-8")
            if on_disk == content:
                # Byte-identical: claim ownership so a future updated version
                # of this artifact can still be materialised.
                if manifest["files"].get(key) != _sha256(content):
                    manifest["files"][key] = _sha256(content)
                    manifest_changed = True
                written.append(key)
                continue
            if manifest["files"].get(key) != _sha256(on_disk):
                # Exists, differs, and the engine did not write what is on
                # disk: hand-written or externally modified — keep it.
                kept.append(key)
                continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        manifest["files"][key] = _sha256(content)
        manifest_changed = True
        written.append(key)
    if manifest_changed:
        _save_materialise_manifest(manifest)
    return written, kept


def _terminate_group(proc: subprocess.Popen) -> None:
    """SIGTERM the run's process group, escalating to SIGKILL after a grace
    period so pytest *and* its browser children always die (FR-EXE-005)."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return

    def _force_kill() -> None:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

    timer = threading.Timer(_KILL_GRACE_SECONDS, _force_kill)
    timer.daemon = True
    timer.start()


def _all_skipped_error(metrics: dict, tests: list[dict]) -> str | None:
    """Explain a run in which every collected test was skipped (NFR-USA-002).

    ``passed 0, failed 0, skipped N`` reads as a mystery failure; in this
    framework a whole-suite skip almost always means the ``target_available``
    probe found the target app unreachable. Surface the skip reason so the
    log says WHY nothing was verified.
    """
    if metrics.get("total", 0) <= 0 or metrics.get("skipped", 0) != metrics.get("total"):
        return None
    raw = next((t.get("message", "") for t in tests if t.get("message")), "")
    # JUnit skip messages append a "path:line: reason" detail block; only the
    # first line is the human reason.
    reason = raw.splitlines()[0].strip() if raw else ""
    return (
        f"All {metrics['total']} test(s) were skipped"
        + (f" — {reason}" if reason else "")
        + ". Nothing was verified: check that the target app is running and "
        "the project's base URL is correct."
    )


#: Cap on the pytest-output excerpt stored in ``metrics.error``. Big enough
#: for a full ERRORS section; small enough for a log line / API payload.
_ERROR_EXCERPT_CHARS = 2000


def _pytest_error_excerpt(stdout: str) -> str:
    """Slice of pytest output that explains a collection/import failure.

    A blind last-N-chars tail can cut off the terminal ``E ModuleNotFoundError``
    line and surface only pytest's 'valid Python names' hint. Prefer the
    ``ERRORS`` section (it runs to the end of the output, so the ``E `` lines
    and the short summary survive); fall back to the error/summary lines, then
    to the plain tail.
    """
    text = (stdout or "").strip()
    idx = text.rfind("= ERRORS =")
    if idx != -1:
        excerpt = text[text.rfind("\n", 0, idx) + 1 :]
    else:
        picked = [
            line
            for line in text.splitlines()
            if line.startswith(("E ", "E   ", "ERROR "))
            or "short test summary info" in line
        ]
        excerpt = "\n".join(picked) if picked else text
    return excerpt[-_ERROR_EXCERPT_CHARS:]


def _flaky_count(stdout: str, parsed_tests: list[dict]) -> int:
    """Flaky tests (FR-V3-RPT-001): rerun by pytest-rerunfailures and finally
    passed. Primary signal is the pytest summary line (printed even with
    ``-q``), e.g. ``3 passed, 2 rerun in 1.2s``; per-node RERUN lines refine
    attribution when verbose output is available."""
    summary = re.search(r"(\d+)\s+rerun", stdout or "")
    if not summary:
        return 0
    rerun_attempts = int(summary.group(1))
    passed_names = [t.get("name", "") for t in parsed_tests if t.get("outcome") == "passed"]
    rerun_lines = [line for line in (stdout or "").splitlines() if "RERUN" in line]
    if rerun_lines:
        attributed = {
            name for name in passed_names
            if name and any(name.split("[")[0] in line for line in rerun_lines)
        }
        if attributed:
            return len(attributed)
    # Without per-node lines, a rerun that ended green is at most one flaky
    # test per attempt and no more than the number of passed tests.
    return min(rerun_attempts, len(passed_names))


def run_execution(
    run_id: str,
    test_paths: list[str],
    *,
    engine_port: int,
    engine_token: str,
    files: list[dict] | None = None,
    browser: str = "chromium",
    headed: bool = False,
    environment: str = "local",
    target_base_url: str = "",
    target_api_base_url: str = "",
    allowed_domains: str = "localhost,127.0.0.1",
    markers: str = "",
    timeout_seconds: int = 900,
    retries: int = 0,
    workers: int = 1,
    slow_mo_ms: int = 0,
    screenshot_mode: str = "on-failure",
    video: bool = False,
) -> dict:
    """Run pytest for ``run_id`` streaming step events; return results+metrics.

    V3 (FR-V3-EXE-002/003/009/010/011): selectable Chromium/Firefox/WebKit,
    headed or headless, bounded retries/workers/slow-mo, screenshot policy and
    optional video. Optional plugins (pytest-rerunfailures, pytest-xdist) are
    engaged only when installed so a missing extra never breaks a run.
    """
    try:
        return _run_execution_inner(
            run_id,
            test_paths,
            engine_port=engine_port,
            engine_token=engine_token,
            files=files,
            browser=browser,
            headed=headed,
            environment=environment,
            target_base_url=target_base_url,
            target_api_base_url=target_api_base_url,
            allowed_domains=allowed_domains,
            markers=markers,
            timeout_seconds=timeout_seconds,
            retries=retries,
            workers=workers,
            slow_mo_ms=slow_mo_ms,
            screenshot_mode=screenshot_mode,
            video=video,
        )
    except Exception as exc:  # noqa: BLE001 - worker thread: surface, never hang consumers
        message = redact_secrets(f"{type(exc).__name__}: {exc}")
        eventbus.emit(run_id, "execution.status", {
            "run_id": run_id, "status": "error", "metrics": {"error": message},
        })
        return {"run_id": run_id, "status": "error", "metrics": {"error": message},
                "results": [], "evidence": []}
    finally:
        with _LOCK:
            _RUNS.pop(run_id, None)
        eventbus.close(run_id)


def _run_execution_inner(
    run_id: str,
    test_paths: list[str],
    *,
    engine_port: int,
    engine_token: str,
    files: list[dict] | None,
    browser: str,
    headed: bool,
    environment: str,
    target_base_url: str,
    target_api_base_url: str,
    allowed_domains: str,
    markers: str,
    timeout_seconds: int,
    retries: int,
    workers: int,
    slow_mo_ms: int,
    screenshot_mode: str,
    video: bool,
) -> dict:
    run_dir = REPO_ROOT / "artifacts" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    junit_path = run_dir / "junit.xml"
    output_dir = run_dir / "test-output"

    # Materialise approved generated files sent with the run (AIQA-EXEC-001):
    # the DB is the artefact store; without this, pytest is pointed at paths
    # that may not exist in the engine workspace.
    written, kept = materialise_files(files or [])
    if written or kept:
        detail = f"materialised {len(written)} generated file(s)"
        if kept:
            detail += (
                "; kept existing (not runner-owned, never overwritten): "
                + ", ".join(sorted(kept))
            )
        eventbus.emit(run_id, "execution.status", {
            "run_id": run_id, "status": "preparing", "detail": detail,
        })
        # Materialised test modules not already in test_paths should be run
        # too. Page objects are imported dependencies, never collection
        # targets — handing them to pytest turns any import problem into a
        # whole-run collection abort (mirrors the backend's page_object
        # exclusion when it builds testPaths).
        for path in written:
            name = Path(path).name
            is_test_module = (
                path.startswith(_GENERATED_TESTS_DIR + "/")
                and name.startswith("test_")
                and name.endswith(".py")
            )
            if is_test_module and path not in test_paths:
                test_paths.append(path)

    missing = [p for p in _FRAMEWORK_PREREQUISITES if not (REPO_ROOT / p).is_file()]
    if missing:
        raise RuntimeError(
            "automation workspace is damaged — missing framework file(s): "
            + ", ".join(missing)
            + ". Restore them from git (repository root): git checkout -- "
            + " ".join(f"apps/qa-engine/{p}" for p in missing)
        )

    screenshot_flag = {
        "on-failure": "only-on-failure",
        "every-test": "on",
        "off": "off",
    }.get(screenshot_mode, "only-on-failure")

    cmd = [
        PYTHON_BIN, "-m", "pytest", *test_paths,
        "-p", "engine.service.step_events",
        "--browser", browser,
        "--junitxml", str(junit_path),
        "--screenshot", screenshot_flag,
        "--tracing", "retain-on-failure",
        "--output", str(output_dir),
        "-q",
    ]
    if headed:
        cmd.append("--headed")
    if slow_mo_ms > 0:
        cmd.extend(["--slowmo", str(slow_mo_ms)])
    if video:
        cmd.extend(["--video", "retain-on-failure"])
    if retries > 0 and _plugin_available("pytest_rerunfailures"):
        cmd.extend(["--reruns", str(retries)])
    if workers > 1 and _plugin_available("xdist"):
        cmd.extend(["-n", str(workers)])
    if markers:
        cmd.extend(["-m", markers])

    env = os.environ.copy()
    env.update({
        "QA_EVENT_SINK": _sink_url(engine_port, run_id),
        "QA_EVENT_SINK_TOKEN": engine_token,
        "QA_RUN_ID": run_id,
        "QA_TARGET_BASE_URL": target_base_url or env.get("QA_TARGET_BASE_URL", ""),
        "QA_TARGET_API_BASE_URL": target_api_base_url
        or env.get("QA_TARGET_API_BASE_URL", ""),
        "QA_ALLOWED_DOMAINS": allowed_domains,
        "QA_ENVIRONMENT": environment,
    })

    eventbus.emit(run_id, "execution.status", {
        "run_id": run_id, "status": "preparing", "browser": browser,
        "headed": headed, "workers": workers, "retries": retries,
    })
    eventbus.emit(run_id, "execution.status", {"run_id": run_id, "status": "running"})
    proc = subprocess.Popen(  # noqa: S603 - fixed venv interpreter, no shell
        cmd, cwd=str(REPO_ROOT), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        start_new_session=True,
    )
    with _LOCK:
        _RUNS[run_id] = proc

    timed_out = False
    try:
        stdout, _ = proc.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        _terminate_group(proc)
        stdout, _ = proc.communicate()

    (run_dir / "pytest.log").write_text(redact_secrets(stdout or ""), encoding="utf-8")

    parsed: dict | None = None
    if junit_path.is_file():
        try:
            parsed = parse_junit(junit_path)
        except Exception:  # noqa: BLE001 - truncated/corrupt XML from killed runs
            parsed = None

    if parsed is not None and parsed["tests"]:
        metrics = {k: parsed[k] for k in ("passed", "failed", "skipped", "errors", "duration_seconds")}
        metrics["total"] = len(parsed["tests"])
        metrics["flaky"] = _flaky_count(stdout or "", parsed["tests"])
        status = "timed_out" if timed_out else "completed"
        results = parsed["tests"]
        # Pure collection/import errors (nothing actually ran) must carry the
        # pytest output so the UI can explain WHAT failed (NFR-USA-002).
        if metrics["errors"] > 0 and metrics["passed"] + metrics["failed"] == 0:
            tail = redact_secrets(_pytest_error_excerpt(stdout))
            metrics["error"] = f"Tests could not be collected/imported. Pytest output:\n{tail}"
            status = "timed_out" if timed_out else "error"
        else:
            skipped_error = _all_skipped_error(metrics, parsed["tests"])
            if skipped_error:
                metrics["error"] = redact_secrets(skipped_error)
    elif parsed is not None:
        # A junit report with zero tests means nothing was collected (missing
        # file, import error, bad marker) — surface the pytest output instead
        # of reporting a silent all-zero "completion" (NFR-USA-002).
        tail = redact_secrets(_pytest_error_excerpt(stdout))
        metrics = {
            "passed": 0, "failed": 0, "skipped": 0, "errors": 0,
            "duration_seconds": parsed.get("duration_seconds", 0), "total": 0, "flaky": 0,
            "error": f"No tests were collected or executed. Pytest output:\n{tail}",
        }
        status = "timed_out" if timed_out else "error"
        results = []
    else:
        tail = redact_secrets((stdout or "")[-800:])
        metrics = {"error": tail}
        status = "timed_out" if timed_out else "error"
        results = []

    evidence = collect_evidence(output_dir)
    eventbus.emit(run_id, "execution.status", {"run_id": run_id, "status": status, "metrics": metrics})
    return {"run_id": run_id, "status": status, "metrics": metrics, "results": results, "evidence": evidence}


def cancel_execution(run_id: str) -> bool:
    """Terminate a live run's process group (FR-EXE-005/009).

    SIGTERM first for clean teardown, SIGKILL after a grace period so a
    wedged pytest or browser can never survive cancellation.
    """
    with _LOCK:
        proc = _RUNS.get(run_id)
    if proc is None or proc.poll() is not None:
        return False
    _terminate_group(proc)
    eventbus.emit(run_id, "execution.status", {"run_id": run_id, "status": "cancelled"})
    return True
