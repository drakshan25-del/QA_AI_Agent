"""Unit tests for the V2 engine additions (Excel parsing, parse + plan API).

Marked ``unit`` — no Ollama, browser or network needed. The engine FastAPI app
is exercised via Starlette's TestClient with the engine token.
"""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient

from engine.parsers.excel import ExcelParseError, parse_excel
from engine.service.main import app

pytestmark = [pytest.mark.unit]

TOKEN = "dev-engine-token"  # matches the default ENGINE_TOKEN in tests


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _xlsx_bytes() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Stories"
    ws.append(["Title", "Story", "AcceptanceCriteria"])
    ws.append(["Login", "As a user I log in", "Valid creds land on dashboard"])
    ws.append(["Logout", "As a user I log out", "Session ends"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_excel_preserves_sheet_and_row(tmp_path):
    text, segments, meta = parse_excel(_xlsx_bytes(), "stories.xlsx")
    assert meta["sheets"] == ["Stories"]
    assert len(segments) == 2  # header row is consumed
    first = segments[0]
    assert first.page_or_sheet == "Stories"
    assert first.row_or_section == "row 2"
    assert "Login" in first.content
    assert first.metadata["columns"]["Title"] == "Login"  # FR-IN-008 cell traceability


def test_parse_excel_rejects_empty():
    from openpyxl import Workbook

    wb = Workbook()
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ExcelParseError):
        parse_excel(buf.getvalue(), "empty.xlsx")


def test_health_endpoint_no_auth(client):
    r = client.get("/internal/v1/health")
    assert r.status_code == 200
    assert r.json()["schema_version"] == "v1"


def test_engine_requires_token(client):
    r = client.post("/internal/v1/validate", json={"files": []})
    assert r.status_code == 401


def test_parse_endpoint_xlsx(client):
    b64 = base64.b64encode(_xlsx_bytes()).decode()
    r = client.post(
        "/internal/v1/parse",
        headers={"X-Engine-Token": TOKEN},
        json={"files": [{"filename": "stories.xlsx", "category": "user_story", "contentBase64": b64}]},
    )
    assert r.status_code == 200
    doc = r.json()["documents"][0]
    assert doc["kind"] == "xlsx"
    assert doc["parse_status"] == "parsed"
    assert len(doc["segments"]) == 2


def test_validate_endpoint_blocks_unsafe(client):
    r = client.post(
        "/internal/v1/validate",
        headers={"X-Engine-Token": TOKEN},
        json={
            "files": [
                {"path": "automation/generated_tests/test_x.py",
                 "content": "import time\ntime.sleep(5)\napi_key = \"sk-hardcoded-secret-value\"\n"}
            ],
            "allowedDomains": ["localhost"],
            "runCollection": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["passed"] is False
    assert sum(1 for i in body["issues"] if i["severity"] == "error") >= 2


def test_execution_plan_maps_steps(client):
    r = client.post(
        "/internal/v1/execution-plan",
        headers={"X-Engine-Token": TOKEN},
        json={
            "baseUrl": "https://example.test",
            "testCases": [
                {"id": "tc1", "case_key": "TC-001", "title": "Login",
                 "steps": ["Enter email", "Click Sign In"],
                 "expected_results": ["Dashboard shown"]}
            ],
        },
    )
    assert r.status_code == 200
    plan = r.json()["plans"][0]
    actions = [s["action_type"] for s in plan["steps"]]
    assert actions[0] == "navigate"  # always opens the page first
    assert "fill" in actions and "click" in actions and "assert" in actions
