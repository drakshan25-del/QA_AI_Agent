"""Unit tests for page snapshot grounding and the locator liveness gate.

The incident these pin down (AIQA-EXEC-004): generation invented locators
from test-case wording — `get_by_label("email")` on a form labelled
"Username", `by_role("button", name="submit")` for a button whose visible
text is "Log in", `by_role("alert")` for a flash div with only a test id —
and every guess burned a 30-second Playwright timeout per test at runtime.
"""

from __future__ import annotations

import pytest

from agents import automation_agent, page_inspector
from app.models.schemas import GeneratedFile

pytestmark = pytest.mark.unit


#: Mirror of the sample-app's login markup (sample_app/main.py LOGIN_BODY).
LOGIN_HTML = """
<html><body>
<main>
<h1>Log in</h1>
<div data-testid="flash" class="flash-error">Invalid credentials</div>
<form method="post" action="/login">
  <p><label>Username <input data-testid="username" name="username" type="text"></label></p>
  <p><label>Password <input data-testid="password" name="password" type="password"></label></p>
  <p><button type="submit">Log in</button></p>
</form>
<a href="/">Home</a>
</main>
</body></html>
"""


class TestDistill:
    def test_login_page_inventory(self):
        inv = page_inspector.distill(LOGIN_HTML)
        assert [i["label"] for i in inv.inputs] == ["Username", "Password"]
        assert [i["testid"] for i in inv.inputs] == ["username", "password"]
        assert inv.buttons == ["Log in"]
        assert "flash" in inv.testids
        assert "Log in" in inv.headings
        assert inv.roles == []  # the flash div declares no ARIA role

    def test_label_for_association(self):
        inv = page_inspector.distill(
            '<label for="em">Email address</label><input id="em" type="text">'
        )
        assert inv.inputs[0]["label"] == "Email address"

    def test_malformed_html_never_raises(self):
        inv = page_inspector.distill("<div><button>Ok<//div>&&&")
        assert isinstance(inv, page_inspector.PageInventory)

    def test_render_mentions_real_hooks(self):
        text = "\n".join(page_inspector.distill(LOGIN_HTML).render())
        assert 'label="Username"' in text
        assert 'button "Log in"' in text
        assert "testid=flash" in text

    def test_redirected_page_renders_note_and_gate_skips_it(self):
        inv = page_inspector.PageInventory(redirected_to="/login")
        assert "redirects to /login" in "\n".join(inv.render())
        automation_agent._ensure_locators_exist(
            [_page_object(BROKEN_PAGE_OBJECT)], {"/login": inv}
        )


class TestCandidatePaths:
    def test_combines_page_objects_test_cases_and_root(self):
        cases = [{"steps": ["Navigate to /login", "then open /dashboard"]}]
        paths = page_inspector.candidate_paths(cases, ["/items"])
        assert paths[0] == "/items"
        assert "/login" in paths and "/dashboard" in paths and "/" in paths

    def test_caps_and_skips_assets(self):
        cases = [{"steps": [f"/page{i}" for i in range(20)] + ["/app.js"]}]
        paths = page_inspector.candidate_paths(cases, [])
        assert len(paths) <= page_inspector.MAX_PAGES
        assert "/app.js" not in paths


class TestCollectSameOrigin:
    def test_unreachable_target_is_fail_open(self):
        snapshot = page_inspector.collect_page_structures(
            "http://127.0.0.1:59999", ["/login"]
        )
        assert snapshot.structures == {}
        assert snapshot.statuses.get("/login") == "error"
        assert (
            page_inspector.render_structures(snapshot)
            == page_inspector.STRUCTURE_UNAVAILABLE
        )


def _page_object(content: str) -> GeneratedFile:
    return GeneratedFile(
        path="automation/pages/admin_login_page.py", kind="page_object", content=content
    )


BROKEN_PAGE_OBJECT = '''
from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class AdminLoginPage(BasePage):
    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.email_input: Locator = self.get_by_label("email", exact=False)
        self.password_input: Locator = self.get_by_label("password", exact=False)
        self.submit_button: Locator = self.by_role("button", name="submit", exact=False)
        self.error_message: Locator = self.by_role("alert", exact=False)
'''

FIXED_PAGE_OBJECT = '''
from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class AdminLoginPage(BasePage):
    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_input: Locator = self.by_test_id("username")
        self.password_input: Locator = self.get_by_label("Password")
        self.submit_button: Locator = self.by_role("button", name="Log in")
        self.error_message: Locator = self.by_test_id("flash")
'''


