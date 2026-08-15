# Sample App — Demo Target with Seedable Defects

A self-contained FastAPI application used as the controlled demo environment
for the Agentic AI QA System (SRS §16). Its seeded defects are the ground
truth for the "defect detection rate: known seeded defects" metric (SRS §15.2).

No database — all state lives in memory and resets on restart. Seeding
(`store.reset_demo_data()`) is the in-memory equivalent of a migration: it
runs at import and can be called from tests to restore a known state.

## Run

```bash
# from apps/qa-engine (where the uv-managed .venv lives)
.venv/bin/python -m uvicorn sample_app.main:app --port 8001
```

The QA system's default `target_base_url` is `http://localhost:8001`.

## Credentials

Credentials are read from the environment (never hard-coded — FR-PROJ-004).
The env user is checked on every request; the admin account is seeded at
startup (restart to rotate):

| Env var                 | Default                  | Grants                  |
| ----------------------- | ------------------------ | ----------------------- |
| `QA_TEST_USERNAME`      | `demo@example.com`       | Demo login              |
| `QA_TEST_PASSWORD`      | `change-me`              |                         |
| `SAMPLE_ADMIN_EMAIL`    | value of `QA_TEST_USERNAME` | Dashboard, Admin users, Products (+ Items) |
| `SAMPLE_ADMIN_PASSWORD` | value of `QA_TEST_PASSWORD` |                      |

**By default the demo login IS the seeded admin**, so
`demo@example.com` / `change-me` lands on `/dashboard` with the full
Dashboard / Admin users / Products navigation. Set `SAMPLE_ADMIN_*` to a
different pair to keep a separate non-admin demo user — a non-admin login
lands on `/items` and only sees the Items page.

**Login redirect contract:** an active admin lands on `/dashboard`; a
non-admin env user lands on `/items`. Both see the same
`[data-testid=flash]` "Welcome" message.

## Seeded defect flags

Set `SAMPLE_APP_DEFECTS` to a comma-separated list of flags. The variable is
re-read on **every request**, so tests can toggle defects without restarting
the server (default: empty = healthy app).

| Flag            | Defective behaviour                                             |
| --------------- | --------------------------------------------------------------- |
| `login_message` | Failed login shows `Server error` instead of `Invalid credentials` |
| `duplicate_add` | Adding an item inserts it twice                                  |
| `delete_noop`   | The Delete button does nothing                                   |

Example:

```bash
SAMPLE_APP_DEFECTS=login_message,duplicate_add \
  .venv/bin/python -m uvicorn sample_app.main:app --port 8001
```

## Routes

### Classic surface (selector contract unchanged)

| Route                     | Behaviour                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| `GET /health`             | `{"status": "ok"}`                                               |
| `GET /login`              | Login form                                                       |
| `POST /login`             | Browser form submit (`Sec-Fetch-Mode: navigate`) — regular user: 303 to `/items`, admin: 303 to `/dashboard`, both with `Welcome` flash; failure re-renders the form. API clients (curl/Swagger/httpx) — 200 JSON `{"status":"success","message":"Login successful","data":{"user":{id,email,firstName,lastName,role},"authentication":{tokenType,accessToken,expiresInSeconds,refreshToken}}}`; failure 401 `{"status":"error","message":"Invalid credentials"}`. The `accessToken` works as `Bearer` auth on `/api/*`. |
| `POST /logout`            | Ends the session, 303 to `/login`                                |
| `GET /items`              | Item list (requires session cookie, else 303 to `/login`)        |
| `POST /items/add`         | Add item (form field `text`), 303 back to `/items`               |
| `POST /items/{idx}/delete`| Delete item at index, 303 back to `/items`                       |

### Admin HTML surface (active admin session required; others are redirected)

