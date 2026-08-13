"""Admin dashboard: HTML page + JSON summary API (Feature 1).

Every number on the page is computed from the live in-memory stores at
request time — nothing is hard-coded, and any product/admin change is
reflected on the next render. Both surfaces are restricted to active
admin sessions.
"""

from __future__ import annotations

import html

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from sample_app import store, ui

router = APIRouter()


def _recent_admins_html(recent: list[dict]) -> str:
    if not recent:
        return ui.empty_state("recent-admins-empty", "No admin users yet")
    rows = "".join(
        f'<li data-testid="recent-admin">{html.escape(a["name"])} '
        f'<span class="muted">({html.escape(a["email"])} · {html.escape(a["role"])})</span></li>'
        for a in recent
    )
    return f'<ul data-testid="recent-admins">{rows}</ul>'


def _recent_products_html(recent: list[dict]) -> str:
    if not recent:
        return ui.empty_state("recent-products-empty", "No products yet")
    rows = "".join(
        f'<li data-testid="recent-product">{html.escape(p["name"])} '
        f'<span class="muted">({html.escape(p["category"])} · ${p["price"]:,.2f})</span></li>'
        for p in recent
    )
    return f'<ul data-testid="recent-products">{rows}</ul>'


@router.get("/dashboard", response_class=HTMLResponse, response_model=None)
def dashboard_page(request: Request) -> HTMLResponse | RedirectResponse:
    """Admin landing page: summary cards, recent records and charts."""
    guard = store.admin_guard_html(request)
    if guard is not None:
        return guard
    admin = store.session_admin(request)
    token = store.current_session(request)
    message, kind = store.pop_flash(token)
    summary = store.dashboard_summary()

    cards = "".join([
        ui.stat_card("stat-total-admins", "Admin users", summary["admins"]["total"]),
        ui.stat_card("stat-active-admins", "Active admins", summary["admins"]["active"]),
        ui.stat_card("stat-total-products", "Products", summary["products"]["total"]),
        ui.stat_card("stat-stock-units", "Units in stock", summary["products"]["stock_units"]),
        ui.stat_card("stat-inventory-value", "Inventory value",
                     f"${summary['products']['inventory_value']:,.2f}"),
    ])

    body = f"""{ui.render_flash(message, kind)}
  <div class="cards">{cards}</div>
  <div class="panels">
    <section class="panel">
      <h2>Products by category</h2>
      {ui.bar_chart("chart-products-by-category", sorted(summary["products"]["by_category"].items()))}
    </section>
    <section class="panel">
      <h2>Admin users by role</h2>
      {ui.bar_chart("chart-admins-by-role", sorted(summary["admins"]["by_role"].items()))}
    </section>
    <section class="panel">
      <h2>Recently added admins</h2>
      {_recent_admins_html(summary["admins"]["recent"])}
    </section>
    <section class="panel">
      <h2>Recently added products</h2>
      {_recent_products_html(summary["products"]["recent"])}
    </section>
  </div>"""
    return ui.page("Dashboard", body, nav=("admin", admin["email"]), wide=True)


@router.get("/api/dashboard/summary")
def api_dashboard_summary(request: Request) -> JSONResponse:
    """Live dashboard aggregates; 401 unauthenticated, 403 non-admin."""
    guard = store.admin_guard_api(request)
    if guard is not None:
        return guard
    return JSONResponse(store.dashboard_summary())
