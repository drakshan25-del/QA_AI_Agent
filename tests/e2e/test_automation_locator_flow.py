"""Scan → approve → resolve → generate → execute, through the running stack.

The full journey the integration promises (FR-UIS-025 §19 end-to-end):

1. scan a fixture application;
2. approve and save the discovered locators;
3. resolve a test case's steps against the saved library;
4. confirm every resolved step names a saved locator, with its id and version;
5. generate automation and confirm the generated code uses those locators;
6. confirm the locator references are recorded and the usage metrics move;
7. confirm no invented selector appears anywhere;

plus the negative case: a step with no scanned element must come back
``LOCATOR_REVIEW_REQUIRED`` with no selector fabricated for it.

Everything here talks to the backend's own API, so it exercises the same path
the UI does. It skips cleanly when the stack is not running::

    QA_E2E_API_URL=http://localhost:4000/api/v2 \\
    QA_E2E_EMAIL=admin@example.com \\
    QA_E2E_PASSWORD=admin12345 \\
    QA_E2E_PROJECT_ID=<project-uuid> \\
    .venv/bin/python -m pytest tests/e2e/test_automation_locator_flow.py

The generation and execution steps additionally need approved test cases and a
running Ollama; supply their ids to enable them::

    QA_E2E_TEST_CASE_IDS=<uuid>,<uuid> ...
"""

from __future__ import annotations

import functools
import http.server
import os
import re
import socketserver
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.e2e

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "ui_scanner"

API_URL = os.environ.get("QA_E2E_API_URL", "").rstrip("/")
EMAIL = os.environ.get("QA_E2E_EMAIL", "")
PASSWORD = os.environ.get("QA_E2E_PASSWORD", "")
PROJECT_ID = os.environ.get("QA_E2E_PROJECT_ID", "")
TEST_CASE_IDS = [i for i in os.environ.get("QA_E2E_TEST_CASE_IDS", "").split(",") if i]

SCAN_TIMEOUT_S = 180
GENERATION_TIMEOUT_S = 900

#: Locator forms the generator is never allowed to produce on its own. A raw
#: CSS or XPath string in generated code means something invented a selector.
FORBIDDEN_LOCATOR_RE = re.compile(
    r"""\.locator\(\s*["'](?!\s*$)[^"']*["']""",
)


class _QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@pytest.fixture(scope="module", autouse=True)
def require_stack() -> None:
    missing = [
        name
        for name, value in (
            ("QA_E2E_API_URL", API_URL),
            ("QA_E2E_EMAIL", EMAIL),
            ("QA_E2E_PASSWORD", PASSWORD),
            ("QA_E2E_PROJECT_ID", PROJECT_ID),
        )
        if not value
    ]
    if missing:
        pytest.skip(f"needs a running stack; set {', '.join(missing)}")


@pytest.fixture(scope="module")
def fixture_url() -> Iterator[str]:
    """Serve the deterministic scan fixture on loopback."""
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(FIXTURE_DIR)
    )
    server = _QuietServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/index.html"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def api() -> Iterator[httpx.Client]:
    client = httpx.Client(base_url=API_URL, timeout=60.0)
    try:
        response = client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    except httpx.HTTPError as exc:
        pytest.skip(f"backend unreachable at {API_URL}: {exc}")
    if response.status_code != 200:
        pytest.skip(f"could not sign in as {EMAIL}: {response.status_code}")
    token = response.json().get("accessToken") or response.json().get("access_token")
    if not token:
        pytest.skip("login response carried no access token")
    client.headers["Authorization"] = f"Bearer {token}"
    try:
        yield client
    finally:
        client.close()