| Route                                 | Behaviour                                        |
| ------------------------------------- | ------------------------------------------------ |
| `GET /dashboard`                      | Summary cards, recent admins/products, SVG charts |
| `GET /admin?q=&role=&status=&edit=`   | Admin management: form + searchable table        |
| `POST /admin/users/add`               | Create admin (PRG + flash; re-renders on error)  |
| `POST /admin/users/{id}/update`       | Update admin (blank password = keep current)     |
| `GET/POST /admin/users/{id}/delete`   | Confirmation page, then delete (self-delete refused) |
| `GET /products?q=&category=&status=&sort=&order=&page=&edit=` | Product management: form + filtered, sorted, paginated table (8/page) |
| `POST /products/add`                  | Create product (PRG + flash; re-renders on error) |
| `POST /products/{id}/update`          | Update product                                   |
| `GET/POST /products/{id}/delete`      | Confirmation page, then delete                   |

### JSON API

Auth: `Authorization: Bearer <token>` from `POST /api/login`, or the session
cookie. Errors are always `{"error": "<code>"}` — 401 unauthenticated,
403 non-admin, 404 missing, 409 conflict (`duplicate_email`,
`duplicate_name`, `cannot_delete_self`), 422 validation.

| Route                            | Behaviour                                        |
| -------------------------------- | ------------------------------------------------ |
| `GET /api/health`                | `{"status": "ok"}`                               |
| `POST /api/login`                | 200 `{"status":"ok","message":"Welcome","token",…,"role"}` — role `admin`/`user`; 401 `invalid_credentials` |
| `GET/POST /api/items`, `DELETE /api/items/{id}` | Item CRUD (any session; defect-aware) |
| `GET /api/dashboard/summary`     | Live totals, recents, by-category/by-role counts |
| `GET /api/admin/users?q=&role=&status=` | Admin list — never includes password material |
| `POST /api/admin/users`          | Create (PBKDF2-hashed password, min 8 chars)     |
| `PUT /api/admin/users/{id}`      | Partial update; blank/absent password = keep     |
| `DELETE /api/admin/users/{id}`   | 204; 409 `cannot_delete_self` for own account    |
| `GET /api/products?q=&category=&status=&sort=&order=&page=&page_size=` | Paginated list (`total`, `page`, `pages`) |
| `POST /api/products`             | Create (price 0–1M, integer stock ≥ 0)           |
| `PUT /api/products/{id}`         | Partial update, same validation                  |
| `DELETE /api/products/{id}`      | 204 / 404                                        |

## Selector contract

Generated page objects depend on these selectors and accessible names —
they must never change:

| Element            | Selector / accessible name  |
| ------------------ | --------------------------- |
| Username input     | `[data-testid="username"]`  |
| Password input     | `[data-testid="password"]`  |
| Login button       | button `Log in`             |
| Flash message      | `[data-testid="flash"]`     |
| Item row           | `li[data-testid="item"]`    |
| Delete button      | button `Delete` (per item)  |
| New item input     | `[data-testid="new-item"]`  |
| Add button         | button `Add`                |

Additive admin-feature selectors (stable, safe to target from new tests):
nav `[data-testid=nav]`; dashboard `stat-total-admins`, `stat-active-admins`,
`stat-total-products`, `stat-stock-units`, `stat-inventory-value`,
`chart-products-by-category`, `chart-admins-by-role`, `recent-admins`,
`recent-products` (each with a `…-empty` empty-state twin); admin page
`admin-form`, `admin-name`, `admin-email`, `admin-password`, `admin-role`,
`admin-status`, `admin-search`, `admin-row`, `admins-empty`; products page
`product-form`, `product-name`, `product-category`, `product-price`,
`product-stock`, `product-image-url`, `product-status`,
`product-description`, `product-search`, `filter-category`, `filter-status`,
`sort-by`, `sort-order`, `product-row`, `products-empty`, `pagination`;
delete flows `confirm-dialog` with buttons `Confirm delete` / link `Cancel`.

## Architecture / extending (Feature 4 slot)

- `store.py` — all in-memory state, validation, hashing, seeding.
- `ui.py` — shared page shell, nav, flash kinds, cards, SVG bar charts.
- `dashboard_routes.py`, `admin_routes.py`, `product_routes.py` — one
  APIRouter per feature (HTML + JSON together).
- `main.py` — classic surface + router registration.

To add Feature 4: create `<feature>_routes.py` with an `APIRouter`, reuse
`store.admin_guard_html/admin_guard_api` and the `ui` helpers, register it
at the bottom of `main.py`, and add its nav link to `ui._NAV_LINKS`.
