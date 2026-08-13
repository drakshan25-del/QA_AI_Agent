"""Admin user management: HTML page + JSON API (Feature 2).

HTML follows the app's PRG pattern: successful writes 303-redirect back to
/admin with a one-shot success flash; validation failures re-render the form
with an error flash and the submitted values preserved (same convention as
the login page). Deletion always goes through a confirmation page.

The JSON API mirrors the existing {'error': code} convention:
    GET    /api/admin/users?q=&role=&status=   -> 200 {"admins": [...]}
    POST   /api/admin/users                    -> 201 | 409 | 422
    PUT    /api/admin/users/{id}               -> 200 | 404 | 409 | 422
    DELETE /api/admin/users/{id}               -> 204 | 404 | 409 (self)
Password hashes never appear in any response (store.public_admin).
"""

from __future__ import annotations

import html

from fastapi import APIRouter, Body, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from sample_app import store, ui

router = APIRouter()


def _options(choices: tuple[str, ...], selected: str, *, any_label: str | None = None) -> str:
    opts = []
    if any_label is not None:
        opts.append(f'<option value="">{html.escape(any_label)}</option>')
    for choice in choices:
        marker = " selected" if choice == selected else ""
        opts.append(f'<option value="{choice}"{marker}>{choice.capitalize()}</option>')
    return "".join(opts)


def _admin_form(values: dict, editing: dict | None) -> str:
    """Shared create/edit form; POST target and labels flip on edit."""
    if editing:
        action = f"/admin/users/{editing['id']}/update"
        title, submit = f"Edit admin: {editing['name']}", "Update admin"
        password_hint = "Leave blank to keep the current password"
        cancel = '<a href="/admin">Cancel</a>'
    else:
        action, title, submit = "/admin/users/add", "Add a new admin user", "Save admin"
        password_hint = f"At least {store.MIN_PASSWORD_LENGTH} characters"
        cancel = ""
    return f"""<form class="card-form" method="post" action="{action}" data-testid="admin-form">
    <div class="form-title">{html.escape(title)}</div>
    <label>Full name
      <input data-testid="admin-name" name="name" type="text" required
             value="{html.escape(values.get('name', ''))}">
    </label>
    <label>Email address
      <input data-testid="admin-email" name="email" type="email" required
             value="{html.escape(values.get('email', ''))}">
    </label>
    <label>Password <span class="muted">({password_hint})</span>
      <input data-testid="admin-password" name="password" type="password"
             autocomplete="new-password" minlength="{store.MIN_PASSWORD_LENGTH}"
             {'' if editing else 'required'}>
    </label>
    <label>Role
      <select data-testid="admin-role" name="role">{_options(store.ADMIN_ROLES, values.get('role', 'admin'))}</select>
    </label>
    <label>Account status
      <select data-testid="admin-status" name="status">{_options(store.ADMIN_STATUSES, values.get('status', 'active'))}</select>
    </label>
    <div class="form-actions"><button type="submit">{submit}</button>{cancel}</div>
  </form>"""


def _admin_table(admins: list[dict], current_admin_id: int) -> str:
    if not admins:
        return ui.empty_state("admins-empty", "No admin users found")
    rows = []
    for admin in admins:
        you = ' <span class="muted">(you)</span>' if admin["id"] == current_admin_id else ""
        rows.append(f"""      <tr data-testid="admin-row" data-admin-id="{admin['id']}">
        <td>{html.escape(admin['name'])}{you}</td>
        <td>{html.escape(admin['email'])}</td>
        <td>{html.escape(admin['role'])}</td>
        <td>{html.escape(admin['status'])}</td>
        <td class="muted">{html.escape(admin['created_at'][:10])}</td>
        <td class="actions">
          <a href="/admin?edit={admin['id']}">Edit</a>
          <a href="/admin/users/{admin['id']}/delete">Delete</a>
        </td>
      </tr>""")
    return f"""<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
{chr(10).join(rows)}
      </tbody>
    </table></div>"""


def _render_admin_page(request: Request, *, q: str = "", role: str = "", status: str = "",
                       edit: int | None = None, form_values: dict | None = None,
                       flash: tuple[str | None, str] = (None, "info")) -> HTMLResponse:
    admin = store.session_admin(request)
    editing = store.ADMINS.get(edit) if edit is not None else None
    values = form_values if form_values is not None else (
        store.public_admin(editing) if editing else {}
    )
    message, kind = flash

    toolbar = f"""<form class="toolbar" method="get" action="/admin">
    <label>Search
      <input data-testid="admin-search" name="q" type="search" placeholder="Name or email"
             value="{html.escape(q)}">
    </label>
    <label>Role
      <select name="role">{_options(store.ADMIN_ROLES, role, any_label='All roles')}</select>
    </label>
    <label>Status
      <select name="status">{_options(store.ADMIN_STATUSES, status, any_label='All statuses')}</select>
    </label>
    <button type="submit" class="quiet">Search</button>
  </form>"""

    body = f"""{ui.render_flash(message, kind)}
  {_admin_form(values, editing)}
  {toolbar}
  {_admin_table(store.query_admins(q, role, status), admin["id"])}"""
    return ui.page("Admin users", body, nav=("admin", admin["email"]), wide=True)


@router.get("/admin", response_class=HTMLResponse, response_model=None)
def admin_page(request: Request, q: str = "", role: str = "", status: str = "",
               edit: int | None = None) -> HTMLResponse | RedirectResponse:
    """Management page: form on top, searchable admin table below."""
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    token = store.current_session(request)
    return _render_admin_page(request, q=q, role=role, status=status, edit=edit,
                              flash=store.pop_flash(token))


