"""Unit tests for OpenAPI grounding and the payload-contract gate.

The incident these pin down (AIQA-EXEC-005): API generation sent
``json={"email": ...}`` to ``POST /login``, an endpoint that reads
form-encoded ``username``/``password`` — the server never received the
credentials, so positive tests failed falsely and negative tests passed
vacuously.
"""

from __future__ import annotations

import pytest

from agents import api_inspector, automation_agent
from agents.automation_agent import _DOC_ENDPOINT_RE
from app.models.schemas import GeneratedFile

pytestmark = pytest.mark.unit


#: Trimmed mirror of the sample-app's real /openapi.json.
SPEC = {
    "openapi": "3.1.0",
    "paths": {
        "/login": {
            "post": {
                "summary": "Login Submit",
                "requestBody": {
                    "content": {
                        "application/x-www-form-urlencoded": {
                            "schema": {"$ref": "#/components/schemas/LoginForm"}
                        }
                    }
                },
                "responses": {"200": {}, "422": {}},
            }
        },
        "/api/login": {
            "post": {
                "requestBody": {
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/LoginPayload"}
                        }
                    }
                },
                "responses": {"200": {}, "422": {}},
            }
        },
        "/api/items/{item_id}": {"delete": {"responses": {"204": {}}}},
        "/health": {"get": {"responses": {"200": {}}}},
    },
    "components": {
        "schemas": {
            "LoginForm": {
                "properties": {"username": {"type": "string"}, "password": {"type": "string"}},
                "required": ["username", "password"],
            },
            "LoginPayload": {
                "properties": {"username": {"type": "string"}, "password": {"type": "string"}},
            },
        }
    },
}


class TestDistill:
    def test_form_and_json_endpoints(self):
        surface = api_inspector.distill_openapi(SPEC)
        form = surface.find("post", "/login")
        assert form.content_type == api_inspector.FORM_CONTENT_TYPE
        assert form.fields == ["username", "password"]
        json_ep = surface.find("POST", "/api/login")
        assert json_ep.content_type == api_inspector.JSON_CONTENT_TYPE
        assert json_ep.fields == ["username", "password"]

    def test_path_templates_match(self):
        surface = api_inspector.distill_openapi(SPEC)
        assert surface.find("delete", "/api/items/42") is not None
        assert surface.find("delete", "/api/items/42/extra") is None

    def test_render_arms_endpoint_gate_and_names_encoding(self):
        surface = api_inspector.distill_openapi(SPEC)
        text = api_inspector.render_api_surface(surface, [{"steps": ["POST /login"]}])
        assert _DOC_ENDPOINT_RE.search(text)  # arms _ensure_documented_endpoints
        assert "use data={...}, NOT json=" in text
        assert "username, password" in text
        # test-case-referenced endpoints render first
        assert text.index("POST /login") < text.index("GET /health")

    def test_malformed_spec_never_raises(self):
        surface = api_inspector.distill_openapi({"paths": {"/x": "garbage"}})
        assert surface.endpoints == []

    def test_fetch_unreachable_is_fail_open(self):
        assert api_inspector.fetch_openapi("http://127.0.0.1:59999") is None
        assert api_inspector.collect_api_surface("http://127.0.0.1:59999") is None


def _test_file(body: str) -> GeneratedFile:
    return GeneratedFile(
        path="automation/generated_tests/test_api_admin_login.py",
        kind="test_file",
        content=body,
    )


BROKEN_CALL = '''
def test_login(api_client, credentials, target_available):
    response = api_client.post(
        "/login",
        json={"email": credentials.username, "password": credentials.password},
    )
    assert response.status_code in (302, 303)
'''

FIXED_CALL = '''
def test_login(api_client, credentials, target_available):
    response = api_client.post(
        "/login",
        data={"username": credentials.username, "password": credentials.password},
    )
    assert response.status_code == 200
'''


class TestPayloadGate:
    def _surface(self):
        return api_inspector.distill_openapi(SPEC)

    def test_incident_payload_is_rejected_with_teaching_message(self):
        with pytest.raises(ValueError) as exc:
            automation_agent._ensure_documented_payloads(
                [_test_file(BROKEN_CALL)], self._surface()
            )
        message = str(exc.value)
        assert "sent json=" in message
        assert "x-www-form-urlencoded" in message
        assert "username, password" in message

    def test_unknown_field_is_rejected(self):
        wrong_field = FIXED_CALL.replace('"username": credentials.username', '"email": credentials.username')
        with pytest.raises(ValueError, match="unknown"):
            automation_agent._ensure_documented_payloads(
                [_test_file(wrong_field)], self._surface()
            )

    def test_correct_form_call_passes(self):
        automation_agent._ensure_documented_payloads(
            [_test_file(FIXED_CALL)], self._surface()
        )

    def test_json_to_json_endpoint_passes_and_data_is_rejected(self):
        good = FIXED_CALL.replace('"/login"', '"/api/login"').replace("data=", "json=")
        automation_agent._ensure_documented_payloads([_test_file(good)], self._surface())
        bad = FIXED_CALL.replace('"/login"', '"/api/login"')
        with pytest.raises(ValueError, match="sent data="):
            automation_agent._ensure_documented_payloads([_test_file(bad)], self._surface())

    def test_fail_open_without_surface_or_unknown_endpoint(self):
        automation_agent._ensure_documented_payloads([_test_file(BROKEN_CALL)], None)
        other = BROKEN_CALL.replace('"/login"', '"/undocumented"')
        automation_agent._ensure_documented_payloads([_test_file(other)], self._surface())

    def test_non_literal_payload_is_skipped(self):
        dynamic = FIXED_CALL.replace(
            'data={"username": credentials.username, "password": credentials.password}',
            "data=payload",
        )
        automation_agent._ensure_documented_payloads(
            [_test_file(dynamic)], self._surface()
        )

    def test_page_objects_are_not_checked(self):
        page = GeneratedFile(
            path="automation/pages/x_page.py", kind="page_object", content="x = 1\n"
        )
        automation_agent._ensure_documented_payloads([page], self._surface())
