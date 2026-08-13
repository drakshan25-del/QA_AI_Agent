"""Shared in-memory state and domain logic for the demo target app.

The sample app deliberately has no database (SRS §16 controlled demo
environment): every store below is a module-level structure that resets on
restart, and re-seeding is the "migration". This module is the single source
of truth for that state so the feature routers (dashboard, admin users,
products) and the classic login/items surfaces in ``main`` share it.

Security notes:
* Admin passwords are hashed with PBKDF2-HMAC-SHA256 + per-user salt
  (stdlib only — no plaintext is ever stored) and the hash never leaves the
  process: :func:`public_admin` is the only serializer.
* Seed credentials come from the environment (FR-PROJ-004), defaults are
  documented demo placeholders.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timezone

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

SESSION_COOKIE = "session"

# --- classic state (formerly in main; same objects, same semantics) ---------
SESSIONS: dict[str, str] = {}  # session token -> username/email
FLASHES: dict[str, str] = {}  # session token -> pending flash message
FLASH_KINDS: dict[str, str] = {}  # session token -> flash kind (success|error|info)
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
    """Return the valid regular-user (username, password) pair from the env.

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


def api_session(request: Request) -> str | None:
    """Resolve the caller's session from a Bearer token or the cookie.

    The API issues the same session tokens as the HTML login, so the two
    surfaces stay behaviourally equivalent for regression comparison.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):].strip()
        if token in SESSIONS:
            return token
    return current_session(request)


def set_flash(token: str, message: str, kind: str = "success") -> None:
    """Queue a one-shot flash notification for the session."""
    FLASHES[token] = message
    FLASH_KINDS[token] = kind


def pop_flash(token: str) -> tuple[str | None, str]:
    """Consume the pending flash (message, kind) for the session."""
    return FLASHES.pop(token, None), FLASH_KINDS.pop(token, "info")


# --- admin users & products stores -------------------------------------------

ADMIN_ROLES = ("admin", "manager")
ADMIN_STATUSES = ("active", "disabled")
PRODUCT_STATUSES = ("active", "inactive")
MIN_PASSWORD_LENGTH = 8
MAX_MONEY = 1_000_000
PBKDF2_ITERATIONS = 120_000

ADMINS: dict[int, dict] = {}  # id -> {id,name,email,password_hash,role,status,created_at}
PRODUCTS: dict[int, dict] = {}  # id -> {id,name,description,category,price,stock,image_url,status,created_at}
_NEXT_ID = {"admin": 1, "product": 1}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_IMAGE_URL_RE = re.compile(r"^https?://\S+$")

#: API error code -> human message, shared by flash notifications and docs.
ERROR_MESSAGES = {
    "name_required": "Full name is required",
    "email_required": "Email address is required",
    "invalid_email": "Email address is not valid",
    "duplicate_email": "An admin with this email already exists",
    "password_required": "Password is required when creating an admin",
    "weak_password": f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
    "invalid_role": "Role must be one of: " + ", ".join(ADMIN_ROLES),
    "invalid_status": "Status is not valid",
    "cannot_delete_self": "You cannot delete your own active account",
    "not_found": "The requested record does not exist",
    "category_required": "Category is required",
    "duplicate_name": "A product with this name already exists",
    "invalid_price": "Price must be a number between 0 and 1,000,000",
    "invalid_stock": "Stock must be a whole number between 0 and 1,000,000",
    "invalid_image_url": "Image URL must start with http:// or https://",
    "unauthorized": "Please log in",
    "forbidden": "You are not authorized to do that",
}

#: HTTP status per error code (API surface); anything absent is 422.
ERROR_STATUS = {
    "duplicate_email": 409,
    "duplicate_name": 409,
    "cannot_delete_self": 409,
    "not_found": 404,
    "unauthorized": 401,
    "forbidden": 403,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _next_id(kind: str) -> int:
    value = _NEXT_ID[kind]
    _NEXT_ID[kind] = value + 1
    return value


def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256 with a fresh per-user salt (stdlib only)."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time check of ``password`` against a stored hash."""
    try:
        _algo, iterations, salt, digest = encoded.split("$", 3)
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(candidate.hex(), digest)
    except (AttributeError, TypeError, ValueError):
        return False