class TestLocatorGate:
    def _structures(self):
        return {"/login": page_inspector.distill(LOGIN_HTML)}

    def test_incident_locators_are_rejected_with_real_inventory(self):
        with pytest.raises(ValueError) as exc:
            automation_agent._ensure_locators_exist(
                [_page_object(BROKEN_PAGE_OBJECT)], self._structures()
            )
        message = str(exc.value)
        assert 'get_by_label("email")' in message
        assert 'by_role("button", name="submit")' in message
        assert 'by_role("alert")' in message
        # The retry message must teach the fix: the page's actual hooks.
        assert "Username" in message and "Log in" in message and "flash" in message

    def test_correct_locators_pass(self):
        automation_agent._ensure_locators_exist(
            [_page_object(FIXED_PAGE_OBJECT)], self._structures()
        )

    def test_fail_open_without_structures(self):
        automation_agent._ensure_locators_exist([_page_object(BROKEN_PAGE_OBJECT)], {})

    def test_fail_open_for_unsnapshotted_path(self):
        automation_agent._ensure_locators_exist(
            [_page_object(BROKEN_PAGE_OBJECT.replace('"/login"', '"/other"'))],
            self._structures(),
        )

    def test_non_literal_arguments_are_skipped(self):
        dynamic = FIXED_PAGE_OBJECT.replace(
            'self.by_test_id("username")', "self.by_test_id(field_name)"
        )
        automation_agent._ensure_locators_exist(
            [_page_object(dynamic)], self._structures()
        )

    def test_test_files_are_not_checked(self):
        test_file = GeneratedFile(
            path="automation/generated_tests/test_x.py",
            kind="test_file",
            content='def test_x():\n    assert True\n',
        )
        automation_agent._ensure_locators_exist([test_file], self._structures())


ADMIN_HTML = """
<html><body>
<form method="post" action="/admin/users/add" data-testid="admin-form">
  <label>Full name <input data-testid="admin-name" name="name" type="text" required></label>
  <label>Email address <input data-testid="admin-email" name="email" type="email" required></label>
  <label>Password <input data-testid="admin-password" name="password" type="password" required></label>
  <button type="submit">Save admin</button>
</form>
</body></html>
"""


def _sample_app_transport():
    """MockTransport simulating login-gated pages with cookie sessions."""
    import httpx

    def handler(request: "httpx.Request") -> "httpx.Response":
        path = request.url.path.rstrip("/") or "/"
        authed = "session" in request.headers.get("cookie", "")
        if path == "/login" and request.method == "GET":
            return httpx.Response(200, html=LOGIN_HTML)
        if path == "/login" and request.method == "POST":
            body = request.content.decode()
            if "username=demo%40example.com" in body and "password=change-me" in body:
                return httpx.Response(
                    303,
                    headers={"location": "/dashboard", "set-cookie": "session=abc; Path=/"},
                )
            return httpx.Response(401, html="<p>Invalid credentials</p>")
        if path in ("/admin", "/dashboard"):
            if authed:
                return httpx.Response(200, html=ADMIN_HTML)
            return httpx.Response(303, headers={"location": "/login"})
        return httpx.Response(404, text="Not Found")

    return httpx.MockTransport(handler)


@pytest.fixture()
def mock_target(monkeypatch):
    """Route page_inspector's httpx traffic through the mock sample app."""
    import httpx

    transport = _sample_app_transport()
    real_client = httpx.Client

    def patched_client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "Client", patched_client)
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kw: real_client(transport=transport).get(
            url, follow_redirects=kw.get("follow_redirects", False)
        ),
    )
    return transport


class TestAuthAwareSnapshot:
    def test_statuses_ok_auth_missing(self, mock_target):
        snap = page_inspector.collect_page_structures(
            "http://target.test", ["/login", "/admin", "/users/create"]
        )
        assert snap.statuses["/login"] == "ok"
        assert snap.statuses["/admin"] == "auth"
        assert snap.statuses["/users/create"] == "missing"

    def test_auth_gated_page_is_refetched_with_login(self, mock_target):
        snap = page_inspector.collect_page_structures(
            "http://target.test", ["/login", "/admin"]
        )
        admin = snap.structures["/admin"]
        assert admin.requires_login
        assert "admin-name" in admin.testids
        assert admin.buttons == ["Save admin"]
        rendered = page_inspector.render_structures(snap)
        assert "## Page /admin (REQUIRES LOGIN" in rendered

    def test_failed_login_keeps_redirect_note(self, mock_target, monkeypatch):
        monkeypatch.setenv("QA_TEST_PASSWORD", "wrong-password")
        snap = page_inspector.collect_page_structures(
            "http://target.test", ["/login", "/admin"]
        )
        admin = snap.structures["/admin"]
        assert not admin.requires_login
        assert admin.redirected_to == "/login"

    def test_probe_path_classifies(self, mock_target):
        assert page_inspector.probe_path("http://target.test", "/users/create") == "missing"
        assert page_inspector.probe_path("http://127.0.0.1:59999", "/x") in ("error", "missing")


