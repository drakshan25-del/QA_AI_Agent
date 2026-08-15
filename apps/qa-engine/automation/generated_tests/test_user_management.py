import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_items_page import SampleItemsPage

pytestmark = [pytest.mark.generated]
# TC: 4194b0b1-5112-453d-b8c1-99d4866cc84b Admin creates an invalid employee name
# REQ: REQ-3,REQ-4
def test_admin_creates_an_invalid_employee_name(page: Page, base_url: str, credentials, target_available) -> None:
    admin_page = SampleItemsPage(page, base_url)
    admin_page.goto()
    admin_page.click(admin_page.admin_link)
    user_management_page = SampleItemsPage(page, base_url)
    user_management_page.click(user_management_page.user_management_link)
    users_page = SampleItemsPage(page, base_url)
    users_page.click(users_page.users_link)
    users_page.click(users_page.add_button)
    expect(users_page.employee_name_input).to_have_value('')
    users_page.fill(users_page.employee_name_input, 'NonExistentEmployee')
    expect(users_page.employee_name_error).to_contain_text('Invalid')

# TC: 31c49f83-a454-4350-9f8f-138430fe41fe Admin creates a new user with all fields valid
# REQ: REQ-3,REQ-4
def test_admin_creates_a_new_user_with_all_fields_valid(page: Page, base_url: str, credentials, target_available) -> None:
    admin_page = SampleItemsPage(page, base_url)
    admin_page.goto()
    admin_page.click(admin_page.admin_link)
    user_management_page = SampleItemsPage(page, base_url)
    user_management_page.click(user_management_page.user_management_link)
    users_page = SampleItemsPage(page, base_url)
    users_page.click(users_page.users_link)
    users_page.click(users_page.add_button)
    expect(users_page.employee_name_input).to_have_value('')
    users_page.fill(users_page.employee_name_input, 'John Doe')
    expect(users_page.username_input).to_have_value('')
    users_page.fill(users_page.username_input, 'newuser123')
    expect(users_page.password_input).to_have_value('')
    users_page.fill(users_page.password_input, 'P@ssw0rd!')
    expect(users_page.confirm_password_input).to_have_value('')
    users_page.fill(users_page.confirm_password_input, 'P@ssw0rd!')
    users_page.click(users_page.save_button)
    expect(page).to_have_url(base_url + '/web/index.php/dashboard')