# --- authentication / authorization ------------------------------------------


def find_admin_by_email(email: str) -> dict | None:
    """Case-insensitive lookup of an admin account by email."""
    needle = (email or "").strip().lower()
    for admin in ADMINS.values():
        if admin["email"].lower() == needle:
            return admin
    return None


def verify_admin_login(email: str, password: str) -> dict | None:
    """Return the admin record for valid, *active* admin credentials."""
    admin = find_admin_by_email(email)
    if admin and admin["status"] == "active" and verify_password(password, admin["password_hash"]):
        return admin
    return None


def session_admin(request: Request, *, api: bool = False) -> dict | None:
    """Resolve the request's session to an active admin account, if any.

    Role is derived from the store on every request, so disabling or
    deleting an admin revokes their access immediately.
    """
    token = api_session(request) if api else current_session(request)
    if token is None:
        return None
    admin = find_admin_by_email(SESSIONS.get(token, ""))
    if admin and admin["status"] == "active":
        return admin
    return None


def admin_guard_html(request: Request) -> RedirectResponse | None:
    """Redirect non-admin visitors away from admin HTML pages (else None).

    No session -> /login. A valid non-admin session -> /items with an
    error flash, so the regular demo user gets a clear notification.
    """
    if session_admin(request) is not None:
        return None
    token = current_session(request)
    if token is None:
        return RedirectResponse(url="/login", status_code=303)
    set_flash(token, ERROR_MESSAGES["forbidden"], "error")
    return RedirectResponse(url="/items", status_code=303)


def admin_guard_api(request: Request) -> JSONResponse | None:
    """401/403 JSON response for non-admin API callers (else None)."""
    if session_admin(request, api=True) is not None:
        return None
    if api_session(request) is None:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return JSONResponse({"error": "forbidden"}, status_code=403)


def api_error(code: str) -> JSONResponse:
    """Uniform API error body following the existing {'error': code} shape."""
    return JSONResponse({"error": code}, status_code=ERROR_STATUS.get(code, 422))


# --- validation ---------------------------------------------------------------


def validate_admin_payload(
    data: dict, *, creating: bool, admin_id: int | None = None
) -> tuple[str | None, dict]:
    """Validate an admin create/update payload.

    Returns:
        (error_code, normalized) — error_code is None when valid. For
        updates, missing fields fall back to the current record's values
        and a blank password means "keep the existing one".
    """
    current = ADMINS.get(admin_id, {}) if admin_id is not None else {}

    name = str(data.get("name", current.get("name", "")) or "").strip()
    if not name:
        return "name_required", {}

    email = str(data.get("email", current.get("email", "")) or "").strip().lower()
    if not email:
        return "email_required", {}
    if not _EMAIL_RE.match(email):
        return "invalid_email", {}
    existing = find_admin_by_email(email)
    if existing is not None and existing["id"] != admin_id:
        return "duplicate_email", {}

    password = str(data.get("password") or "")
    if creating and not password:
        return "password_required", {}
    if password and len(password) < MIN_PASSWORD_LENGTH:
        return "weak_password", {}

    role = str(data.get("role", current.get("role", "")) or "admin").strip().lower()
    if role not in ADMIN_ROLES:
        return "invalid_role", {}

    status = str(data.get("status", current.get("status", "")) or "active").strip().lower()
    if status not in ADMIN_STATUSES:
        return "invalid_status", {}

    return None, {"name": name, "email": email, "password": password, "role": role, "status": status}


