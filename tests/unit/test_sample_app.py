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


def _login(client: TestClient, username: str = USERNAME, password: str = PASSWORD):
    return client.post("/login", data={"username": username, "password": password})


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
