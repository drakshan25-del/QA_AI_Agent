# Sample App — Demo Target with Seedable Defects

A self-contained FastAPI application used as the controlled demo environment
for the Agentic AI QA System (SRS §16). Its seeded defects are the ground
truth for the "defect detection rate: known seeded defects" metric (SRS §15.2).

No database — all state lives in memory and resets on restart.

## Run

```bash
# from apps/qa-engine (where the uv-managed .venv lives)
.venv/bin/python -m uvicorn sample_app.main:app --port 8001
```

The QA system's default `target_base_url` is `http://localhost:8001`.

## Credentials

Valid login credentials are read from the environment on every request
(never hard-coded — FR-PROJ-004):

| Env var            | Default            |
| ------------------ | ------------------ |
| `QA_TEST_USERNAME` | `demo@example.com` |
| `QA_TEST_PASSWORD` | `change-me`        |

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

| Route                     | Behaviour                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| `GET /health`             | `{"status": "ok"}`                                               |
| `GET /login`              | Login form                                                       |
| `POST /login`             | Success: session cookie + 303 to `/items` with `Welcome` flash. Failure: re-renders form with error flash. |
| `GET /items`              | Item list (requires session cookie, else 303 to `/login`)        |
| `POST /items/add`         | Add item (form field `text`), 303 back to `/items`               |
| `POST /items/{idx}/delete`| Delete item at index, 303 back to `/items`                       |

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