class TestPagePathGate:
    def _snapshot(self):
        snap = page_inspector.PageSnapshot(base_url="http://target.test")
        snap.statuses = {"/login": "ok", "/admin": "auth", "/users/create": "missing"}
        snap.structures = {
            "/login": page_inspector.distill(LOGIN_HTML),
            "/admin": page_inspector.PageInventory(requires_login=True),
        }
        return snap

    def test_missing_path_is_rejected_naming_real_pages(self):
        bad = GeneratedFile(
            path="automation/pages/user_creation_page.py",
            kind="page_object",
            content=(
                "from automation.pages.base_page import BasePage\n\n"
                "class UserCreationPage(BasePage):\n"
                '    path = "/users/create"\n'
            ),
        )
        with pytest.raises(ValueError) as exc:
            automation_agent._ensure_page_paths_exist([bad], self._snapshot())
        message = str(exc.value)
        assert '"/users/create" does not exist' in message
        assert "/admin (requires login)" in message

    def test_existing_paths_pass(self):
        good = GeneratedFile(
            path="automation/pages/admin_page.py",
            kind="page_object",
            content=(
                "from automation.pages.base_page import BasePage\n\n"
                "class AdminPage(BasePage):\n"
                '    path = "/admin"\n'
            ),
        )
        automation_agent._ensure_page_paths_exist([good], self._snapshot())

    def test_fail_open_without_snapshot(self):
        bad = GeneratedFile(
            path="automation/pages/x_page.py",
            kind="page_object",
            content='class XPage:\n    path = "/users/create"\n',
        )
        automation_agent._ensure_page_paths_exist([bad], None)
        automation_agent._ensure_page_paths_exist(
            [bad], page_inspector.PageSnapshot(base_url="")
        )

#: Mirror of the sample-app's product form: datalist Category, number Price,
#: role select with options — the AIQA-EXEC-007 incident surface.
PRODUCTS_HTML = """
<html><body>
<form method="post" action="/products/add" data-testid="product-form">
  <label>Product name <input data-testid="product-name" name="name" type="text" required></label>
  <label>Category
    <input data-testid="product-category" name="category" type="text" required list="category-suggestions">
  </label>
  <datalist id="category-suggestions">
    <option value="Electronics"></option><option value="Office"></option>
  </datalist>
  <label>Price <input data-testid="product-price" name="price" type="number" min="0" step="0.01" required></label>
  <label>Status
    <select data-testid="product-status" name="status">
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
    </select>
  </label>
  <label>Notes <textarea data-testid="product-notes" name="notes"></textarea></label>
  <button type="submit">Save product</button>
</form>
</body></html>
"""


class TestDistillKinds:
    def test_datalist_options_and_constraints(self):
        inv = page_inspector.distill(PRODUCTS_HTML)
        category = next(i for i in inv.inputs if i["testid"] == "product-category")
        assert category["datalist"] and category["required"]
        price = next(i for i in inv.inputs if i["testid"] == "product-price")
        assert price["min"] == "0" and price["type"] == "number"
        status = next(s for s in inv.selects if s.get("testid") == "product-status")
        assert status["tag"] == "select"
        assert status["options"] == ["active", "inactive"]
        notes = next(s for s in inv.selects if s.get("testid") == "product-notes")
        assert notes["tag"] == "textarea"

    def test_render_annotates_kinds(self):
        text = "\n".join(page_inspector.distill(PRODUCTS_HTML).render())
        assert "use fill(), NOT select()" in text
        assert "options: active, inactive" in text
        assert "min=0" in text and "required" in text

    def test_element_kind_lookup(self):
        inv = page_inspector.distill(PRODUCTS_HTML)
        assert inv.element_kind("testid", "product-category", {})["kind"] == "input"
        assert inv.element_kind("testid", "product-status", {})["kind"] == "select"
        assert inv.element_kind("testid", "product-notes", {})["kind"] == "textarea"
        assert inv.element_kind("role", "button", {"name": "Save product"})["kind"] == "button"
        assert inv.element_kind("testid", "ghost", {}) is None


