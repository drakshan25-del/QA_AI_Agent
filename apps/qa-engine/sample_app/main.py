"""Demo target application with seedable defects.

A self-contained FastAPI app (no database; all state is in memory and
resets on restart) that the QA agent pipeline exercises end-to-end. It is
the controlled demo environment described in SRS §16, and its seeded
defects provide the ground truth for the "defect detection rate: known
seeded defects" metric in SRS §15.2.

Run:
    .venv/bin/python -m uvicorn sample_app.main:app --port 8001

Credentials come from the environment (never hard-coded secrets — the
defaults below are documented demo placeholders, see FR-PROJ-004):
    QA_TEST_USERNAME      demo login        (default: demo@example.com)
    QA_TEST_PASSWORD                        (default: change-me)
    SAMPLE_ADMIN_EMAIL    seeded admin      (defaults to QA_TEST_USERNAME)
    SAMPLE_ADMIN_PASSWORD                   (defaults to QA_TEST_PASSWORD)
By default the demo login IS the seeded admin, so it lands on /dashboard;
set SAMPLE_ADMIN_* to a different pair to keep a separate non-admin user.

Seeded defects are toggled via the SAMPLE_APP_DEFECTS env var, a
comma-separated list read fresh on every request so tests can flip flags
without restarting the server:
    login_message  -- failed login shows 'Server error' instead of
                      'Invalid credentials'.
    duplicate_add  -- adding an item inserts it twice.
    delete_noop    -- the Delete button does nothing.

Selector contract (relied on by generated page objects — do not change):
    [data-testid=username], [data-testid=password], button 'Log in',
    [data-testid=flash], [data-testid=item], button 'Delete',
    [data-testid=new-item], button 'Add'.

Login redirect contract: an *admin* account (the seeded one, or any created
on /admin) lands on /dashboard; a non-admin env user lands on /items. Both
see the same 'Welcome' [data-testid=flash].

JSON API contract (relied on by generated API tests — additive to the HTML
routes above, sharing the same in-memory state and seeded defects):
    GET    /api/health          -> 200 {"status": "ok"}
    POST   /api/login           -> 200 {"status": "ok", "token", "role"} |
                                   401 {"error": "invalid_credentials"} |
                                   500 {"error": "server_error"} (defect 'login_message')
    GET    /api/items           -> 200 {"items": [{"id", "text"}]} | 401
    POST   /api/items           -> 201 {"item": {...}} | 401 | 422 (blank text);
                                   defect 'duplicate_add' inserts twice
    DELETE /api/items/{item_id} -> 204 | 401 | 404; defect 'delete_noop'
                                   returns 204 without deleting
    Auth: 'Authorization: Bearer <token>' from /api/login, or the session cookie.

Admin features (Features 1-3) live in their own routers — dashboard_routes,
admin_routes, product_routes — all admin-only. Feature 4 slots in the same
way: add a router module and include it below.
"""

import html
import secrets

from fastapi import FastAPI, Form, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from sample_app import admin_routes, dashboard_routes, product_routes, store, ui
from sample_app.store import (  # re-exported for tests and backwards compatibility
    FLASHES,
    ITEMS,
    SESSION_COOKIE,
    SESSIONS,
    current_session,
    defects,
    expected_credentials,
)

app = FastAPI(title="QA Demo Target App", redoc_url=None)

LOGIN_BODY = """{flash}
  <form method="post" action="/login">
    <p><label>Username <input data-testid="username" name="username" type="text" autocomplete="username"></label></p>
    <p><label>Password <input data-testid="password" name="password" type="password" autocomplete="current-password"></label></p>
    <p><button type="submit">Log in</button></p>
  </form>"""

ITEMS_BODY = """{flash}
  <ul>
{items}
  </ul>
  <form method="post" action="/items/add">
    <input data-testid="new-item" name="text" type="text" placeholder="New item">
    <button type="submit">Add</button>
  </form>"""

ITEM_ROW = """    <li data-testid="item">{text}
      <form class="inline" method="post" action="/items/{idx}/delete">
        <button type="submit">Delete</button>
      </form>
    </li>"""


