import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api]

# POST /login takes application/x-www-form-urlencoded with fields
# username/password (see /openapi.json). API clients such as the api_client
# fixture receive the JSON contract — 200 + success envelope on valid
# credentials, 401 + error envelope otherwise. The 303 redirect to /dashboard
# is browser-only behaviour and is covered by the UI suite.


# TC: TC-001 Successful admin login redirects to /dashboard within 3 seconds
# REQ: 9c137d2a-c248-4960-91ab-5db80118dd94
def test_successful_admin_login_redirects_to_dashboard(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/login",
        data={"username": credentials.username, "password": credentials.password},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["user"]["role"] == "admin"
    assert body["data"]["authentication"]["accessToken"]


# TC: TC-003 Email matching is case-insensitive during admin login
# REQ: 9c137d2a-c248-4960-91ab-5db80118dd94
def test_email_matching_case_insensitive(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/login",
        data={"username": credentials.username.upper(), "password": credentials.password},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"


# TC: TC-004 Password comparison is case-sensitive during admin login
# REQ: 9c137d2a-c248-4960-91ab-5db80118dd94
def test_password_comparison_case_sensitive(api_client, credentials, target_available) -> None:
    # swapcase flips every letter, so the value always differs from the real
    # password even when it is already all-lowercase (e.g. "change-me")
    response = api_client.post(
        "/login",
        data={"username": credentials.username, "password": credentials.password.swapcase()},
    )
    assert response.status_code == 401
    assert response.json()["status"] == "error"


# TC: TC-008 Invalid admin credentials prevent login and redirect
# REQ: 9c137d2a-c248-4960-91ab-5db80118dd94
def test_invalid_credentials_prevent_login(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/login",
        data={"username": credentials.username, "password": "WrongPassword123!"},
    )
    assert response.status_code == 401
    assert response.json()["status"] == "error"


# TC: TC-009 Non-existent admin email prevents login
# REQ: 9c137d2a-c248-4960-91ab-5db80118dd94
def test_nonexistent_email_prevents_login(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/login",
        data={"username": "nonexistent@example.com", "password": credentials.password},
    )
    assert response.status_code == 401
    assert response.json()["status"] == "error"
