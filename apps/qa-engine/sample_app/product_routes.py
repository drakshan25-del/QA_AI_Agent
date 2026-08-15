"""Product management: HTML page + JSON API (Feature 3).

Same conventions as admin_routes: PRG with one-shot flashes for writes,
form re-render on validation errors, confirmation page before deletion,
{'error': code} JSON errors. The list supports search, category/status
filters, sorting and pagination on both surfaces; every render recomputes
from the live store, so the table and the Dashboard stay in sync after
each change.
"""

from __future__ import annotations

import html
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from sample_app import store, ui

router = APIRouter()

PAGE_SIZE = 8  # HTML table page size; the API accepts page_size=1..100

_SORTS = (("created", "Newest"), ("name", "Name"), ("price", "Price"), ("stock", "Stock"))


def _select(name: str, testid: str, options: list[tuple[str, str]], selected: str,
            any_label: str | None = None) -> str:
    opts = []
    if any_label is not None:
        opts.append(f'<option value="">{html.escape(any_label)}</option>')
    for value, label in options:
        marker = " selected" if value == selected else ""
        opts.append(f'<option value="{html.escape(value)}"{marker}>{html.escape(label)}</option>')
    return f'<select data-testid="{testid}" name="{name}">{"".join(opts)}</select>'


def _product_form(values: dict, editing: dict | None) -> str:
    if editing:
        action = f"/products/{editing['id']}/update"
        title, submit = f"Edit product: {editing['name']}", "Update product"
        cancel = '<a href="/products">Cancel</a>'
    else:
        action, title, submit = "/products/add", "Add a new product", "Save product"
        cancel = ""
    status_options = [(s, s.capitalize()) for s in store.PRODUCT_STATUSES]
    price = values.get("price", "")
    stock = values.get("stock", "")
    return f"""<form class="card-form" method="post" action="{action}" data-testid="product-form">
    <div class="form-title">{html.escape(title)}</div>
    <label>Product name
      <input data-testid="product-name" name="name" type="text" required
             value="{html.escape(str(values.get('name', '')))}">
    </label>
    <label>Category
      <input data-testid="product-category" name="category" type="text" required
             list="category-suggestions" value="{html.escape(str(values.get('category', '')))}">
    </label>
    <datalist id="category-suggestions">
      {''.join(f'<option value="{html.escape(c)}"></option>' for c in store.product_categories())}
    </datalist>
    <label>Price
      <input data-testid="product-price" name="price" type="number" min="0" step="0.01" required
             value="{html.escape(str(price))}">
    </label>
    <label>Stock quantity
      <input data-testid="product-stock" name="stock" type="number" min="0" step="1" required
             value="{html.escape(str(stock))}">
    </label>
    <label>Image URL <span class="muted">(optional)</span>
      <input data-testid="product-image-url" name="image_url" type="url"
             value="{html.escape(str(values.get('image_url', '')))}">
    </label>
    <label>Status
      {_select("status", "product-status", status_options, str(values.get('status', 'active')))}
    </label>
    <label style="grid-column:1/-1">Description
      <textarea data-testid="product-description" name="description" rows="2">{html.escape(str(values.get('description', '')))}</textarea>
    </label>
    <div class="form-actions"><button type="submit">{submit}</button>{cancel}</div>
  </form>"""


def _product_table(products: list[dict]) -> str:
    if not products:
        return ui.empty_state("products-empty", "No products found")
    rows = []
    for product in products:
        thumb = (
            f'<img class="thumb" src="{html.escape(product["image_url"])}" '
            f'alt="{html.escape(product["name"])}" loading="lazy"> '
            if product["image_url"] else ""
        )
        rows.append(f"""      <tr data-testid="product-row" data-product-id="{product['id']}">
        <td>{thumb}{html.escape(product['name'])}</td>
        <td>{html.escape(product['category'])}</td>
        <td>${product['price']:,.2f}</td>
        <td>{product['stock']}</td>
        <td>{html.escape(product['status'])}</td>
        <td class="muted">{html.escape(product['created_at'][:10])}</td>
        <td class="actions">
          <a href="/products?edit={product['id']}">Edit</a>
          <a href="/products/{product['id']}/delete">Delete</a>
        </td>
      </tr>""")
    return f"""<div class="table-wrap"><table>
      <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
{chr(10).join(rows)}
      </tbody>
    </table></div>"""


