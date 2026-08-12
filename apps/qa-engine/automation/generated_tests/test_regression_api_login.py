import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api, pytest.mark.regression]
# TC: TC-501 Login API rejects a wrong password with a 401 error
# REQ: REQ-API-1
def test_api_login_wrong_password(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": "wrong-" + credentials.password},
    )
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_credentials"