def render_login(flash: str | None = None, kind: str = "error") -> HTMLResponse:
    """Render the login page, optionally with a flash message."""
    body = LOGIN_BODY.format(flash=ui.render_flash(flash, kind if flash else "info"))
    return ui.page("Log in", body)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by the execution agent before test runs."""
    return {"status": "ok"}


@app.get("/login", response_class=HTMLResponse)
def login_page() -> HTMLResponse:
    """Serve the login form."""
    return render_login()


def _is_browser_navigation(request: Request) -> bool:
    """True for a real browser form submit (which keeps the redirect flow).

    Browsers mark top-level form posts with ``Sec-Fetch-Mode: navigate``;
    API clients (curl, httpx, Swagger UI's fetch) either omit ``Sec-Fetch-*``
    entirely or send ``cors``. Engines that predate ``Sec-Fetch-*`` are
    recognised by their Mozilla user agent.
    """
    mode = request.headers.get("sec-fetch-mode")
    if mode is not None:
        return mode == "navigate"
    return request.headers.get("user-agent", "").startswith("Mozilla/")


def _login_success_envelope(token: str, *, user_id: str, email: str, name: str, role: str) -> dict:
    """Rich JSON login envelope for API clients (documented login contract)."""
    first, _, last = (name or email.split("@", 1)[0]).partition(" ")
    return {
        "status": "success",
        "message": "Login successful",
        "data": {
            "user": {
                "id": user_id,
                "email": email,
                "firstName": first,
                "lastName": last,
                "role": role,
            },
            "authentication": {
                "tokenType": "Bearer",
                "accessToken": token,
                "expiresInSeconds": 3600,
                "refreshToken": "rfr_" + secrets.token_urlsafe(18),
            },
        },
    }


@app.post("/login", response_class=HTMLResponse, response_model=None)
def login_submit(
    request: Request, username: str = Form(""), password: str = Form("")
) -> HTMLResponse | RedirectResponse | JSONResponse:
    """Handle a login attempt from the browser form or an API client.

    Browser navigations keep the original flow: an active admin is redirected
    to /dashboard (Feature 1), the regular env user to /items, both with a
    'Welcome' flash; failure re-renders the form. Non-navigation clients
    (curl, Swagger UI, httpx) get JSON instead of a redirect: 200 with
    ``{status, message, data: {user, authentication}}`` on success, 401 with
    ``{status: "error", message}`` on bad credentials. The issued access
    token is the same session token the cookie flow uses, so ``Bearer``
    calls against /api/* work immediately.

    Seeded defect 'login_message' (SRS §15.2): the failure message reads
    'Server error' instead of 'Invalid credentials' on both surfaces (the
    JSON twin also degrades 401 → 500, mirroring /api/login).
    """
    browser = _is_browser_navigation(request)
    admin = store.verify_admin_login(username, password)
    if admin is not None:
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = admin["email"]
        if browser:
            store.set_flash(token, "Welcome", "success")
            response: RedirectResponse | JSONResponse = RedirectResponse(
                url="/dashboard", status_code=303
            )
        else:
            response = JSONResponse(
                _login_success_envelope(
                    token,
                    user_id=f"usr_{admin['id']}",
                    email=admin["email"],
                    name=str(admin.get("name", "")),
                    role=str(admin.get("role", "admin")),
                )
            )
        response.set_cookie(SESSION_COOKIE, token, httponly=True)
        return response

    valid_user, valid_pass = expected_credentials()
    if username == valid_user and password == valid_pass:
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = username
        if browser:
            store.set_flash(token, "Welcome", "success")
            response = RedirectResponse(url="/items", status_code=303)
        else:
            response = JSONResponse(
                _login_success_envelope(
                    token, user_id="usr_env", email=username, name="", role="user"
                )
            )
        response.set_cookie(SESSION_COOKIE, token, httponly=True)
        return response

    message = "Server error" if "login_message" in defects() else "Invalid credentials"
    if browser:
        return render_login(flash=message)
    return JSONResponse(
        {"status": "error", "message": message},
        status_code=500 if "login_message" in defects() else 401,
    )


@app.post("/logout")
def logout(request: Request) -> RedirectResponse:
    """End the session (both surfaces share the token store)."""
    token = current_session(request)
    if token is not None:
        SESSIONS.pop(token, None)
        FLASHES.pop(token, None)
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.get("/items", response_class=HTMLResponse, response_model=None)
def items_page(request: Request) -> HTMLResponse | RedirectResponse:
    """Render the item list; unauthenticated visitors are sent to /login."""
    token = current_session(request)
    if token is None:
        return RedirectResponse(url="/login", status_code=303)

    message, kind = store.pop_flash(token)
    rows = "\n".join(
        ITEM_ROW.format(text=html.escape(text), idx=idx) for idx, text in enumerate(ITEMS)
    )
    body = ITEMS_BODY.format(flash=ui.render_flash(message, kind), items=rows)
    audience = "admin" if store.session_admin(request) else "user"
    return ui.page("Items", body, nav=(audience, SESSIONS.get(token, "")))


@app.post("/items/add")
def add_item(request: Request, text: str = Form("")) -> RedirectResponse:
    """Add an item and redirect back to the list.

    Seeded defect 'duplicate_add' (SRS §15.2): the item is inserted twice.
    """
    if current_session(request) is None:
        return RedirectResponse(url="/login", status_code=303)

    text = text.strip()
    if text:
        ITEMS.append(text)
        if "duplicate_add" in defects():
            ITEMS.append(text)
    return RedirectResponse(url="/items", status_code=303)


@app.post("/items/{idx}/delete")
def delete_item(request: Request, idx: int) -> RedirectResponse:
    """Delete the item at the given index and redirect back to the list.

    Seeded defect 'delete_noop' (SRS §15.2): the delete silently does
    nothing.
    """
    if current_session(request) is None:
        return RedirectResponse(url="/login", status_code=303)

    if "delete_noop" not in defects() and 0 <= idx < len(ITEMS):
        ITEMS.pop(idx)
    return RedirectResponse(url="/items", status_code=303)


# ---------------------------------------------------------------------------
# JSON API (additive; exercised by generated API tests — see module docstring)
# ---------------------------------------------------------------------------


class LoginPayload(BaseModel):
    username: str = ""
    password: str = ""


class ItemPayload(BaseModel):
    text: str = ""


def _api_session(request: Request) -> str | None:
    """Resolve the caller's session from a Bearer token or the cookie."""
    return store.api_session(request)


@app.get("/api/health")
def api_health() -> dict[str, str]:
    """JSON liveness probe (mirror of /health under the API namespace)."""
    return {"status": "ok"}


@app.post("/api/login")
def api_login(payload: LoginPayload) -> JSONResponse:
    """JSON login: 200 + success message, token and role; 401 on bad credentials.

    The 200 body carries a human-readable ``message`` ("Welcome" — the same
    text the HTML flash shows) alongside the machine keys. Admin accounts get
    role 'admin'; the regular env user gets role 'user' (additive keys — the
    original status/token contract is unchanged).

    Seeded defect 'login_message' (SRS §15.2): failures surface as a
    misleading 500 'server_error' instead of 401 'invalid_credentials' —
    the API-visible twin of the HTML flash defect.
    """
    admin = store.verify_admin_login(payload.username, payload.password)
    if admin is not None:
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = admin["email"]
        response = JSONResponse(
            {"status": "ok", "message": "Welcome", "token": token, "role": "admin"}
        )
        response.set_cookie(SESSION_COOKIE, token, httponly=True)
        return response

    valid_user, valid_pass = expected_credentials()
    if payload.username == valid_user and payload.password == valid_pass:
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = payload.username
        response = JSONResponse(
            {"status": "ok", "message": "Welcome", "token": token, "role": "user"}
        )
        response.set_cookie(SESSION_COOKIE, token, httponly=True)
        return response
    if "login_message" in defects():
        return JSONResponse({"error": "server_error"}, status_code=500)
    return JSONResponse({"error": "invalid_credentials"}, status_code=401)


@app.get("/api/items")
def api_list_items(request: Request) -> JSONResponse:
    """List items as JSON; 401 without a valid session."""
    if _api_session(request) is None:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    items = [{"id": idx, "text": text} for idx, text in enumerate(ITEMS)]
    return JSONResponse({"items": items})


@app.post("/api/items")
def api_add_item(request: Request, payload: ItemPayload) -> JSONResponse:
    """Add an item: 201 + the created item, 422 on blank text, 401 unauthenticated.

    Seeded defect 'duplicate_add' (SRS §15.2): the item is inserted twice —
    observable here as a duplicate in the next GET /api/items.
    """
    if _api_session(request) is None:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    text = payload.text.strip()
    if not text:
        return JSONResponse({"error": "text_required"}, status_code=422)
    ITEMS.append(text)
    if "duplicate_add" in defects():
        ITEMS.append(text)
    return JSONResponse({"item": {"id": len(ITEMS) - 1, "text": text}}, status_code=201)


@app.delete("/api/items/{item_id}", response_model=None)
def api_delete_item(request: Request, item_id: int) -> JSONResponse | Response:
    """Delete an item by id: 204 on success, 404 out of range, 401 unauthenticated.

    Seeded defect 'delete_noop' (SRS §15.2): responds 204 but leaves the
    item in place.
    """
    if _api_session(request) is None:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if not 0 <= item_id < len(ITEMS):
        return JSONResponse({"error": "not_found"}, status_code=404)
    if "delete_noop" not in defects():
        ITEMS.pop(item_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Feature routers (admin-only). Feature 4: add its router module here.
# ---------------------------------------------------------------------------

app.include_router(dashboard_routes.router)
app.include_router(admin_routes.router)
app.include_router(product_routes.router)
