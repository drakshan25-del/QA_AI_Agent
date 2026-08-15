import uuid

import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api, pytest.mark.regression]
# TC: TC-503 Deleting an item removes it from the list
# REQ: REQ-API-2
def test_api_delete_item(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert response.status_code == 200
    token = response.json()["token"]

    item_text = f"reg-api-delete-{uuid.uuid4().hex[:8]}"
    create_response = api_client.post(
        "/api/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": item_text}
    )
    assert create_response.status_code == 201
    item_id = create_response.json()["item"]["id"]

    delete_response = api_client.delete(
        f"/api/items/{item_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert delete_response.status_code == 204

    get_response = api_client.get(
        "/api/items",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert get_response.status_code == 200
    items = get_response.json()["items"]
    assert not any(item["text"] == item_text for item in items)

# TC: TC-504 Deleting an out-of-range id returns 404
# REQ: REQ-API-2
def test_api_delete_out_of_range_id(api_client, credentials, target_available) -> None:
    response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert response.status_code == 200
    token = response.json()["token"]

    delete_response = api_client.delete(
        "/api/items/999999",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert delete_response.status_code == 404
    assert delete_response.json()["error"] == "not_found"