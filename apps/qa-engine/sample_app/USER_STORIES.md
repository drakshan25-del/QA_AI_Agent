# Sample Application — User Stories

User stories for every feature of the demo target app (`sample_app`), written
as the app's **correct intended behaviour**. They serve two purposes:

1. **Product documentation** of what the sample app does.
2. **Requirements input for the QA pipeline** — each story has a stable ID
   and testable acceptance criteria, so it can be fed to the requirement
   agent to generate test plans, test cases and automation. The seeded
   defect flags (`SAMPLE_APP_DEFECTS`) deliberately violate specific
   criteria below; a healthy app satisfies all of them.

**Personas**

| Persona | Description |
| --- | --- |
| **Admin** | An active admin account (seeded from env, default `demo@example.com`; more can be created on the Admin users page). Full access. |
| **Regular user** | A valid non-admin login (env credentials when `SAMPLE_ADMIN_EMAIL` points elsewhere). Items page only. |
| **Visitor** | Anyone without a valid session. |

---

## Epic 1 — Authentication & Sessions

### US-101 · Admin login lands on the Dashboard
**As an** admin, **I want** to log in with my email and password and be taken
straight to the Dashboard, **so that** I immediately see the state of the system.

**Acceptance criteria**
- Given the login page, when an active admin submits valid credentials, then
  they are redirected to `/dashboard` and a "Welcome" notification is shown.
- The navigation header shows Dashboard, Admin users, Products and Items,
  the logged-in email, and a Log out button.
- A disabled admin account cannot log in (treated as invalid credentials).

### US-102 · Regular user login lands on Items
**As a** regular user, **I want** to log in and reach my Items list,
**so that** I can manage my to-dos without seeing admin screens.

**Acceptance criteria**
- Given valid non-admin credentials, when the user logs in, then they are
  redirected to `/items` with a "Welcome" notification.
- Their navigation shows only Items and Log out — no admin links.

### US-103 · Failed login shows a clear error
**As a** visitor, **I want** a clear message when my credentials are wrong,
**so that** I know the login failed and why.

**Acceptance criteria**
- Given the login page, when invalid credentials are submitted, then the form
  is re-rendered with the message "Invalid credentials" (never "Server error").
- The JSON API (`POST /api/login`) returns 401 with `invalid_credentials`
  for bad credentials, and 200 with the success message "Welcome", a token
  and the caller's role (`admin` or `user`) on success.

### US-104 · Log out ends the session
**As a** logged-in user, **I want** to log out, **so that** my session cannot
be reused.

**Acceptance criteria**
- When the user clicks Log out, the session is invalidated, the cookie is
  cleared and they land on the login page.
- After logout (or session expiry), visiting any protected page redirects to
  `/login`, and API calls with the old token return 401.

---

## Epic 2 — Items (to-do list)

### US-201 · View my items
**As a** logged-in user, **I want** to see the current list of items,
**so that** I know what work is outstanding.

**Acceptance criteria**
- `/items` lists every item; visitors without a session are redirected to
  `/login`.
- The JSON API (`GET /api/items`) returns the same list; 401 without a session.

### US-202 · Add an item
**As a** logged-in user, **I want** to add a new item, **so that** I can track
new work.

**Acceptance criteria**
- Submitting non-blank text adds the item **exactly once** to the end of the
  list and returns to `/items`.
- Blank or whitespace-only text adds nothing (API: 422 `text_required`).

### US-203 · Delete an item
**As a** logged-in user, **I want** to delete an item, **so that** finished
work disappears from the list.

**Acceptance criteria**
- Clicking Delete next to an item removes **that item** from the list.
- Deleting a non-existent item via the API returns 404.

---

## Epic 3 — Admin Dashboard

### US-301 · Summary at a glance
**As an** admin, **I want** summary cards for admins and products,
**so that** I can gauge the system state in seconds.

**Acceptance criteria**
- The Dashboard shows live counts: total admin users, active admins, total
  products, units in stock, and total inventory value.
- Values always reflect the current data — after any admin/product change,
  reloading the Dashboard shows updated numbers (no hard-coded values).

### US-302 · Visual breakdowns
**As an** admin, **I want** charts of products by category and admins by role,
**so that** I can spot the distribution without reading tables.

**Acceptance criteria**
- Two bar charts render from live data: products per category and admin users
  per role, each bar labeled with its category/role and count.
- With no data, the chart area shows a "No data yet" empty state instead.

### US-303 · Recent activity
**As an** admin, **I want** to see the most recently added admins and products,
**so that** I can verify recent changes landed.

**Acceptance criteria**
- The Dashboard lists the three newest admins (name, email, role) and three
  newest products (name, category, price), newest first.
- Each list shows an empty state when there are no records.

### US-304 · Dashboard is admin-only
**As the** system owner, **I want** the Dashboard restricted to active admins,
**so that** regular users cannot see management data.

**Acceptance criteria**
- Visitors are redirected to `/login`; logged-in regular users are redirected
  to `/items` with a "not authorized" notification.
- `GET /api/dashboard/summary` returns 401 without a session, 403 for a
  non-admin session, and the full summary (never any password material) for
  an admin.

