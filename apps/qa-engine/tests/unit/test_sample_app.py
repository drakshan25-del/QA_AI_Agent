"""Unit tests for the demo target application (SRS §16, §15.2).

Exercises sample_app.main entirely through FastAPI's TestClient — no
uvicorn server, browser or network (SRS §15.1). Also proves the seeded
'login_message' defect flips behaviour via the SAMPLE_APP_DEFECTS env var,
which underpins the defect-detection-rate metric (§15.2).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sample_app import main as sample_app

pytestmark = pytest.mark.unit

USERNAME = "qa-user@example.com"
PASSWORD = "unit-test-pass"


@pytest.fixture()
def client(monkeypatch):
    """TestClient with known credentials, no seeded defects, state restored."""
    monkeypatch.setenv("QA_TEST_USERNAME", USERNAME)
    monkeypatch.setenv("QA_TEST_PASSWORD", PASSWORD)
    monkeypatch.delenv("SAMPLE_APP_DEFECTS", raising=False)

    items_before = list(sample_app.ITEMS)
    sessions_before = dict(sample_app.SESSIONS)
    flashes_before = dict(sample_app.FLASHES)
    try:
        yield TestClient(sample_app.app)
    finally:
        sample_app.ITEMS[:] = items_before
        sample_app.SESSIONS.clear()
        sample_app.SESSIONS.update(sessions_before)
        sample_app.FLASHES.clear()
        sample_app.FLASHES.update(flashes_before)


#: Marks a request as a top-level browser form submit: POST /login keeps the
#: HTML redirect flow for these and answers API clients with JSON.
BROWSER_FORM = {"Sec-Fetch-Mode": "navigate"}


def _login(client: TestClient, username: str = USERNAME, password: str = PASSWORD):
    return client.post(
        "/login",
        data={"username": username, "password": password},
        headers=BROWSER_FORM,
    )


class TestHealthAndLoginPage:
    def test_health_probe(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_login_page_has_form_testids(self, client):
        response = client.get("/login")
        assert response.status_code == 200
        assert 'data-testid="username"' in response.text
        assert 'data-testid="password"' in response.text


class TestLogin:
    def test_success_redirects_to_items_with_welcome_flash(self, client):
        response = _login(client)
        # TestClient follows the 303 redirect to /items.
        assert response.status_code == 200
        assert str(response.url).endswith("/items")
        assert 'data-testid="flash"' in response.text
        assert "Welcome" in response.text

    def test_failure_shows_invalid_credentials_flash(self, client):
        response = _login(client, password="wrong-password")
        assert response.status_code == 200
        assert 'data-testid="flash"' in response.text
        assert "Invalid credentials" in response.text
        assert "Server error" not in response.text

    def test_seeded_login_message_defect_changes_flash(self, client, monkeypatch):
        # §15.2 ground truth: with the defect seeded, the same failed login
        # flashes 'Server error' instead of 'Invalid credentials'.
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "login_message")
        response = _login(client, password="wrong-password")
        assert "Server error" in response.text
        assert "Invalid credentials" not in response.text

    def test_items_requires_session(self, client):
        response = client.get("/items")
        # Unauthenticated visitors land back on the login form.
        assert str(response.url).endswith("/login")
        assert 'data-testid="username"' in response.text


class TestItems:
    def test_add_item_appears_once(self, client):
        _login(client)
        response = client.post("/items/add", data={"text": "Buy milk"})
        assert response.status_code == 200
        assert response.text.count("Buy milk") == 1
        assert "Buy milk" in sample_app.ITEMS

    def test_seeded_duplicate_add_defect_inserts_twice(self, client, monkeypatch):
        _login(client)
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "duplicate_add")
        client.post("/items/add", data={"text": "Twice added"})
        assert sample_app.ITEMS.count("Twice added") == 2

    def test_blank_item_ignored(self, client):
        _login(client)
        before = len(sample_app.ITEMS)
        client.post("/items/add", data={"text": "   "})
        assert len(sample_app.ITEMS) == before

    def test_delete_item_removes_it(self, client):
        _login(client)
        target = sample_app.ITEMS[0]
        response = client.post("/items/0/delete")
        assert response.status_code == 200
        assert target not in sample_app.ITEMS

    def test_seeded_delete_noop_defect_keeps_item(self, client, monkeypatch):
        _login(client)
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "delete_noop")
        target = sample_app.ITEMS[0]
        client.post("/items/0/delete")
        assert sample_app.ITEMS[0] == target

    def test_add_requires_session(self, client):
        before = len(sample_app.ITEMS)
        response = client.post("/items/add", data={"text": "sneaky"})
        assert str(response.url).endswith("/login")
        assert len(sample_app.ITEMS) == before


def _api_login(client: TestClient, username: str = USERNAME, password: str = PASSWORD):
    return client.post("/api/login", json={"username": username, "password": password})


def _bearer(client: TestClient) -> dict[str, str]:
    token = _api_login(client).json()["token"]
    return {"Authorization": f"Bearer {token}"}


class TestJsonApi:
    """The additive /api/* JSON surface shares state and seeded defects with
    the HTML routes (module docstring 'JSON API contract')."""

    def test_api_health(self, client):
        assert client.get("/api/health").json() == {"status": "ok"}

    def test_login_returns_token(self, client):
        response = _api_login(client)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["token"] in sample_app.SESSIONS

    def test_login_success_carries_welcome_message(self, client):
        # US-103: the 200 body includes the same success message the HTML
        # flash shows, so API tests can assert a human-readable confirmation.
        response = _api_login(client)
        assert response.status_code == 200
        assert response.json()["message"] == "Welcome"

    def test_form_login_without_browser_navigation_returns_json_envelope(self, client):
        # curl/Swagger/httpx post the same form without Sec-Fetch-Mode:
        # navigate — they get the documented JSON contract, not a redirect.
        response = client.post(
            "/login", data={"username": USERNAME, "password": PASSWORD}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "success"
        assert body["message"] == "Login successful"
        assert body["data"]["user"]["email"] == USERNAME
        auth = body["data"]["authentication"]
        assert auth["tokenType"] == "Bearer"
        assert auth["accessToken"] in sample_app.SESSIONS
        # The issued token works immediately as Bearer auth on /api/*.
        items = client.get(
            "/api/items", headers={"Authorization": f"Bearer {auth['accessToken']}"}
        )
        assert items.status_code == 200

    def test_form_login_api_style_rejects_bad_credentials_with_401(self, client):
        response = client.post(
            "/login", data={"username": USERNAME, "password": "wrong-" + PASSWORD}
        )
        assert response.status_code == 401
        assert response.json() == {
            "status": "error",
            "message": "Invalid credentials",
        }

    def test_login_rejects_bad_password(self, client):
        response = _api_login(client, password="wrong-" + PASSWORD)
        assert response.status_code == 401
        assert response.json() == {"error": "invalid_credentials"}

    def test_seeded_login_message_defect_becomes_500(self, client, monkeypatch):
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "login_message")
        response = _api_login(client, password="wrong-" + PASSWORD)
        assert response.status_code == 500
        assert response.json() == {"error": "server_error"}

    def test_items_require_auth(self, client):
        assert client.get("/api/items").status_code == 401
        assert client.post("/api/items", json={"text": "x"}).status_code == 401
        assert client.delete("/api/items/0").status_code == 401

    def test_bearer_token_lists_items(self, client):
        response = client.get("/api/items", headers=_bearer(client))
        assert response.status_code == 200
        items = response.json()["items"]
        assert [item["text"] for item in items] == sample_app.ITEMS
        assert all(set(item) == {"id", "text"} for item in items)

    def test_add_item_appears_in_html_list_too(self, client):
        headers = _bearer(client)
        response = client.post("/api/items", json={"text": "api-added"}, headers=headers)
        assert response.status_code == 201
        assert response.json()["item"]["text"] == "api-added"
        # Shared state: the HTML surface sees the API-added item.
        assert sample_app.ITEMS.count("api-added") == 1

    def test_blank_text_rejected_with_422(self, client):
        response = client.post("/api/items", json={"text": "   "}, headers=_bearer(client))
        assert response.status_code == 422
        assert response.json() == {"error": "text_required"}

    def test_seeded_duplicate_add_defect_inserts_twice(self, client, monkeypatch):
        headers = _bearer(client)
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "duplicate_add")
        client.post("/api/items", json={"text": "dup-api"}, headers=headers)
        assert sample_app.ITEMS.count("dup-api") == 2

    def test_delete_removes_item(self, client):
        headers = _bearer(client)
        target = sample_app.ITEMS[0]
        response = client.delete("/api/items/0", headers=headers)
        assert response.status_code == 204
        assert target not in sample_app.ITEMS

    def test_delete_out_of_range_404(self, client):
        response = client.delete(f"/api/items/{len(sample_app.ITEMS)}", headers=_bearer(client))
        assert response.status_code == 404

    def test_seeded_delete_noop_defect_keeps_item(self, client, monkeypatch):
        headers = _bearer(client)
        monkeypatch.setenv("SAMPLE_APP_DEFECTS", "delete_noop")
        target = sample_app.ITEMS[0]
        response = client.delete("/api/items/0", headers=headers)
        assert response.status_code == 204
        assert sample_app.ITEMS[0] == target
