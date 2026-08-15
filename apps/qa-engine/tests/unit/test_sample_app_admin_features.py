"""Unit tests for the sample app's admin features (Features 1-3).

Covers: role-based login redirection, dashboard data (HTML + API), admin
user CRUD with validation/authorization, product CRUD with validation,
search/sort/pagination, deletion confirmation flows, password hashing and
non-exposure, self-delete prevention, and expired-session handling — all
through FastAPI's TestClient (no server, browser or network).
"""

from __future__ import annotations

import copy
import json
import re

import pytest
from fastapi.testclient import TestClient

from sample_app import main as sample_app
from sample_app import store

pytestmark = pytest.mark.unit

USER_EMAIL = "qa-user@example.com"
USER_PASSWORD = "unit-test-pass"
ADMIN_EMAIL = "boss@example.com"
ADMIN_PASSWORD = "unit-admin-pass-1"


@pytest.fixture()
def client(monkeypatch):
    """TestClient with known credentials, fresh seed data, state restored."""
    monkeypatch.setenv("QA_TEST_USERNAME", USER_EMAIL)
    monkeypatch.setenv("QA_TEST_PASSWORD", USER_PASSWORD)
    monkeypatch.setenv("SAMPLE_ADMIN_EMAIL", ADMIN_EMAIL)
    monkeypatch.setenv("SAMPLE_ADMIN_PASSWORD", ADMIN_PASSWORD)
    monkeypatch.delenv("SAMPLE_APP_DEFECTS", raising=False)

    admins_before = copy.deepcopy(store.ADMINS)
    products_before = copy.deepcopy(store.PRODUCTS)
    next_before = dict(store._NEXT_ID)
    items_before = list(store.ITEMS)
    store.reset_demo_data()
    store.SESSIONS.clear()
    store.FLASHES.clear()
    store.FLASH_KINDS.clear()
    try:
        yield TestClient(sample_app.app)
    finally:
        store.ADMINS.clear()
        store.ADMINS.update(admins_before)
        store.PRODUCTS.clear()
        store.PRODUCTS.update(products_before)
        store._NEXT_ID.update(next_before)
        store.ITEMS[:] = items_before
        store.SESSIONS.clear()
        store.FLASHES.clear()
        store.FLASH_KINDS.clear()


#: Marks a request as a top-level browser form submit: POST /login keeps the
#: HTML redirect flow for these and answers API clients with JSON.
BROWSER_FORM = {"Sec-Fetch-Mode": "navigate"}


def _login_admin_html(client: TestClient):
    return client.post(
        "/login",
        data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers=BROWSER_FORM,
    )


def _login_user_html(client: TestClient):
    return client.post(
        "/login",
        data={"username": USER_EMAIL, "password": USER_PASSWORD},
        headers=BROWSER_FORM,
    )


