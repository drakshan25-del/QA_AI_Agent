import uuid

import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api, pytest.mark.regression]
# TC: TC-502 Creating an item inserts it exactly once
# REQ: REQ-API-2
def test_api_create_item_inserts_once(api_client, credentials, target_available) -> None:
    # Log in via POST /api/login to obtain a bearer token
    login_response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert login_response.status_code == 200
    token = login_response.json()["token"]

    # POST /api/items with the unique text from test_data
    item_text = f"reg-api-once-{uuid.uuid4().hex[:8]}"
    response = api_client.post(
        "/api/items",
        json={"text": item_text},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 201
    created_item = response.json()["item"]
    assert created_item["text"] == item_text

    # GET /api/items and count entries with that text
    items_response = api_client.get(
        "/api/items",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert items_response.status_code == 200
    items = items_response.json()["items"]
    count = sum(1 for item in items if item["text"] == item_text)
    assert count == 1