def _products_page_object(body: str) -> GeneratedFile:
    content = (
        "from playwright.sync_api import Locator, Page\n\n"
        "from automation.pages.base_page import BasePage\n\n\n"
        "class ProductsPage(BasePage):\n"
        '    path = "/products"\n\n'
        "    def __init__(self, page, base_url):\n"
        "        super().__init__(page, base_url)\n"
        '        self.category_select = self.by_test_id("product-category")\n'
        '        self.status_select = self.by_test_id("product-status")\n'
        '        self.name_field = self.by_test_id("product-name")\n\n'
        + body
    )
    return GeneratedFile(
        path="automation/pages/products_page.py", kind="page_object", content=content
    )


class TestInteractionContractGate:
    def _structures(self):
        return {"/products": page_inspector.distill(PRODUCTS_HTML)}

    def test_select_on_datalist_input_rejected_with_teaching_message(self):
        po = _products_page_object(
            "    def create(self, category):\n"
            '        self.select(self.category_select, category, "Category")\n'
        )
        with pytest.raises(ValueError) as exc:
            automation_agent._ensure_locators_exist([po], self._structures())
        message = str(exc.value)
        assert "select() on self.category_select" in message
        assert "autocomplete suggestions" in message
        assert "use fill()" in message

    def test_fill_on_datalist_input_passes(self):
        po = _products_page_object(
            "    def create(self, category):\n"
            '        self.fill(self.category_select, category, "Category")\n'
        )
        automation_agent._ensure_locators_exist([po], self._structures())

    def test_fill_on_select_rejected(self):
        po = _products_page_object(
            "    def set_status(self):\n"
            '        self.fill(self.status_select, "active", "Status")\n'
        )
        with pytest.raises(ValueError, match="cannot be typed into"):
            automation_agent._ensure_locators_exist([po], self._structures())

    def test_check_on_text_input_rejected(self):
        po = _products_page_object(
            "    def toggle(self):\n"
            '        self.check(self.name_field, "Name")\n'
        )
        with pytest.raises(ValueError, match="checkboxes/radios"):
            automation_agent._ensure_locators_exist([po], self._structures())

    def test_select_value_outside_options_rejected(self):
        po = _products_page_object(
            "    def set_status(self):\n"
            '        self.select(self.status_select, "Editor", "Status")\n'
        )
        with pytest.raises(ValueError) as exc:
            automation_agent._ensure_locators_exist([po], self._structures())
        assert "options: active, inactive" in str(exc.value)

    def test_select_valid_option_passes(self):
        po = _products_page_object(
            "    def set_status(self):\n"
            '        self.select(self.status_select, "inactive", "Status")\n'
        )
        automation_agent._ensure_locators_exist([po], self._structures())

    def test_direct_locator_action_target_checked(self):
        po = _products_page_object(
            "    def create(self):\n"
            '        self.select(self.by_test_id("product-category"), "x", "Category")\n'
        )
        with pytest.raises(ValueError, match="use fill"):
            automation_agent._ensure_locators_exist([po], self._structures())

    def test_non_literal_target_fail_open(self):
        po = _products_page_object(
            "    def create(self, locator, value):\n"
            '        self.select(locator, value, "Category")\n'
        )
        automation_agent._ensure_locators_exist([po], self._structures())

    def test_unsnapshotted_page_fail_open(self):
        po = _products_page_object(
            "    def create(self, category):\n"
            '        self.select(self.category_select, category, "Category")\n'
        )
        automation_agent._ensure_locators_exist([po], {})


class TestPagePathGateLazy:
    def _snapshot(self):
        snap = page_inspector.PageSnapshot(base_url="http://target.test")
        snap.statuses = {"/login": "ok"}
        snap.structures = {"/login": page_inspector.distill(LOGIN_HTML)}
        return snap

    def test_unprobed_path_uses_lazy_probe(self, monkeypatch):
        monkeypatch.setattr(page_inspector, "probe_path", lambda base, p: "missing")
        bad = GeneratedFile(
            path="automation/pages/y_page.py",
            kind="page_object",
            content=(
                "from automation.pages.base_page import BasePage\n\n"
                "class YPage(BasePage):\n"
                '    path = "/ghost"\n'
            ),
        )
        with pytest.raises(ValueError, match="/ghost"):
            automation_agent._ensure_page_paths_exist([bad], self._snapshot())
