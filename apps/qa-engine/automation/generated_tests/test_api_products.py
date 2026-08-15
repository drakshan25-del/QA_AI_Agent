import pytest

pytestmark = [pytest.mark.generated, pytest.mark.api]


# TC: TC-001 Create product with all valid required fields and no image
# REQ: REQ-PRODUCTS
def test_api_create_product_valid_no_image(api_client, credentials, target_available) -> None:
    login_response = api_client.post(
        "/api/login",
        json={"username": credentials.username, "password": credentials.password},
    )
    assert login_response.status_code == 200

    payload = {
        "name": "Widget A",
        "category": "Tools",
        "price": "19.99",
        "stock": 10,
    }
    response = api_client.post("/api/products", json=payload)
    assert response.status_code in (200, 201)
    body = response.json()

    if "message" in body:
        assert body["message"] == "Product created successfully"

    product = body.get("product", body)
    assert product["name"] == "Widget A"
    assert product["category"] == "Tools"
    assert str(product["price"]) == "19.99"
    assert int(product["stock"]) == 10

    image = product.get("image")
    assert image is not None
    assert image != ""
