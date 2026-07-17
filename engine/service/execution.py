"""Engine-side Playwright execution that streams live step events (FR-EXE-006).

Runs pytest as a child process with the ``step_events`` plugin loaded and
``QA_EVENT_SINK``/``QA_RUN_ID`` pointed at the engine's own ingest endpoint.
Test code (page objects) POSTs each navigate/click/fill/assert step to that
endpoint, which republishes it onto the run's SSE stream (eventbus) for the
backend to forward to React. Final metrics come from the JUnit report parser
reused from V1 (FR-RES-001/FR-EXE-004).
"""

from __future__ import annotations

import os
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


def _sink_url(engine_port: int, token: str, run_id: str) -> str:
    return f"http://127.0.0.1:{engine_port}/internal/v1/runs/{run_id}/_ingest?token={token}"


def _plugin_available(module: str) -> bool:
    """True when an optional pytest plugin is importable in the runner venv."""
    import importlib.util

    return importlib.util.find_spec(module) is not None


def run_execution(
    run_id: str,
    test_paths: list[str],
    *,
    engine_port: int,
    engine_token: str,
    browser: str = "chromium",
    headed: bool = False,
    environment: str = "local",
    target_base_url: str = "",
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
    run_dir = REPO_ROOT / "artifacts" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    junit_path = run_dir / "junit.xml"
    output_dir = run_dir / "test-output"

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
        "QA_EVENT_SINK": _sink_url(engine_port, engine_token, run_id),
        "QA_RUN_ID": run_id,
        "QA_TARGET_BASE_URL": target_base_url or env.get("QA_TARGET_BASE_URL", ""),
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
    try:
        stdout, _ = proc.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, _ = proc.communicate()
    finally:
        with _LOCK:
            _RUNS.pop(run_id, None)

    (run_dir / "pytest.log").write_text(redact_secrets(stdout or ""), encoding="utf-8")

    if junit_path.is_file():
        parsed = parse_junit(junit_path)
        metrics = {k: parsed[k] for k in ("passed", "failed", "skipped", "errors", "duration_seconds")}
        metrics["total"] = len(parsed["tests"])
        # Flaky detection (FR-V3-RPT-001): a test that was rerun and finally
        # passed. pytest-rerunfailures prints "RERUN" per retried attempt.
        rerun_ids = {
            line.split(" ")[-1].strip()
            for line in (stdout or "").splitlines()
            if "RERUN" in line
        }
        passed_ids = {t.get("name", "") for t in parsed["tests"] if t.get("outcome") == "passed"}
        flaky = len({r for r in rerun_ids if any(r and r in p for p in passed_ids)})
        metrics["flaky"] = flaky
        status = "completed"
        results = parsed["tests"]
    else:
        metrics = {"error": redact_secrets((stdout or "")[-800:])}
        status = "error"
        results = []

    evidence = collect_evidence(output_dir)
    eventbus.emit(run_id, "execution.status", {"run_id": run_id, "status": status, "metrics": metrics})
    eventbus.close(run_id)
    return {"run_id": run_id, "status": status, "metrics": metrics, "results": results, "evidence": evidence}


def cancel_execution(run_id: str) -> bool:
    """Terminate a live run's process group (FR-EXE-005/009)."""
    import signal
    with _LOCK:
        proc = _RUNS.get(run_id)
    if proc is None or proc.poll() is not None:
        return False
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return False
    eventbus.emit(run_id, "execution.status", {"run_id": run_id, "status": "cancelled"})
    return True