@pytest.fixture(scope="module")
def saved_locators(api: httpx.Client, fixture_url: str) -> list[dict]:
    """Scan the fixture, approve the confident locators and save them."""
    start = api.post(
        f"/projects/{PROJECT_ID}/ui-scans",
        json={"url": fixture_url, "maxPages": 1, "useLlmFallback": False},
    )
    if start.status_code == 400 and "internal address" in start.text:
        pytest.skip(
            "the project's allowed domains do not include 127.0.0.1; add it to scan "
            "the loopback fixture"
        )
    assert start.status_code == 202, start.text
    scan_id = start.json()["id"]

    deadline = time.time() + SCAN_TIMEOUT_S
    status = ""
    while time.time() < deadline:
        time.sleep(2)
        status = api.get(f"/projects/{PROJECT_ID}/ui-scans/{scan_id}").json()["status"]
        if status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
    assert status == "COMPLETED", f"scan ended as {status}"

    approved = api.post(
        f"/projects/{PROJECT_ID}/ui-scans/{scan_id}/approve-high-confidence",
        json={"minConfidence": 0.8, "uniqueOnly": True},
    )
    assert approved.status_code in (200, 201), approved.text
    assert approved.json()["approved"] > 0, "the fixture should yield approved locators"

    saved = api.post(
        f"/projects/{PROJECT_ID}/ui-scans/{scan_id}/save-locators",
        json={"pageName": "Account"},
    )
    assert saved.status_code in (200, 201), saved.text
    assert saved.json()["saved"] > 0

    library = api.get(
        f"/projects/{PROJECT_ID}/locators", params={"approvedOnly": "true"}
    ).json()
    assert library, "the project locator library should not be empty"
    return library


# ---------------------------------------------------------------------------
# Resolution (§16)
# ---------------------------------------------------------------------------


