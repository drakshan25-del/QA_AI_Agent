import uuid

import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api]
# TC: TC-303 Items API requires authentication
# REQ: REQ-API-2
def test_api_items_requires_auth(api_client, target_available) -> None:
    response = api_client.get(
        "/api/items",
    )
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"

# TC: TC-304 Created item is returned and listed
# REQ: REQ-API-2
def test_api_items_created_item(api_client, credentials, target_available) -> None:
    login_response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert login_response.status_code == 200
    token = login_response.json()["token"]

    item_text = f"api-item-create-{uuid.uuid4().hex[:8]}"
    create_response = api_client.post(
        "/api/items",
        json={"text": item_text},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert create_response.status_code == 201
    created_item = create_response.json()["item"]
    assert created_item["text"] == item_text

    list_response = api_client.get(
        "/api/items",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert any(item["text"] == item_text for item in items)

# TC: TC-305 Blank item text is rejected with 422
# REQ: REQ-API-2
def test_api_items_blank_text_rejected(api_client, credentials, target_available) -> None:
    login_response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert login_response.status_code == 200
    token = login_response.json()["token"]

    response = api_client.post(
        "/api/items",
        json={"text": ""},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 422
    assert response.json()["error"] == "text_required"