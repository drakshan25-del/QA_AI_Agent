# TC: TC-001 Authenticate with valid credentials
# REQ: 2b1c90945e8446d59657544d77e2b3ab
def test_authenticate_with_valid_credentials(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    expect(login.flash).to_contain_text("Welcome")

# TC: TC-002 Reject invalid login attempts
# REQ: 2b1c90945e8446d59657544d77e2b3ab
def test_reject_invalid_login_attempts(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, "invalid_password")
    expect(login.flash).to_contain_text("Invalid username or password")

# TC: TC-003 Access the Metrics dashboard
# REQ: 2b1c90945e8446d59657544d77e2b3ab
def test_access_metrics_dashboard(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    expect(login.flash).to_contain_text("Welcome")
    # Assuming Metrics is a link or button with the text 'Metrics'
    page.get_by_role('link', name='Metrics').click()
    expect(page.url).to_contain("/metrics")
