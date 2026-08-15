"""Unit tests for page-object API discovery and the invented-member gate
(AIQA-EXEC-003).

The live failure this prevents: generated tests imported the hand-written
``LoginPage`` (built for a different demo site) and called ``login.login(...)``
— a member it does not have — so every UI test died with an AttributeError at
runtime while validation (collection-only) stayed green.
"""

from __future__ import annotations

import pytest

from agents.automation_agent import (
    _discover_page_objects_summary,
    _ensure_known_page_object_api,
    _page_object_api,
)
from app.models.schemas import GeneratedFile

pytestmark = pytest.mark.unit


PAGE_SOURCE = '''
from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class SampleLoginPage(BasePage):
    """Login page of the sample application under test."""

    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_input: Locator = self.by_test_id("username")
        self.password_input: Locator = self.by_test_id("password")

    def login(self, username: str, password: str) -> None:
        self.fill(self.username_input, username, "Username")
        self.fill(self.password_input, password, "Password")
'''


def _test_file(body: str, import_line: str) -> GeneratedFile:
    return GeneratedFile(
        path="automation/generated_tests/test_login.py",
        kind="test_file",
        content=(
            "import pytest\n"
            f"{import_line}\n\n"
            "pytestmark = [pytest.mark.generated]\n\n\n"
            "def test_login(page, base_url, credentials, target_available):\n"
            f"{body}"
        ),
    )


class TestPageObjectApi:
    def test_extracts_doc_path_locators_and_methods(self):
        api = _page_object_api(PAGE_SOURCE)
        info = api["SampleLoginPage"]
        assert info["doc"] == "Login page of the sample application under test."
        assert info["path"] == "/login"
        assert {"username_input", "password_input"} <= info["attrs"]
        assert info["methods"]["login"] == ["username", "password"]

    def test_discovery_summary_lists_real_page_api(self):
        summary = _discover_page_objects_summary()
        assert "automation.pages.sample_login_page (SampleLoginPage)" in summary
        assert "login(username, password)" in summary
        # The discriminating docstring the model needs for page selection.
        assert "sample application" in summary


class TestEnsureKnownPageObjectApi:
    IMPORT = "from automation.pages.sample_login_page import SampleLoginPage"

    def test_existing_members_pass(self):
        f = _test_file(
            "    login = SampleLoginPage(page, base_url)\n"
            "    login.goto()\n"
            "    login.login(credentials.username, credentials.password)\n",
            self.IMPORT,
        )
        _ensure_known_page_object_api([f])  # must not raise

    def test_invented_member_rejected_with_real_api_listed(self):
        f = _test_file(
            "    login = SampleLoginPage(page, base_url)\n"
            "    login.sign_in(credentials.username, credentials.password)\n",
            self.IMPORT,
        )
        with pytest.raises(ValueError, match="no attribute 'sign_in'") as exc:
            _ensure_known_page_object_api([f])
        assert "login" in str(exc.value)  # the available API is suggested

    def test_batch_emitted_page_object_is_used_for_the_check(self):
        page = GeneratedFile(
            path="automation/pages/checkout_page.py",
            kind="page_object",
            content=(
                "from automation.pages.base_page import BasePage\n\n\n"
                "class CheckoutPage(BasePage):\n"
                "    path = '/checkout'\n\n"
                "    def pay(self):\n"
                "        pass\n"
            ),
        )
        good = _test_file(
            "    checkout = CheckoutPage(page, base_url)\n    checkout.pay()\n",
            "from automation.pages.checkout_page import CheckoutPage",
        )
        _ensure_known_page_object_api([page, good])
        bad = _test_file(
            "    checkout = CheckoutPage(page, base_url)\n    checkout.refund()\n",
            "from automation.pages.checkout_page import CheckoutPage",
        )
        with pytest.raises(ValueError, match="no attribute 'refund'"):
            _ensure_known_page_object_api([page, bad])

    def test_base_page_members_always_allowed(self):
        f = _test_file(
            "    login = SampleLoginPage(page, base_url)\n"
            "    login.navigate('/login')\n"
            "    login.assert_url_contains('/login')\n",
            self.IMPORT,
        )
        _ensure_known_page_object_api([f])  # goto/navigate/assert_* from BasePage


class _StubPage:
    """Records Playwright getter calls so locator forwarding is testable."""

    def __init__(self):
        self.calls = []

    def _record(self, method, *args, **kwargs):
        self.calls.append((method, args, kwargs))
        return f"locator:{method}"

    def get_by_role(self, role, **kwargs):
        return self._record("get_by_role", role, **kwargs)

    def get_by_label(self, text, **kwargs):
        return self._record("get_by_label", text, **kwargs)

    def get_by_text(self, text, **kwargs):
        return self._record("get_by_text", text, **kwargs)


class TestBasePageLocatorForwarding:
    """BasePage helpers must accept the FULL Playwright getter signatures —
    a narrower wrapper turned valid generated code like
    ``self.by_role("button", name="Log in", exact=True)`` into a run-wide
    ``TypeError: unexpected keyword argument 'exact'``."""

    def _base(self):
        from automation.pages.base_page import BasePage

        return BasePage(_StubPage(), "http://target")

    def test_by_role_forwards_playwright_options(self):
        base = self._base()
        base.by_role("button", name="Log in", exact=True)
        base.get_by_role("heading", level=2)
        assert base.page.calls == [
            ("get_by_role", ("button",), {"name": "Log in", "exact": True}),
            ("get_by_role", ("heading",), {"level": 2}),
        ]

    def test_by_label_and_text_forward_exact(self):
        base = self._base()
        base.get_by_label("Password", exact=True)
        base.by_text("Welcome", exact=True)
        assert base.page.calls == [
            ("get_by_label", ("Password",), {"exact": True}),
            ("get_by_text", ("Welcome",), {"exact": True}),
        ]
