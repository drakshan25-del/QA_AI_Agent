import pytest
from playwright.sync_api import Page

pytestmark = [pytest.mark.generated]
# TC: 9ee21d93-538f-4f76-a2d7-e7934677d5a9 valid transaction completes
# REQ: REQ-1

def test_valid_transaction_completion(page: Page, base_url: str, target_available) -> None:
    if not target_available:
        pytest.skip()

    # Navigate to the transaction page.
    page.goto(base_url + '/transaction')

    # Enter '28efb8ad-8486-4351-9944-8aebb6b3e00f' into the request ID field.
    page.fill('input[name="request_id"]', '28efb8ad-8486-4351-9944-8aebb6b3e00f')

    # Click the execute button.
    page.click('button[type="submit"]')

    # The page shows the result of the transaction.
    expect(page).to_contain_text('Transaction Result')

# TC: 2a761b5a-772d-4026-ab74-ea3088808a22 request rejected due to validation errors
# REQ: REQ-2

def test_request_rejected_validation_errors(page: Page, base_url: str, target_available) -> None:
    if not target_available:
        pytest.skip()

    # Navigate to the transaction page.
    page.goto(base_url + '/transaction')

    # Enter 'invalid_request_id' into the request ID field.
    page.fill('input[name="request_id"', 'invalid_request_id')

    # Click the execute button.
    page.click('button[type="submit"]')

    # The page shows a rejection message.
    expect(page).to_contain_text('Validation Error')

    # The form is not submitted.
    expect(page).not_to_have_url(base_url + '/transaction/execute')