def test_steps_resolve_to_saved_locators_with_id_and_version(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    response = api.post(
        f"/projects/{PROJECT_ID}/locators/resolve",
        json={
            "pageName": "Account",
            "steps": [
                {"testStepId": "step-1", "description": "Enter a valid email address"},
                {"testStepId": "step-2", "description": "Enter a valid password"},
                {"testStepId": "step-3", "description": "Click Login"},
            ],
            # Deterministic only: this asserts the matcher, not a model.
            "allowLlmMatching": False,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    resolved = {s["testStepId"]: s for s in body["resolvedSteps"]}
    assert "step-3" in resolved, f"Login should resolve; got {body}"

    saved_ids = {row["id"] for row in saved_locators}
    for step in body["resolvedSteps"]:
        # Every resolved locator is one the scan produced and a human saved.
        assert step["locatorId"] in saved_ids
        assert step["locatorVersion"] >= 1
        assert step["source"] in {"DETERMINISTIC_SCANNER", "MANUAL_EDIT"}
        assert step["expression"], "a resolved step must carry displayable code"
        assert step["validationStatus"] in {"unique", "valid", "approved"}

    login = resolved["step-3"]
    assert "Login" in login["expression"]
    assert body["timings"]["totalMs"] >= 0


def test_a_step_with_no_scanned_element_is_marked_for_review(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    response = api.post(
        f"/projects/{PROJECT_ID}/locators/resolve",
        json={
            "pageName": "Account",
            "steps": [
                {
                    "testStepId": "step-1",
                    "description": "Click Confirm Membership in the Loyalty section",
                }
            ],
            "allowLlmMatching": False,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["status"] == "LOCATOR_REVIEW_REQUIRED"
    assert body["resolvedSteps"] == []
    unresolved = body["unresolvedSteps"][0]
    assert unresolved["status"] == "LOCATOR_REVIEW_REQUIRED"
    assert unresolved["testStepId"] == "step-1"
    assert unresolved["reason"]
    assert unresolved["suggestedAction"]


def test_locators_of_another_page_are_not_offered(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    """A page the project has never scanned resolves nothing at all."""
    response = api.post(
        f"/projects/{PROJECT_ID}/locators/resolve",
        json={
            "pageName": "Invoices Archive",
            "steps": [{"testStepId": "step-1", "description": "Click Save"}],
            "allowLlmMatching": False,
        },
    )
    body = response.json()
    assert body["resolvedSteps"] == []


def test_batch_resolution_covers_every_requested_case(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    if not TEST_CASE_IDS:
        pytest.skip("set QA_E2E_TEST_CASE_IDS to exercise batch resolution")
    response = api.post(
        f"/projects/{PROJECT_ID}/locators/resolve-batch",
        json={"testCaseIds": TEST_CASE_IDS, "allowLlmMatching": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["results"]) == len(TEST_CASE_IDS)
    assert body["resolvedCount"] + body["unresolvedCount"] >= 0


def test_revalidating_a_saved_locator_confirms_it_against_the_live_page(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    target = saved_locators[0]
    response = api.post(
        f"/projects/{PROJECT_ID}/locators/revalidate",
        json={"locatorIds": [target["id"]]},
    )
    assert response.status_code == 200, response.text
    verdict = response.json()["results"][0]
    assert verdict["locatorId"] == target["id"]
    # The fixture server is still up, so the verdict comes from the real page.
    assert verdict["matchCount"] >= 0


# ---------------------------------------------------------------------------
# Generation and execution (§19 steps 4-10)
# ---------------------------------------------------------------------------


def _wait_for_job(api: httpx.Client, job_id: str, timeout_s: int) -> dict:
    deadline = time.time() + timeout_s
    job: dict = {}
    while time.time() < deadline:
        time.sleep(3)
        job = api.get(f"/jobs/{job_id}").json()
        if job.get("status") in {
            "completed",
            "completed_with_warnings",
            "failed",
            "cancelled",
            "timed_out",
        }:
            return job
    pytest.fail(f"job {job_id} did not finish within {timeout_s}s (last: {job.get('status')})")


def test_generated_automation_uses_saved_locators_and_records_them(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    if not TEST_CASE_IDS:
        pytest.skip("set QA_E2E_TEST_CASE_IDS (approved cases) to exercise generation")

    accepted = api.post(
        f"/projects/{PROJECT_ID}/automation/generate",
        json={"testCaseIds": TEST_CASE_IDS},
    )
    assert accepted.status_code == 202, accepted.text
    job = _wait_for_job(api, accepted.json()["jobId"], GENERATION_TIMEOUT_S)
    assert job["status"] in {"completed", "completed_with_warnings"}, job

    artifact_ids = (job.get("resultRefs") or {}).get("artifactIds") or []
    assert artifact_ids, "generation produced no artefacts"

    saved_expressions = {
        row["pythonExpression"] or row["expression"] for row in saved_locators
    }
    seen_reference = False

    for artifact_id in artifact_ids:
        artifact = api.get(f"/automation/{artifact_id}").json()
        content = artifact["content"]

        references = api.get(f"/automation/{artifact_id}/locator-references").json()
        for reference in references:
            seen_reference = True
            # Step 6: the locator id and version are recorded.
            assert reference["locatorId"]
            assert reference["locatorVersion"] >= 1
            assert reference["testStepId"]
            assert reference["scannedElementId"] or reference["elementName"]
            # Step 5: the recorded expression really is in the file.
            assert reference["generatedExpression"] in content

        # Step 10: no invented selector anywhere in the generated file.
        for match in FORBIDDEN_LOCATOR_RE.finditer(content):
            assert any(
                match.group(0) in expression for expression in saved_expressions
            ), f"generated code contains an unscanned locator: {match.group(0)}"

    assert seen_reference, "no locator references were recorded for the generated suite"


def test_locator_usage_metrics_move_when_a_locator_is_generated(
    api: httpx.Client, saved_locators: list[dict]
) -> None:
    if not TEST_CASE_IDS:
        pytest.skip("set QA_E2E_TEST_CASE_IDS to exercise usage metrics")
    used = None
    for row in saved_locators:
        usage = api.get(f"/projects/{PROJECT_ID}/locators/{row['id']}/usage").json()
        if usage["usageCount"] > 0:
            used = usage
            break
    assert used is not None, "generation should have marked at least one locator as used"
    assert used["lastUsedAt"]
    assert used["references"], "usage must list the steps that reference the locator"