def _pagination(page: int, pages: int, total: int, params: dict) -> str:
    if pages <= 1:
        return f'<div class="pagination" data-testid="pagination"><span class="muted">{total} product(s)</span></div>'
    def link(target: int, label: str) -> str:
        query = urlencode({**params, "page": target})
        return f'<a href="/products?{query}">{label}</a>'
    prev_link = link(page - 1, "Previous") if page > 1 else '<span class="muted">Previous</span>'
    next_link = link(page + 1, "Next") if page < pages else '<span class="muted">Next</span>'
    return (
        f'<div class="pagination" data-testid="pagination">{prev_link}'
        f'<span>Page {page} of {pages}</span>{next_link}'
        f'<span class="muted">{total} product(s)</span></div>'
    )


def _render_products_page(request: Request, *, q: str = "", category: str = "",
                          status: str = "", sort: str = "created", order: str = "desc",
                          page: int = 1, edit: int | None = None,
                          form_values: dict | None = None,
                          flash: tuple[str | None, str] = (None, "info")) -> HTMLResponse:
    admin = store.session_admin(request)
    editing = store.PRODUCTS.get(edit) if edit is not None else None
    values = form_values if form_values is not None else (dict(editing) if editing else {})
    message, kind = flash

    filtered = store.query_products(q, category, status, sort, order)
    page_rows, total, pages, page = store.paginate(filtered, page, PAGE_SIZE)
    category_options = [(c, c) for c in store.product_categories()]
    status_options = [(s, s.capitalize()) for s in store.PRODUCT_STATUSES]
    order_options = [("desc", "Descending"), ("asc", "Ascending")]

    toolbar = f"""<form class="toolbar" method="get" action="/products">
    <label>Search
      <input data-testid="product-search" name="q" type="search" placeholder="Name or description"
             value="{html.escape(q)}">
    </label>
    <label>Category {_select("category", "filter-category", category_options, category, "All categories")}</label>
    <label>Status {_select("status", "filter-status", status_options, status, "All statuses")}</label>
    <label>Sort by {_select("sort", "sort-by", list(_SORTS), sort)}</label>
    <label>Order {_select("order", "sort-order", order_options, order)}</label>
    <button type="submit" class="quiet">Apply</button>
  </form>"""

    body = f"""{ui.render_flash(message, kind)}
  {_product_form(values, editing)}
  {toolbar}
  {_product_table(page_rows)}
  {_pagination(page, pages, total, {"q": q, "category": category, "status": status,
                                    "sort": sort, "order": order})}"""
    return ui.page("Products", body, nav=("admin", admin["email"]), wide=True)


@router.get("/products", response_class=HTMLResponse, response_model=None)
def products_page(request: Request, q: str = "", category: str = "", status: str = "",
                  sort: str = "created", order: str = "desc", page: int = 1,
                  edit: int | None = None) -> HTMLResponse | RedirectResponse:
    """Management page: form on top; searchable, sortable, paginated table."""
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    token = store.current_session(request)
    return _render_products_page(request, q=q, category=category, status=status, sort=sort,
                                 order=order, page=page, edit=edit, flash=store.pop_flash(token))


@router.post("/products/add", response_class=HTMLResponse, response_model=None)
def product_create_submit(request: Request, name: str = Form(""), description: str = Form(""),
                          category: str = Form(""), price: str = Form(""),
                          stock: str = Form(""), image_url: str = Form(""),
                          status: str = Form("active")) -> HTMLResponse | RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    payload = {"name": name, "description": description, "category": category,
               "price": price, "stock": stock, "image_url": image_url, "status": status}
    error, norm = store.validate_product_payload(payload)
    if error:
        return _render_products_page(request, form_values=payload,
                                     flash=(store.ERROR_MESSAGES[error], "error"))
    created = store.create_product(norm)
    store.set_flash(store.current_session(request), f"Product '{created['name']}' created", "success")
    return RedirectResponse(url="/products", status_code=303)