def _admin_headers(client: TestClient) -> dict[str, str]:
    token = client.post(
        "/api/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _user_headers(client: TestClient) -> dict[str, str]:
    token = client.post(
        "/api/login", json={"username": USER_EMAIL, "password": USER_PASSWORD}
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _stat(text: str, testid: str) -> str:
    match = re.search(f'data-testid="{testid}">([^<]+)<', text)
    assert match, f"stat {testid} not found in page"
    return match.group(1)


class TestLoginRedirect:
    def test_admin_login_lands_on_dashboard_with_welcome_flash(self, client):
        response = _login_admin_html(client)
        assert response.status_code == 200
        assert str(response.url).endswith("/dashboard")
        assert 'data-testid="flash"' in response.text
        assert "Welcome" in response.text

    def test_regular_user_still_lands_on_items(self, client):
        response = _login_user_html(client)
        assert str(response.url).endswith("/items")
        assert "Welcome" in response.text

    def test_api_login_reports_role(self, client):
        admin = client.post("/api/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert admin.status_code == 200
        assert admin.json()["role"] == "admin"
        user = client.post("/api/login", json={"username": USER_EMAIL, "password": USER_PASSWORD})
        assert user.json()["role"] == "user"

    def test_disabled_admin_cannot_log_in(self, client):
        store.ADMINS[1]["status"] = "disabled"
        response = _login_admin_html(client)
        assert str(response.url).endswith("/login")
        assert "Invalid credentials" in response.text

    def test_logout_ends_the_session(self, client):
        _login_admin_html(client)
        response = client.post("/logout")
        assert str(response.url).endswith("/login")
        assert client.get("/dashboard").url.path == "/login"


class TestAuthorization:
    def test_admin_pages_require_login(self, client):
        for path in ("/dashboard", "/admin", "/products"):
            response = client.get(path)
            assert str(response.url).endswith("/login"), path

    def test_regular_user_is_turned_away_from_admin_pages(self, client):
        _login_user_html(client)
        response = client.get("/dashboard")
        assert str(response.url).endswith("/items")
        assert "not authorized" in response.text.lower()

    def test_api_endpoints_401_without_token(self, client):
        assert client.get("/api/dashboard/summary").status_code == 401
        assert client.get("/api/admin/users").status_code == 401
        assert client.post("/api/products", json={}).status_code == 401

    def test_api_endpoints_403_for_regular_user(self, client):
        headers = _user_headers(client)
        assert client.get("/api/dashboard/summary", headers=headers).status_code == 403
        assert client.get("/api/admin/users", headers=headers).status_code == 403
        assert client.delete("/api/products/1", headers=headers).status_code == 403

    def test_expired_session_token_is_rejected(self, client):
        headers = _admin_headers(client)
        token = headers["Authorization"].removeprefix("Bearer ")
        del store.SESSIONS[token]
        assert client.get("/api/dashboard/summary", headers=headers).status_code == 401

    def test_disabling_an_admin_revokes_an_existing_session(self, client):
        headers = _admin_headers(client)
        store.ADMINS[1]["status"] = "disabled"
        assert client.get("/api/admin/users", headers=headers).status_code == 403


class TestDashboard:
    def test_cards_show_live_store_totals(self, client):
        _login_admin_html(client)
        page = client.get("/dashboard").text
        assert _stat(page, "stat-total-admins") == str(len(store.ADMINS))
        assert _stat(page, "stat-total-products") == str(len(store.PRODUCTS))
        assert _stat(page, "stat-stock-units") == str(sum(p["stock"] for p in store.PRODUCTS.values()))

    def test_charts_and_recent_lists_render(self, client):
        _login_admin_html(client)
        page = client.get("/dashboard").text
        assert 'data-testid="chart-products-by-category"' in page
        assert 'data-testid="chart-admins-by-role"' in page
        assert 'data-testid="recent-products"' in page
        assert "Gel Pen Set" in page  # newest seeded product is in the recent list

    def test_dashboard_reflects_product_changes(self, client):
        headers = _admin_headers(client)
        before = client.get("/api/dashboard/summary", headers=headers).json()
        client.post("/api/products", headers=headers, json={
            "name": "Test Monitor", "category": "Electronics", "price": 199.0, "stock": 5})
        after = client.get("/api/dashboard/summary", headers=headers).json()
        assert after["products"]["total"] == before["products"]["total"] + 1
        assert after["products"]["recent"][0]["name"] == "Test Monitor"

    def test_empty_product_store_shows_empty_states(self, client):
        store.PRODUCTS.clear()
        _login_admin_html(client)
        page = client.get("/dashboard").text
        assert 'data-testid="chart-products-by-category-empty"' in page
        assert 'data-testid="recent-products-empty"' in page

    def test_summary_api_never_leaks_password_material(self, client):
        headers = _admin_headers(client)
        raw = json.dumps(client.get("/api/dashboard/summary", headers=headers).json())
        assert "password" not in raw
        raw_admins = json.dumps(client.get("/api/admin/users", headers=headers).json())
        assert "password" not in raw_admins


class TestAdminApiCrud:
    def test_create_admin_hashes_password_and_hides_it(self, client):
        headers = _admin_headers(client)
        response = client.post("/api/admin/users", headers=headers, json={
            "name": "New Admin", "email": "new@example.com",
            "password": "supersecret1", "role": "manager", "status": "active"})
        assert response.status_code == 201
        body = response.json()["admin"]
        assert "password" not in json.dumps(body)
        stored = store.ADMINS[body["id"]]
        assert stored["password_hash"].startswith("pbkdf2_sha256$")
        assert "supersecret1" not in stored["password_hash"]
        assert store.verify_password("supersecret1", stored["password_hash"])

    def test_duplicate_email_rejected_case_insensitively(self, client):
        headers = _admin_headers(client)
        response = client.post("/api/admin/users", headers=headers, json={
            "name": "Dup", "email": ADMIN_EMAIL.upper(), "password": "supersecret1"})
        assert response.status_code == 409
        assert response.json() == {"error": "duplicate_email"}

    @pytest.mark.parametrize("payload,code", [
        ({"email": "a@b.co", "password": "supersecret1"}, "name_required"),
        ({"name": "X", "password": "supersecret1"}, "email_required"),
        ({"name": "X", "email": "not-an-email", "password": "supersecret1"}, "invalid_email"),
        ({"name": "X", "email": "x@y.co"}, "password_required"),
        ({"name": "X", "email": "x@y.co", "password": "short"}, "weak_password"),
        ({"name": "X", "email": "x@y.co", "password": "supersecret1", "role": "root"}, "invalid_role"),
        ({"name": "X", "email": "x@y.co", "password": "supersecret1", "status": "frozen"}, "invalid_status"),
    ])
    def test_create_validation_errors(self, client, payload, code):
        response = client.post("/api/admin/users", headers=_admin_headers(client), json=payload)
        assert response.status_code == 422
        assert response.json() == {"error": code}

    def test_update_without_password_keeps_old_hash(self, client):
        headers = _admin_headers(client)
        created = client.post("/api/admin/users", headers=headers, json={
            "name": "Keep Hash", "email": "keep@example.com", "password": "supersecret1"}).json()["admin"]
        hash_before = store.ADMINS[created["id"]]["password_hash"]
        response = client.put(f"/api/admin/users/{created['id']}", headers=headers,
                              json={"name": "Kept Hash", "role": "manager"})
        assert response.status_code == 200
        assert response.json()["admin"]["name"] == "Kept Hash"
        assert store.ADMINS[created["id"]]["password_hash"] == hash_before

    def test_update_to_existing_email_conflicts(self, client):
        headers = _admin_headers(client)
        created = client.post("/api/admin/users", headers=headers, json={
            "name": "Second", "email": "second@example.com", "password": "supersecret1"}).json()["admin"]
        response = client.put(f"/api/admin/users/{created['id']}", headers=headers,
                              json={"email": ADMIN_EMAIL})
        assert response.status_code == 409

    def test_delete_other_admin_works_but_self_is_refused(self, client):
        headers = _admin_headers(client)
        created = client.post("/api/admin/users", headers=headers, json={
            "name": "Victim", "email": "victim@example.com", "password": "supersecret1"}).json()["admin"]
        assert client.delete(f"/api/admin/users/{created['id']}", headers=headers).status_code == 204
        assert created["id"] not in store.ADMINS
        me = client.delete("/api/admin/users/1", headers=headers)
        assert me.status_code == 409
        assert me.json() == {"error": "cannot_delete_self"}
        assert 1 in store.ADMINS

    def test_missing_admin_404(self, client):
        headers = _admin_headers(client)
        assert client.put("/api/admin/users/999", headers=headers, json={}).status_code == 404
        assert client.delete("/api/admin/users/999", headers=headers).status_code == 404

    def test_search_and_filters(self, client):
        headers = _admin_headers(client)
        client.post("/api/admin/users", headers=headers, json={
            "name": "Search Target", "email": "target@example.com",
            "password": "supersecret1", "role": "manager", "status": "disabled"})
        found = client.get("/api/admin/users?q=target", headers=headers).json()["admins"]
        assert [a["email"] for a in found] == ["target@example.com"]
        disabled = client.get("/api/admin/users?status=disabled", headers=headers).json()["admins"]
        assert all(a["status"] == "disabled" for a in disabled) and disabled
        managers = client.get("/api/admin/users?role=manager", headers=headers).json()["admins"]
        assert all(a["role"] == "manager" for a in managers) and managers


class TestAdminHtml:
    def test_create_edit_delete_flow_with_flashes(self, client):
        _login_admin_html(client)
        created = client.post("/admin/users/add", data={
            "name": "Flow Admin", "email": "flow@example.com",
            "password": "supersecret1", "role": "admin", "status": "active"})
        assert str(created.url).endswith("/admin")
        assert "created" in created.text and "Flow Admin" in created.text

        admin_id = store.find_admin_by_email("flow@example.com")["id"]
        updated = client.post(f"/admin/users/{admin_id}/update", data={
            "name": "Flow Admin 2", "email": "flow@example.com",
            "password": "", "role": "manager", "status": "active"})
        assert "updated" in updated.text and "Flow Admin 2" in updated.text

        confirm = client.get(f"/admin/users/{admin_id}/delete")
        assert 'data-testid="confirm-dialog"' in confirm.text
        assert "Flow Admin 2" in confirm.text

        deleted = client.post(f"/admin/users/{admin_id}/delete")
        assert "deleted" in deleted.text
        assert store.find_admin_by_email("flow@example.com") is None

    def test_validation_error_rerenders_form_with_values(self, client):
        _login_admin_html(client)
        response = client.post("/admin/users/add", data={
            "name": "Bad Email", "email": "nope", "password": "supersecret1",
            "role": "admin", "status": "active"})
        assert response.status_code == 200
        assert "not valid" in response.text
        assert 'value="Bad Email"' in response.text  # entered values preserved

    def test_self_delete_via_html_is_refused(self, client):
        _login_admin_html(client)
        response = client.post("/admin/users/1/delete")
        assert "cannot delete your own" in response.text.lower()
        assert 1 in store.ADMINS

    def test_search_with_no_match_shows_empty_state(self, client):
        _login_admin_html(client)
        page = client.get("/admin?q=zzz-no-such-admin").text
        assert 'data-testid="admins-empty"' in page


class TestProductApiCrud:
    def test_create_and_list(self, client):
        headers = _admin_headers(client)
        response = client.post("/api/products", headers=headers, json={
            "name": "Webcam", "description": "1080p webcam", "category": "Electronics",
            "price": 49.99, "stock": 25})
        assert response.status_code == 201
        product = response.json()["product"]
        assert product["status"] == "active"
        listed = client.get("/api/products?q=webcam", headers=headers).json()
        assert listed["total"] == 1
        assert listed["products"][0]["name"] == "Webcam"

    @pytest.mark.parametrize("payload,code", [
        ({"category": "X", "price": 1, "stock": 1}, "name_required"),
        ({"name": "P1", "price": 1, "stock": 1}, "category_required"),
        ({"name": "P1", "category": "X", "price": -5, "stock": 1}, "invalid_price"),
        ({"name": "P1", "category": "X", "price": "abc", "stock": 1}, "invalid_price"),
        ({"name": "P1", "category": "X", "price": 1, "stock": -2}, "invalid_stock"),
        ({"name": "P1", "category": "X", "price": 1, "stock": 2.5}, "invalid_stock"),
        ({"name": "P1", "category": "X", "price": 1, "stock": 1, "image_url": "ftp://x"}, "invalid_image_url"),
        ({"name": "P1", "category": "X", "price": 1, "stock": 1, "status": "gone"}, "invalid_status"),
        ({"name": "Wireless Mouse", "category": "X", "price": 1, "stock": 1}, "duplicate_name"),
    ])
    def test_validation_errors(self, client, payload, code):
        response = client.post("/api/products", headers=_admin_headers(client), json=payload)
        assert response.status_code in (409, 422)
        assert response.json() == {"error": code}

    def test_update_and_delete(self, client):
        headers = _admin_headers(client)
        response = client.put("/api/products/1", headers=headers, json={"price": 19.99, "stock": 80})
        assert response.status_code == 200
        assert store.PRODUCTS[1]["price"] == 19.99
        assert client.delete("/api/products/1", headers=headers).status_code == 204
        assert client.delete("/api/products/1", headers=headers).status_code == 404

    def test_negative_price_update_rejected(self, client):
        response = client.put("/api/products/2", headers=_admin_headers(client), json={"price": -1})
        assert response.status_code == 422
        assert response.json() == {"error": "invalid_price"}

    def test_sorting_and_filtering(self, client):
        headers = _admin_headers(client)
        cheapest = client.get("/api/products?sort=price&order=asc", headers=headers).json()
        prices = [p["price"] for p in cheapest["products"]]
        assert prices == sorted(prices)
        stationery = client.get("/api/products?category=Stationery", headers=headers).json()
        assert {p["category"] for p in stationery["products"]} == {"Stationery"}
        inactive = client.get("/api/products?status=inactive", headers=headers).json()
        assert [p["name"] for p in inactive["products"]] == ["USB-C Hub"]

    def test_pagination_math_and_clamping(self, client):
        headers = _admin_headers(client)
        listed = client.get("/api/products?page_size=4", headers=headers).json()
        assert listed["total"] == 6 and listed["pages"] == 2 and len(listed["products"]) == 4
        page2 = client.get("/api/products?page_size=4&page=2", headers=headers).json()
        assert len(page2["products"]) == 2
        clamped = client.get("/api/products?page_size=4&page=99", headers=headers).json()
        assert clamped["page"] == 2  # out-of-range page clamps to the last page


class TestProductHtml:
    def test_create_edit_delete_flow_with_flashes(self, client):
        _login_admin_html(client)
        created = client.post("/products/add", data={
            "name": "Desk Lamp", "description": "LED lamp", "category": "Accessories",
            "price": "29.99", "stock": "40", "image_url": "", "status": "active"})
        assert "created" in created.text and "Desk Lamp" in created.text

        product = next(p for p in store.PRODUCTS.values() if p["name"] == "Desk Lamp")
        updated = client.post(f"/products/{product['id']}/update", data={
            "name": "Desk Lamp", "description": "LED lamp", "category": "Accessories",
            "price": "24.99", "stock": "35", "image_url": "", "status": "inactive"})
        assert "updated" in updated.text
        assert store.PRODUCTS[product["id"]]["price"] == 24.99

        confirm = client.get(f"/products/{product['id']}/delete")
        assert 'data-testid="confirm-dialog"' in confirm.text and "Desk Lamp" in confirm.text
        deleted = client.post(f"/products/{product['id']}/delete")
        assert "deleted" in deleted.text
        assert product["id"] not in store.PRODUCTS

    def test_invalid_price_rerenders_with_error(self, client):
        _login_admin_html(client)
        response = client.post("/products/add", data={
            "name": "Bad Product", "description": "", "category": "X",
            "price": "-3", "stock": "1", "image_url": "", "status": "active"})
        assert response.status_code == 200
        assert "Price must be" in response.text
        assert 'value="Bad Product"' in response.text

    def test_pagination_controls_appear_beyond_one_page(self, client):
        headers = _admin_headers(client)
        for i in range(5):  # 6 seeded + 5 = 11 > page size 8
            client.post("/api/products", headers=headers, json={
                "name": f"Bulk {i}", "category": "Bulk", "price": 1, "stock": 1})
        _login_admin_html(client)
        page = client.get("/products").text
        assert "Page 1 of 2" in page
        page2 = client.get("/products?page=2").text
        assert "Page 2 of 2" in page2
        assert 'data-testid="product-row"' in page2

    def test_search_with_no_match_shows_empty_state(self, client):
        _login_admin_html(client)
        page = client.get("/products?q=zzz-no-such-product").text
        assert 'data-testid="products-empty"' in page


class TestLegacySurfaceIntact:
    def test_items_page_selector_contract_untouched(self, client):
        _login_user_html(client)
        page = client.get("/items").text
        assert 'data-testid="item"' in page
        assert 'data-testid="new-item"' in page
        assert ">Add</button>" in page and ">Delete</button>" in page

    def test_regular_user_nav_has_no_admin_links(self, client):
        _login_user_html(client)
        page = client.get("/items").text
        assert 'href="/dashboard"' not in page
        assert 'href="/products"' not in page

    def test_duplicate_form_submission_is_rejected_not_duplicated(self, client):
        _login_admin_html(client)
        form = {"name": "Once Only", "email": "once@example.com",
                "password": "supersecret1", "role": "admin", "status": "active"}
        client.post("/admin/users/add", data=form)
        second = client.post("/admin/users/add", data=form)
        assert "already exists" in second.text
        assert sum(1 for a in store.ADMINS.values() if a["email"] == "once@example.com") == 1
