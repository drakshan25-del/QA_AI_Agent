import pytest
from playwright.sync_api import Page, expect

from automation.pages.admin_login_page import AdminLoginPage
from automation.pages.dashboard_page import DashboardPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-005 Dashboard navigation displays Dashboard, Users, Products, and Items links
# REQ: 
def test_dashboard_navigation_links(page: Page, base_url: str, credentials, target_available) -> None:
    login = AdminLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    
    dashboard = DashboardPage(page, base_url)
    dashboard.assert_navigation_link_visible("Dashboard")
    dashboard.assert_navigation_link_visible("Users")
    dashboard.assert_navigation_link_visible("Products")
    dashboard.assert_navigation_link_visible("Items")