def _parse_price(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    if price != price or price in (float("inf"), float("-inf")):  # NaN / inf
        return None
    if not 0 <= price <= MAX_MONEY:
        return None
    return round(price, 2)


def _parse_stock(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, float):
        if not value.is_integer():
            return None
        value = int(value)
    try:
        stock = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not 0 <= stock <= MAX_MONEY:
        return None
    return stock


def validate_product_payload(data: dict, *, product_id: int | None = None) -> tuple[str | None, dict]:
    """Validate a product create/update payload (same contract as admins)."""
    current = PRODUCTS.get(product_id, {}) if product_id is not None else {}

    name = str(data.get("name", current.get("name", "")) or "").strip()
    if not name:
        return "name_required", {}
    for product in PRODUCTS.values():
        if product["name"].lower() == name.lower() and product["id"] != product_id:
            return "duplicate_name", {}

    category = str(data.get("category", current.get("category", "")) or "").strip()
    if not category:
        return "category_required", {}

    description = str(data.get("description", current.get("description", "")) or "").strip()

    price = _parse_price(data.get("price", current.get("price")))
    if price is None:
        return "invalid_price", {}

    stock = _parse_stock(data.get("stock", current.get("stock")))
    if stock is None:
        return "invalid_stock", {}

    image_url = str(data.get("image_url", current.get("image_url", "")) or "").strip()
    if image_url and not _IMAGE_URL_RE.match(image_url):
        return "invalid_image_url", {}

    status = str(data.get("status", current.get("status", "")) or "active").strip().lower()
    if status not in PRODUCT_STATUSES:
        return "invalid_status", {}

    return None, {
        "name": name,
        "description": description,
        "category": category,
        "price": price,
        "stock": stock,
        "image_url": image_url,
        "status": status,
    }


# --- CRUD ----------------------------------------------------------------------


def public_admin(admin: dict) -> dict:
    """Serializer used by every surface — never exposes password material."""
    return {
        "id": admin["id"],
        "name": admin["name"],
        "email": admin["email"],
        "role": admin["role"],
        "status": admin["status"],
        "created_at": admin["created_at"],
    }


def create_admin(norm: dict) -> dict:
    admin_id = _next_id("admin")
    ADMINS[admin_id] = {
        "id": admin_id,
        "name": norm["name"],
        "email": norm["email"],
        "password_hash": hash_password(norm["password"]),
        "role": norm["role"],
        "status": norm["status"],
        "created_at": _now(),
    }
    return ADMINS[admin_id]


def update_admin(admin: dict, norm: dict) -> dict:
    admin["name"] = norm["name"]
    admin["email"] = norm["email"]
    admin["role"] = norm["role"]
    admin["status"] = norm["status"]
    if norm["password"]:
        admin["password_hash"] = hash_password(norm["password"])
    return admin


def query_admins(q: str = "", role: str = "", status: str = "") -> list[dict]:
    """Search (name/email substring) and filter the admin list, oldest first."""
    needle = q.strip().lower()
    results = []
    for admin in sorted(ADMINS.values(), key=lambda a: a["id"]):
        if needle and needle not in admin["name"].lower() and needle not in admin["email"].lower():
            continue
        if role and admin["role"] != role:
            continue
        if status and admin["status"] != status:
            continue
        results.append(admin)
    return results


def public_product(product: dict) -> dict:
    return dict(product)


def create_product(norm: dict) -> dict:
    product_id = _next_id("product")
    PRODUCTS[product_id] = {"id": product_id, "created_at": _now(), **norm}
    return PRODUCTS[product_id]


def update_product(product: dict, norm: dict) -> dict:
    product.update(norm)
    return product


_PRODUCT_SORTS = {
    "name": lambda p: p["name"].lower(),
    "price": lambda p: p["price"],
    "stock": lambda p: p["stock"],
    "created": lambda p: p["id"],
}


def query_products(
    q: str = "", category: str = "", status: str = "", sort: str = "created", order: str = "desc"
) -> list[dict]:
    """Search (name/description), filter, and sort the product list."""
    needle = q.strip().lower()
    results = []
    for product in PRODUCTS.values():
        if needle and needle not in product["name"].lower() and needle not in product["description"].lower():
            continue
        if category and product["category"] != category:
            continue
        if status and product["status"] != status:
            continue
        results.append(product)
    key = _PRODUCT_SORTS.get(sort, _PRODUCT_SORTS["created"])
    return sorted(results, key=key, reverse=(order != "asc"))


def paginate(rows: list, page: int, page_size: int) -> tuple[list, int, int, int]:
    """Clamp-and-slice pagination.

    Returns:
        (page_rows, total, pages, page) with page clamped into [1, pages].
    """
    total = len(rows)
    page_size = max(1, min(page_size, 100))
    pages = max(1, -(-total // page_size))
    page = max(1, min(page, pages))
    start = (page - 1) * page_size
    return rows[start:start + page_size], total, pages, page


def product_categories() -> list[str]:
    return sorted({p["category"] for p in PRODUCTS.values()})


# --- dashboard -----------------------------------------------------------------


def dashboard_summary() -> dict:
    """Aggregate live store data for the dashboard page and API."""
    admins = sorted(ADMINS.values(), key=lambda a: a["id"])
    products = sorted(PRODUCTS.values(), key=lambda p: p["id"])

    by_category: dict[str, int] = {}
    for product in products:
        by_category[product["category"]] = by_category.get(product["category"], 0) + 1
    by_role: dict[str, int] = {}
    for admin in admins:
        by_role[admin["role"]] = by_role.get(admin["role"], 0) + 1

    return {
        "admins": {
            "total": len(admins),
            "active": sum(1 for a in admins if a["status"] == "active"),
            "by_role": by_role,
            "recent": [public_admin(a) for a in admins[-3:]][::-1],
        },
        "products": {
            "total": len(products),
            "active": sum(1 for p in products if p["status"] == "active"),
            "stock_units": sum(p["stock"] for p in products),
            "inventory_value": round(sum(p["price"] * p["stock"] for p in products), 2),
            "by_category": by_category,
            "recent": [public_product(p) for p in products[-3:]][::-1],
        },
    }


# --- seed data ("migration" for the no-database architecture) -------------------

_SEED_PRODUCTS = [
    ("Wireless Mouse", "Ergonomic 2.4 GHz wireless mouse", "Electronics", 24.99, 120, "active"),
    ("Mechanical Keyboard", "Tenkeyless board with brown switches", "Electronics", 89.50, 45, "active"),
    ("Laptop Stand", "Adjustable aluminium laptop stand", "Accessories", 39.00, 60, "active"),
    ("USB-C Hub", "7-in-1 hub with HDMI and card reader", "Accessories", 54.25, 0, "inactive"),
    ("Notebook A5", "Dotted notebook, 180 pages", "Stationery", 6.75, 300, "active"),
    ("Gel Pen Set", "Set of 10 assorted gel pens", "Stationery", 12.40, 150, "active"),
]


def seed_admin_credentials() -> tuple[str, str]:
    """Seed admin credentials from the environment.

    Defaults to the demo user's credentials (QA_TEST_USERNAME/PASSWORD), so
    out of the box the well-known demo login is an admin and lands on the
    dashboard. Set SAMPLE_ADMIN_EMAIL/SAMPLE_ADMIN_PASSWORD to a different
    pair to keep a separate non-admin demo user (the tests do this).
    """
    fallback_email, fallback_password = expected_credentials()
    email = os.environ.get("SAMPLE_ADMIN_EMAIL", fallback_email)
    password = os.environ.get("SAMPLE_ADMIN_PASSWORD", fallback_password)
    return email, password


def reset_demo_data() -> None:
    """(Re-)seed the admin and product stores — the in-memory 'migration'.

    Called at import so the app always boots with one active admin account
    and a small product catalogue; tests call it to restore a known state.
    """
    ADMINS.clear()
    PRODUCTS.clear()
    _NEXT_ID["admin"] = 1
    _NEXT_ID["product"] = 1

    email, password = seed_admin_credentials()
    create_admin(
        {"name": "Demo Admin", "email": email.lower(), "password": password,
         "role": "admin", "status": "active"}
    )
    for name, description, category, price, stock, status in _SEED_PRODUCTS:
        create_product(
            {"name": name, "description": description, "category": category,
             "price": price, "stock": stock, "image_url": "", "status": status}
        )


reset_demo_data()
