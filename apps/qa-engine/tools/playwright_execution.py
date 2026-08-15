"""Local Playwright/pytest execution tool (SRS FR-EXE-001..005, FR-AUT-008).

Runs approved generated tests through pytest + pytest-playwright as a child
process, capturing JUnit XML, redacted logs and failure evidence
(screenshots / traces) into a per-run artifacts directory. A module-level
process registry supports cooperative cancellation of in-flight runs
(FR-EXE-005) via process-group termination.

No LLM calls happen here; this module is deterministic tooling.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path

from app.core.logging import get_logger
from app.core.security import redact_secrets

logger = get_logger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_BIN = str(REPO_ROOT / ".venv" / "bin" / "python")

# FR-EXE-005: registry of live pytest processes keyed by execution run id.
_PROCESS_REGISTRY: dict[str, subprocess.Popen] = {}
_CANCELLED_RUNS: set[str] = set()
_REGISTRY_LOCK = threading.Lock()

_CANCEL_GRACE_SECONDS = 10.0
_DEFAULT_TIMEOUT_SECONDS = 900


def build_pytest_command(
    test_paths: list[str],
    run_dir: Path,
    headed: bool = False,
    browser: str = "chromium",
    markers: str = "",
) -> list[str]:
    """Build the pytest command line for a local execution run (FR-EXE-001/003).

    Evidence capture flags implement FR-AUT-008: screenshots and Playwright
    traces are retained only on failure, under ``<run_dir>/test-output``.

    Args:
        test_paths: Repo-relative or absolute paths of test files/dirs to run.
        run_dir: Per-run artifacts directory receiving junit.xml and evidence.
        headed: Run browsers headed instead of headless (FR-EXE-003).
        browser: Playwright browser name (chromium|firefox|webkit).
        markers: Optional pytest ``-m`` marker expression, e.g. ``smoke``.

    Returns:
        Argv list starting with the project venv Python.
    """
    cmd = [PYTHON_BIN, "-m", "pytest", *test_paths, "--browser", browser]
    if headed:
        cmd.append("--headed")
    if markers:
        cmd.extend(["-m", markers])
    cmd.extend(
        [
            "--junitxml",
            str(run_dir / "junit.xml"),
            "--screenshot",
            "only-on-failure",
            "--tracing",
            "retain-on-failure",
            "--output",
            str(run_dir / "test-output"),
            "-q",
        ]
    )
    return cmd


def _kill_process_group(proc: subprocess.Popen, sig: signal.Signals) -> None:
    """Signal the whole process group so browser children die too."""
    try:
        os.killpg(proc.pid, sig)
    except (ProcessLookupError, PermissionError):  # already gone
        pass


def run_pytest(
    test_paths: list[str],
    run_dir: Path,
    headed: bool = False,
    browser: str = "chromium",
    extra_env: dict[str, str] | None = None,
    markers: str = "",
    timeout_seconds: int = _DEFAULT_TIMEOUT_SECONDS,
    run_id: str | None = None,
) -> dict:
    """Run pytest synchronously and collect its outputs (FR-EXE-001..005).

    The child process runs in its own session/process group so cancellation
    (``cancel_run``) and timeouts can terminate it and every browser child
    cleanly with ``os.killpg``. Combined stdout/stderr is redacted with
    ``redact_secrets`` before being written to ``<run_dir>/pytest.log``
    (SEC-007). Secrets are never placed on the command line; test credentials
    travel via ``extra_env`` env vars only (FR-PROJ-004, FR-CI-004).

    Args:
        test_paths: Test files/dirs to execute; must already be approved code.
        run_dir: Per-run artifacts directory (created if missing).
        headed: Headed browser mode (FR-EXE-003).
        browser: Playwright browser name.
        extra_env: Extra environment variables layered over ``os.environ``
            (e.g. ``QA_TARGET_BASE_URL`` selecting the environment, FR-EXE-001).
        markers: pytest ``-m`` expression, empty for none.
        timeout_seconds: Hard wall-clock limit; the run is killed after it.
        run_id: Optional execution-run id; when given the process is entered
            into the cancellation registry (FR-EXE-005).

    Returns:
        dict with keys ``exit_code`` (int), ``junit_path`` (str),
        ``log_path`` (str), ``output_dir`` (str), ``cancelled`` (bool) and
        ``timed_out`` (bool).
    """
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    junit_path = run_dir / "junit.xml"
    log_path = run_dir / "pytest.log"
    output_dir = run_dir / "test-output"

    cmd = build_pytest_command(test_paths, run_dir, headed=headed, browser=browser, markers=markers)
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)

    logger.info(
        "starting pytest run: paths=%s browser=%s headed=%s markers=%r",
        test_paths,
        browser,
        headed,
        markers,
        extra={"run_id": run_id},
    )

    proc = subprocess.Popen(  # noqa: S603 - fixed venv interpreter, no shell
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,  # own process group => killpg-able
    )
    if run_id is not None:
        with _REGISTRY_LOCK:
            _PROCESS_REGISTRY[run_id] = proc

    timed_out = False
    try:
        stdout, _ = proc.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_process_group(proc, signal.SIGTERM)
        try:
            stdout, _ = proc.communicate(timeout=_CANCEL_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            _kill_process_group(proc, signal.SIGKILL)
            stdout, _ = proc.communicate()
    finally:
        if run_id is not None:
            with _REGISTRY_LOCK:
                _PROCESS_REGISTRY.pop(run_id, None)

    cancelled = False
    if run_id is not None:
        with _REGISTRY_LOCK:
            cancelled = run_id in _CANCELLED_RUNS
            _CANCELLED_RUNS.discard(run_id)

    log_text = stdout or ""
    if timed_out:
        log_text += f"\n[runner] run killed after exceeding timeout of {timeout_seconds}s\n"
    if cancelled:
        log_text += "\n[runner] run cancelled by user request (FR-EXE-005)\n"
    log_path.write_text(redact_secrets(log_text), encoding="utf-8")

    logger.info(
        "pytest run finished: exit_code=%s cancelled=%s timed_out=%s",
        proc.returncode,
        cancelled,
        timed_out,
        extra={"run_id": run_id},
    )
    return {
        "exit_code": proc.returncode,
        "junit_path": str(junit_path),
        "log_path": str(log_path),
        "output_dir": str(output_dir),
        "cancelled": cancelled,
        "timed_out": timed_out,
    }


def start_run(
    run_id: str,
    test_paths: list[str],
    run_dir: Path,
    headed: bool = False,
    browser: str = "chromium",
    extra_env: dict[str, str] | None = None,
    markers: str = "",
    timeout_seconds: int = _DEFAULT_TIMEOUT_SECONDS,
    on_complete: Callable[[dict], None] | None = None,
) -> threading.Thread:
    """Start ``run_pytest`` in a background thread (non-blocking, FR-EXE-005).

    The child process is registered under ``run_id`` immediately, so
    ``cancel_run(run_id)`` works while the run is in flight.

    Args:
        run_id: Execution run id used as the cancellation-registry key.
        on_complete: Optional callback receiving the ``run_pytest`` result
            dict when the process finishes (also on cancel/timeout).
        (remaining args as in ``run_pytest``)

    Returns:
        The started daemon thread executing the run.
    """

    def _target() -> None:
        result = run_pytest(
            test_paths,
            run_dir,
            headed=headed,
            browser=browser,
            extra_env=extra_env,
            markers=markers,
            timeout_seconds=timeout_seconds,
            run_id=run_id,
        )
        if on_complete is not None:
            try:
                on_complete(result)
            except Exception:  # pragma: no cover - callback must not kill thread
                logger.exception("on_complete callback failed", extra={"run_id": run_id})

    thread = threading.Thread(target=_target, name=f"pytest-run-{run_id}", daemon=True)
    thread.start()
    return thread


def cancel_run(run_id: str) -> bool:
    """Cancel an in-flight pytest run by terminating its process group (FR-EXE-005).

    Sends SIGTERM to the process group so pytest and its browser children can
    shut down and flush partial results; escalates to SIGKILL after a grace
    period if the group is still alive.

    Args:
        run_id: Execution run id previously passed to ``run_pytest``/``start_run``.

    Returns:
        True if a live process was found and signalled, False otherwise.
    """
    with _REGISTRY_LOCK:
        proc = _PROCESS_REGISTRY.get(run_id)
        if proc is None or proc.poll() is not None:
            return False
        _CANCELLED_RUNS.add(run_id)

    logger.info("cancelling pytest run", extra={"run_id": run_id})
    _kill_process_group(proc, signal.SIGTERM)

    def _force_kill() -> None:
        if proc.poll() is None:
            _kill_process_group(proc, signal.SIGKILL)

    timer = threading.Timer(_CANCEL_GRACE_SECONDS, _force_kill)
    timer.daemon = True
    timer.start()
    return True


def get_running_run_ids() -> list[str]:
    """Return ids of runs whose processes are still alive (monitoring aid)."""
    with _REGISTRY_LOCK:
        return [rid for rid, proc in _PROCESS_REGISTRY.items() if proc.poll() is None]
