import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api]
# TC: TC-301 Login API returns a token for valid credentials
# REQ: REQ-API-1
def test_api_login_valid_credentials(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["token"], str) and body["token"]

# TC: TC-302 Login API rejects a wrong password with 401
# REQ: REQ-API-1
def test_api_login_wrong_password(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": "wrong-" + credentials.password},
    )
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_credentials"