@router.post("/admin/users/add", response_class=HTMLResponse, response_model=None)
def admin_create_submit(request: Request, name: str = Form(""), email: str = Form(""),
                        password: str = Form(""), role: str = Form("admin"),
                        status: str = Form("active")) -> HTMLResponse | RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    payload = {"name": name, "email": email, "password": password, "role": role, "status": status}
    error, norm = store.validate_admin_payload(payload, creating=True)
    if error:
        return _render_admin_page(request, form_values=payload,
                                  flash=(store.ERROR_MESSAGES[error], "error"))
    created = store.create_admin(norm)
    store.set_flash(store.current_session(request), f"Admin user '{created['name']}' created", "success")
    return RedirectResponse(url="/admin", status_code=303)


@router.post("/admin/users/{admin_id}/update", response_class=HTMLResponse, response_model=None)
def admin_update_submit(request: Request, admin_id: int, name: str = Form(""),
                        email: str = Form(""), password: str = Form(""),
                        role: str = Form("admin"),
                        status: str = Form("active")) -> HTMLResponse | RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    token = store.current_session(request)
    target = store.ADMINS.get(admin_id)
    if target is None:
        store.set_flash(token, store.ERROR_MESSAGES["not_found"], "error")
        return RedirectResponse(url="/admin", status_code=303)
    payload = {"name": name, "email": email, "password": password, "role": role, "status": status}
    error, norm = store.validate_admin_payload(payload, creating=False, admin_id=admin_id)
    if error:
        return _render_admin_page(request, edit=admin_id, form_values=payload,
                                  flash=(store.ERROR_MESSAGES[error], "error"))
    store.update_admin(target, norm)
    store.set_flash(token, f"Admin user '{norm['name']}' updated", "success")
    return RedirectResponse(url="/admin", status_code=303)


@router.get("/admin/users/{admin_id}/delete", response_class=HTMLResponse, response_model=None)
def admin_delete_confirm(request: Request, admin_id: int) -> HTMLResponse | RedirectResponse:
    """Confirmation dialog page shown before any admin deletion."""
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    admin = store.session_admin(request)
    target = store.ADMINS.get(admin_id)
    if target is None:
        store.set_flash(store.current_session(request), store.ERROR_MESSAGES["not_found"], "error")
        return RedirectResponse(url="/admin", status_code=303)
    self_note = (
        '<p class="muted">This is your own account — deletion will be refused.</p>'
        if target["id"] == admin["id"] else ""
    )
    body = f"""<div class="confirm-box" role="alertdialog" data-testid="confirm-dialog"
       aria-label="Confirm deletion">
    <p>Are you sure you want to delete admin user
       <strong>{html.escape(target['name'])}</strong>
       ({html.escape(target['email'])})? This cannot be undone.</p>
    {self_note}
    <div class="form-actions">
      <form class="inline" method="post" action="/admin/users/{admin_id}/delete">
        <button type="submit" class="danger">Confirm delete</button>
      </form>
      <a href="/admin">Cancel</a>
    </div>
  </div>"""
    return ui.page("Confirm deletion", body, nav=("admin", admin["email"]), wide=True)


@router.post("/admin/users/{admin_id}/delete")
def admin_delete_submit(request: Request, admin_id: int) -> RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    admin = store.session_admin(request)
    token = store.current_session(request)
    target = store.ADMINS.get(admin_id)
    if target is None:
        store.set_flash(token, store.ERROR_MESSAGES["not_found"], "error")
    elif target["id"] == admin["id"]:
        store.set_flash(token, store.ERROR_MESSAGES["cannot_delete_self"], "error")
    else:
        del store.ADMINS[admin_id]
        store.set_flash(token, f"Admin user '{target['name']}' deleted", "success")
    return RedirectResponse(url="/admin", status_code=303)


# --- JSON API ---------------------------------------------------------------------


@router.get("/api/admin/users")
def api_list_admins(request: Request, q: str = "", role: str = "", status: str = "") -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    admins = [store.public_admin(a) for a in store.query_admins(q, role, status)]
    return JSONResponse({"admins": admins})


@router.post("/api/admin/users")
def api_create_admin(request: Request, body: dict = Body(...)) -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    error, norm = store.validate_admin_payload(body, creating=True)
    if error:
        return store.api_error(error)
    return JSONResponse({"admin": store.public_admin(store.create_admin(norm))}, status_code=201)


@router.put("/api/admin/users/{admin_id}")
def api_update_admin(request: Request, admin_id: int, body: dict = Body(...)) -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    target = store.ADMINS.get(admin_id)
    if target is None:
        return store.api_error("not_found")
    error, norm = store.validate_admin_payload(body, creating=False, admin_id=admin_id)
    if error:
        return store.api_error(error)
    return JSONResponse({"admin": store.public_admin(store.update_admin(target, norm))})


@router.delete("/api/admin/users/{admin_id}", response_model=None)
def api_delete_admin(request: Request, admin_id: int) -> JSONResponse | Response:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    target = store.ADMINS.get(admin_id)
    if target is None:
        return store.api_error("not_found")
    if target["id"] == store.session_admin(request, api=True)["id"]:
        return store.api_error("cannot_delete_self")
    del store.ADMINS[admin_id]
    return Response(status_code=204)