---

## Epic 4 — Admin User Management

### US-401 · Create an admin user
**As an** admin, **I want** to add a new admin with name, email, password,
role and status, **so that** colleagues can help manage the system.

**Acceptance criteria**
- The form requires full name, a valid email, and a password of at least
  8 characters; role is `admin` or `manager`, status `active` or `disabled`.
- On success a "created" notification is shown and the new admin appears in
  the table; API: 201 with the created record.
- A duplicate email (case-insensitive) is rejected — 409 `duplicate_email` —
  and submitting the same form twice creates only one account.
- Validation failures re-render the form with a clear error message and the
  entered values preserved; API returns 422 with a specific error code.
- Passwords are stored only as salted PBKDF2 hashes and are **never** returned
  by any page or API response.

### US-402 · Find admin users
**As an** admin, **I want** to search and filter the admin list,
**so that** I can find an account quickly.

**Acceptance criteria**
- Search matches name or email substrings; role and status filters narrow the
  list; filters combine.
- A search with no matches shows a "No admin users found" empty state.

### US-403 · Edit an admin user
**As an** admin, **I want** to update an admin's details, role or status,
**so that** access stays correct as responsibilities change.

**Acceptance criteria**
- Edit pre-fills the form; leaving the password blank keeps the current one.
- Changing status to `disabled` blocks that admin's future logins **and**
  revokes their existing sessions immediately.
- Email uniqueness is enforced on update as on create (409 on conflict);
  updating a missing account returns 404.
- On success an "updated" notification is shown and the table reflects it.

### US-404 · Delete an admin user, with confirmation
**As an** admin, **I want** deletions to require an explicit confirmation,
**so that** an account is never removed by accident.

**Acceptance criteria**
- Clicking Delete opens a confirmation dialog naming the account; only
  "Confirm delete" removes it — Cancel returns without changes.
- On success a "deleted" notification is shown and the account disappears
  from the table; API: 204, or 404 for a missing account.
- An admin can never delete **their own** account: the attempt is refused
  with a clear message (API: 409 `cannot_delete_self`) and the account stays.

### US-405 · Admin management is admin-only
**As the** system owner, **I want** the Admin users page and its API
restricted to active admins, **so that** account management cannot be abused.

**Acceptance criteria**
- Visitors are redirected to `/login`; regular users to `/items` with a
  "not authorized" notification.
- All `/api/admin/users` endpoints return 401 unauthenticated and 403 for
  non-admin sessions.

---

## Epic 5 — Product Management

### US-501 · Create a product
**As an** admin, **I want** to add a product with name, description, category,
price, stock, optional image URL and status, **so that** the catalogue stays
current.

**Acceptance criteria**
- Name and category are required; product names are unique
  (409 `duplicate_name` — a double submission creates only one product).
- Price must be a number from 0 to 1,000,000 (2-decimal precision); stock a
  whole number from 0 to 1,000,000 — negative or non-numeric values are
  rejected on both the form and the API (422 `invalid_price` /
  `invalid_stock`).
- An image URL, when given, must start with `http://` or `https://` and is
  shown as a thumbnail in the table.
- On success a "created" notification is shown, the product appears in the
  list, and the Dashboard totals update on next load.

### US-502 · Browse, search and sort products
**As an** admin, **I want** to search, filter and sort the product list,
**so that** I can work with a large catalogue efficiently.

**Acceptance criteria**
- Search matches name or description; category and status filters narrow the
  list; results can be sorted by newest, name, price or stock, ascending or
  descending.
- The list is paginated (8 per page on the page; API `page_size` 1–100,
  default 10) with Previous/Next controls, "Page X of Y" and a total count;
  out-of-range pages clamp to the nearest valid page.
- No matches shows a "No products found" empty state.

### US-503 · Edit a product
**As an** admin, **I want** to correct product details, **so that** the
catalogue stays accurate.

**Acceptance criteria**
- Edit pre-fills the form; all create-time validation applies equally.
- On success an "updated" notification is shown; the table and Dashboard
  reflect the change; updating a missing product returns 404.

### US-504 · Delete a product, with confirmation
**As an** admin, **I want** a confirmation step before deleting a product,
**so that** catalogue entries are not lost by accident.

**Acceptance criteria**
- Clicking Delete opens a confirmation dialog naming the product; only
  "Confirm delete" removes it — Cancel returns without changes.
- On success a "deleted" notification is shown and the product leaves the
  list and the Dashboard counts; API: 204, or 404 for a missing product.

### US-505 · Product management is admin-only
**As the** system owner, **I want** the Products page and its API restricted
to active admins, **so that** the catalogue cannot be modified anonymously.

**Acceptance criteria**
- Visitors are redirected to `/login`; regular users to `/items` with a
  "not authorized" notification.
- All `/api/products` endpoints return 401 unauthenticated and 403 for
  non-admin sessions.

---

## Feature 4 — reserved

Not yet defined. The architecture reserves a slot for it (one router module +
one nav entry); its user stories will be added here as US-6xx when specified.
