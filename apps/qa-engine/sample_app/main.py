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
    QA_TEST_USERNAME  (default: demo@example.com)
    QA_TEST_PASSWORD  (default: change-me)

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
"""

import html
import os
import secrets

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

app = FastAPI(title="QA Demo Target App", redoc_url=None)

SESSION_COOKIE = "session"

# In-memory state (reset on restart — SRS §16 controlled demo environment).
SESSIONS: dict[str, str] = {}  # session token -> username
FLASHES: dict[str, str] = {}  # session token -> pending flash message
ITEMS: list[str] = ["Write test plan", "Review requirements", "Fix flaky test"]


def defects() -> set[str]:
    """Return the currently active seeded-defect flags.

    Reads SAMPLE_APP_DEFECTS from the environment on every call so tests
    can toggle defects at runtime without restarting the app (SRS §15.2:
    defect detection rate against known seeded defects).

    Returns:
        Set of active defect flag names, e.g. {'login_message'}.
    """
    raw = os.environ.get("SAMPLE_APP_DEFECTS", "")
    return {flag.strip() for flag in raw.split(",") if flag.strip()}


def expected_credentials() -> tuple[str, str]:
    """Return the valid (username, password) pair from the environment.

    Credentials are referenced via env vars only, never stored in code or
    passed to LLM prompts (FR-PROJ-004, FR-CI-004). Read per request so a
    test harness can rotate them without a restart.
    """
    username = os.environ.get("QA_TEST_USERNAME", "demo@example.com")
    password = os.environ.get("QA_TEST_PASSWORD", "change-me")
    return username, password


def current_session(request: Request) -> str | None:
    """Return the session token from the request cookie if it is valid."""
    token = request.cookies.get(SESSION_COOKIE)
    if token and token in SESSIONS:
        return token
    return None


PAGE_SHELL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }}
    [data-testid=flash] {{ padding: .5rem .75rem; border: 1px solid #888; margin-bottom: 1rem; }}
    li {{ margin: .25rem 0; }}
    form.inline {{ display: inline; margin-left: .5rem; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  {body}
</body>
</html>"""

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


def render_flash(message: str | None) -> str:
    """Render the flash <div data-testid="flash"> block, or nothing."""
    if not message:
        return ""
    return f'<div data-testid="flash">{html.escape(message)}</div>'


def render_login(flash: str | None = None) -> HTMLResponse:
    """Render the login page, optionally with a flash message."""
    body = LOGIN_BODY.format(flash=render_flash(flash))
    return HTMLResponse(PAGE_SHELL.format(title="Log in", body=body))


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by the execution agent before test runs."""
    return {"status": "ok"}


@app.get("/login", response_class=HTMLResponse)
def login_page() -> HTMLResponse:
    """Serve the login form."""
    return render_login()


@app.post("/login", response_class=HTMLResponse, response_model=None)
def login_submit(username: str = Form(""), password: str = Form("")) -> HTMLResponse | RedirectResponse:
    """Handle a login attempt.

    Success sets a session cookie and redirects to /items with a
    'Welcome' flash. Failure re-renders the form with an error flash.

    Seeded defect 'login_message' (SRS §15.2): the failure flash reads
    'Server error' instead of 'Invalid credentials'.
    """
    valid_user, valid_pass = expected_credentials()
    if username == valid_user and password == valid_pass:
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = username
        FLASHES[token] = "Welcome"
        response = RedirectResponse(url="/items", status_code=303)
        response.set_cookie(SESSION_COOKIE, token, httponly=True)
        return response

    message = "Server error" if "login_message" in defects() else "Invalid credentials"
    return render_login(flash=message)


@app.get("/items", response_class=HTMLResponse, response_model=None)
def items_page(request: Request) -> HTMLResponse | RedirectResponse:
    """Render the item list; unauthenticated visitors are sent to /login."""
    token = current_session(request)
    if token is None:
        return RedirectResponse(url="/login", status_code=303)

    flash = FLASHES.pop(token, None)
    rows = "\n".join(
        ITEM_ROW.format(text=html.escape(text), idx=idx) for idx, text in enumerate(ITEMS)
    )
    body = ITEMS_BODY.format(flash=render_flash(flash), items=rows)
    return HTMLResponse(PAGE_SHELL.format(title="Items", body=body))


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