@router.post("/products/{product_id}/update", response_class=HTMLResponse, response_model=None)
def product_update_submit(request: Request, product_id: int, name: str = Form(""),
                          description: str = Form(""), category: str = Form(""),
                          price: str = Form(""), stock: str = Form(""),
                          image_url: str = Form(""),
                          status: str = Form("active")) -> HTMLResponse | RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    token = store.current_session(request)
    target = store.PRODUCTS.get(product_id)
    if target is None:
        store.set_flash(token, store.ERROR_MESSAGES["not_found"], "error")
        return RedirectResponse(url="/products", status_code=303)
    payload = {"name": name, "description": description, "category": category,
               "price": price, "stock": stock, "image_url": image_url, "status": status}
    error, norm = store.validate_product_payload(payload, product_id=product_id)
    if error:
        return _render_products_page(request, edit=product_id, form_values=payload,
                                     flash=(store.ERROR_MESSAGES[error], "error"))
    store.update_product(target, norm)
    store.set_flash(token, f"Product '{norm['name']}' updated", "success")
    return RedirectResponse(url="/products", status_code=303)


@router.get("/products/{product_id}/delete", response_class=HTMLResponse, response_model=None)
def product_delete_confirm(request: Request, product_id: int) -> HTMLResponse | RedirectResponse:
    """Confirmation dialog page shown before any product deletion."""
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    admin = store.session_admin(request)
    target = store.PRODUCTS.get(product_id)
    if target is None:
        store.set_flash(store.current_session(request), store.ERROR_MESSAGES["not_found"], "error")
        return RedirectResponse(url="/products", status_code=303)
    body = f"""<div class="confirm-box" role="alertdialog" data-testid="confirm-dialog"
       aria-label="Confirm deletion">
    <p>Are you sure you want to delete product
       <strong>{html.escape(target['name'])}</strong>
       ({html.escape(target['category'])}, ${target['price']:,.2f})? This cannot be undone.</p>
    <div class="form-actions">
      <form class="inline" method="post" action="/products/{product_id}/delete">
        <button type="submit" class="danger">Confirm delete</button>
      </form>
      <a href="/products">Cancel</a>
    </div>
  </div>"""
    return ui.page("Confirm deletion", body, nav=("admin", admin["email"]), wide=True)


@router.post("/products/{product_id}/delete")
def product_delete_submit(request: Request, product_id: int) -> RedirectResponse:
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    token = store.current_session(request)
    target = store.PRODUCTS.pop(product_id, None)
    if target is None:
        store.set_flash(token, store.ERROR_MESSAGES["not_found"], "error")
    else:
        store.set_flash(token, f"Product '{target['name']}' deleted", "success")
    return RedirectResponse(url="/products", status_code=303)


# --- JSON API ---------------------------------------------------------------------


@router.get("/api/products")
def api_list_products(request: Request, q: str = "", category: str = "", status: str = "",
                      sort: str = "created", order: str = "desc", page: int = 1,
                      page_size: int = 10) -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    filtered = store.query_products(q, category, status, sort, order)
    rows, total, pages, page = store.paginate(filtered, page, page_size)
    return JSONResponse({
        "products": [store.public_product(p) for p in rows],
        "total": total, "page": page, "pages": pages, "page_size": min(max(page_size, 1), 100),
    })


@router.post("/api/products")
def api_create_product(request: Request, body: dict = Body(...)) -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    error, norm = store.validate_product_payload(body)
    if error:
        return store.api_error(error)
    return JSONResponse({"product": store.public_product(store.create_product(norm))}, status_code=201)


@router.put("/api/products/{product_id}")
def api_update_product(request: Request, product_id: int, body: dict = Body(...)) -> JSONResponse:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    target = store.PRODUCTS.get(product_id)
    if target is None:
        return store.api_error("not_found")
    error, norm = store.validate_product_payload(body, product_id=product_id)
    if error:
        return store.api_error(error)
    return JSONResponse({"product": store.public_product(store.update_product(target, norm))})


@router.delete("/api/products/{product_id}", response_model=None)
def api_delete_product(request: Request, product_id: int) -> JSONResponse | Response:
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    if store.PRODUCTS.pop(product_id, None) is None:
        return store.api_error("not_found")
    return Response(status_code=204)
