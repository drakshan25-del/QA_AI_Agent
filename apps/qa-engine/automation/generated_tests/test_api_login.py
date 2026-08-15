import time

import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api]


# TC: TC-001 Valid admin login redirects to /dashboard within 3 seconds
# REQ: REQ-AUTH
def test_api_admin_login_redirects_to_dashboard(api_client, credentials, target_available) -> None:
    start_time = time.monotonic()
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    elapsed = time.monotonic() - start_time

    assert response.status_code == 200
    assert elapsed < 3.0

    body = response.json()
    redirect_target = body.get("redirect") or body.get("location") or ""
    assert "/dashboard" in redirect_target or body.get("status") == "ok"


# TC: TC-007 Already-authenticated admin visiting /login is redirected to /dashboard
# REQ: REQ-AUTH
def test_api_authenticated_admin_login_redirects(api_client, credentials, target_available) -> None:
    login_response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert login_response.status_code == 200

    response = api_client.get("/login", follow_redirects=False)
    assert response.status_code in (301, 302, 303, 307, 308)
    location = response.headers.get("location", "")
    assert "/dashboard" in location
