# TC: TC-001 Create User Account with Valid Data
# REQ: REQ-1,REQ-2

def test_create_user_account_valid_data(page: Page, base_url: str, credentials, target_available) -> None:
    user_mgmt = UserManagementPage(page, base_url)
    user_mgmt.goto()
    user_mgmt.create_user(
        employee_name='John Doe',
        role='ESS',
        status='Enabled',
        username='johndoe123',
        password='P@ssw0rd!',
        confirm_password='P@ssw0rd!'
    )
    expect(user_mgmt.success_toast).to_be_visible()
    expect(user_mgmt.user_list_table).to_contain_row(
        employee_name='John Doe',
        role='ESS',
        status='Enabled',
        username='johndoe123'
    )