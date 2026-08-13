"""Shared server-rendered UI for the demo target app.

Extends the original minimal page shell with a navigation header, flash
kinds (success/error), summary cards, tables and zero-JS inline-SVG bar
charts, while preserving the legacy selector contract byte-for-byte:
``[data-testid=flash]`` stays the notification element on every page.

Design tokens follow the app's system-ui look; the single chart hue is the
validated sequential blue (#2a78d6) — one series per chart, so identity
lives in the axis labels, not in color.
"""

from __future__ import annotations

import html

from fastapi.responses import HTMLResponse

ACCENT = "#2a78d6"  # sequential blue, step 450 of the validated palette

_STYLE = """
    :root { --ink:#1c1917; --muted:#57534e; --line:#e7e5e4; --accent:#2a78d6;
            --ok:#1a7f37; --err:#b42318; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #fcfcfb; color: var(--ink); }
    main { max-width: __WIDTH__; margin: 1.5rem auto; padding: 0 1rem; }
    header[data-testid=nav] { display:flex; flex-wrap:wrap; gap:.35rem 1rem; align-items:center;
      padding:.6rem 1rem; border-bottom:1px solid var(--line); background:#fff; }
    header[data-testid=nav] nav { display:flex; gap:.85rem; flex-wrap:wrap; }
    header[data-testid=nav] a { color:var(--ink); text-decoration:none; }
    header[data-testid=nav] a:hover { color:var(--accent); }
    header[data-testid=nav] .spacer { flex:1; }
    header[data-testid=nav] .who { color:var(--muted); font-size:.85rem; }
    [data-testid=flash] { padding: .5rem .75rem; border: 1px solid #888; margin-bottom: 1rem;
      border-radius:.375rem; background:#fff; }
    [data-testid=flash].flash-success { border-color: var(--ok); background:#f0fdf4; }
    [data-testid=flash].flash-error { border-color: var(--err); background:#fef2f2; }
    li { margin: .25rem 0; }
    form.inline { display: inline; margin-left: .5rem; }
    input, select, textarea { font: inherit; padding:.4rem .5rem; border:1px solid #a8a29e;
      border-radius:.375rem; background:#fff; width:100%; }
    button { font: inherit; padding:.45rem .9rem; border:1px solid var(--accent);
      background:var(--accent); color:#fff; border-radius:.375rem; cursor:pointer; }
    button.danger { background:#fff; color:var(--err); border-color:var(--err); }
    button.quiet { background:#fff; color:var(--ink); border-color:#a8a29e; }
    form.inline button, form.card-form button { width:auto; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr));
      gap:.75rem; margin:1rem 0; }
    .card { border:1px solid var(--line); border-radius:.5rem; padding:.75rem 1rem; background:#fff; }
    .card .num { font-size:1.6rem; font-weight:700; }
    .card .label { color:var(--muted); font-size:.85rem; }
    .panels { display:grid; grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));
      gap:1rem; margin:1rem 0; }
    .panel { border:1px solid var(--line); border-radius:.5rem; padding:1rem; background:#fff; }
    .panel h2 { margin:.1rem 0 .75rem; font-size:1rem; }
    form.card-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));
      gap:.75rem; align-items:end; border:1px solid var(--line); border-radius:.5rem;
      padding:1rem; background:#fff; margin:1rem 0; }
    form.card-form label, .toolbar label { display:flex; flex-direction:column; gap:.25rem;
      font-size:.85rem; color:var(--muted); }
    form.card-form .form-title { grid-column:1/-1; font-weight:600; }
    form.card-form .form-actions { display:flex; gap:.5rem; align-items:center; }
    .toolbar { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:1rem 0; }
    .toolbar label { min-width:9rem; flex:1; max-width:14rem; }
    .toolbar button { align-self:end; }
    .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:.5rem; background:#fff; }
    table { border-collapse:collapse; width:100%; min-width:44rem; }
    th, td { padding:.5rem .65rem; text-align:left; border-top:1px solid var(--line); font-size:.9rem; }
    thead th { border-top:0; color:var(--muted); font-size:.78rem; text-transform:uppercase;
      letter-spacing:.04em; }
    td.actions { white-space:nowrap; }
    td.actions a { margin-right:.6rem; }
    .empty { padding:1rem; color:var(--muted); }
    .muted { color:var(--muted); }
    .pagination { display:flex; gap:.75rem; align-items:center; margin:1rem 0; flex-wrap:wrap; }
    img.thumb { width:2rem; height:2rem; object-fit:cover; border-radius:.25rem; vertical-align:middle; }
    .confirm-box { border:1px solid var(--err); border-radius:.5rem; padding:1.25rem;
      background:#fff; max-width:30rem; }
    .confirm-box .form-actions { display:flex; gap:.75rem; margin-top:1rem; }
"""

_SHELL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>{style}</style>
</head>
<body>
{header}
  <main>
  <h1>{title}</h1>
  {body}
  </main>
</body>
</html>"""

#: Nav links per audience; Feature-4 extension point: add one line per feature.
_NAV_LINKS = {
    "admin": [("/dashboard", "Dashboard"), ("/admin", "Admin users"),
              ("/products", "Products"), ("/items", "Items")],
    "user": [("/items", "Items")],
}


def render_flash(message: str | None, kind: str = "info") -> str:
    """Render the flash <div data-testid="flash"> block, or nothing."""
    if not message:
        return ""
    css = f" class=\"flash-{kind}\"" if kind in ("success", "error") else ""
    return f'<div data-testid="flash"{css}>{html.escape(message)}</div>'


def _nav(audience: str, who: str) -> str:
    links = "\n      ".join(
        f'<a href="{href}">{label}</a>' for href, label in _NAV_LINKS[audience]
    )
    return f"""  <header data-testid="nav">
    <strong>Sample App</strong>
    <nav>
      {links}
    </nav>
    <span class="spacer"></span>
    <span class="who">{html.escape(who)}</span>
    <form class="inline" method="post" action="/logout"><button type="submit" class="quiet">Log out</button></form>
  </header>"""


def page(title: str, body: str, *, nav: tuple[str, str] | None = None,
         wide: bool = False) -> HTMLResponse:
    """Assemble a full page.

    Args:
        nav: (audience, username) to show the header nav — ``("admin", email)``
            or ``("user", email)`` — or None for the anonymous login page.
        wide: use the 64rem content column (dashboard / management tables).
    """
    style = _STYLE.replace("__WIDTH__", "64rem" if wide else "40rem")
    header = _nav(*nav) if nav else ""
    return HTMLResponse(_SHELL.format(title=html.escape(title), style=style,
                                      header=header, body=body))


# --- components ------------------------------------------------------------------


def stat_card(testid: str, label: str, value) -> str:
    return (
        f'<div class="card"><div class="num" data-testid="{testid}">{html.escape(str(value))}</div>'
        f'<div class="label">{html.escape(label)}</div></div>'
    )


def empty_state(testid: str, message: str) -> str:
    return f'<div class="empty" data-testid="{testid}">{html.escape(message)}</div>'


def bar_chart(testid: str, rows: list[tuple[str, int]], unit: str = "") -> str:
    """Zero-JS horizontal bar chart as inline SVG from live store data.

    Single series: one hue (ACCENT), no legend — identity is on the row
    labels. Bars are thin with a rounded data-end; per-bar <title> gives a
    native hover tooltip; values are direct-labeled in ink, not color.
    """
    rows = [(label, count) for label, count in rows]
    if not rows or all(count == 0 for _, count in rows):
        return empty_state(f"{testid}-empty", "No data yet")

    bar_h, gap, label_w, value_w, width = 20, 10, 150, 44, 520
    plot_w = width - label_w - value_w
    max_value = max(count for _, count in rows)
    height = len(rows) * (bar_h + gap) - gap

    parts = [
        f'<svg data-testid="{testid}" role="img" viewBox="0 0 {width} {height}" '
        f'width="100%" style="max-width:{width}px;height:auto" '
        f'font-family="system-ui, sans-serif" font-size="12">'
    ]
    for i, (label, count) in enumerate(rows):
        y = i * (bar_h + gap)
        w = max(1, round(plot_w * count / max_value)) if count else 0
        text = html.escape(str(label))
        tooltip = f"{text}: {count}{html.escape(unit)}"
        parts.append(f'<g><title>{tooltip}</title>')
        parts.append(
            f'<text x="{label_w - 8}" y="{y + bar_h - 6}" text-anchor="end" fill="#57534e">{text}</text>'
        )
        if w > 6:
            r = 4
            parts.append(
                f'<path d="M{label_w} {y} h{w - r} a{r} {r} 0 0 1 {r} {r} v{bar_h - 2 * r} '
                f'a{r} {r} 0 0 1 -{r} {r} h-{w - r} z" fill="{ACCENT}"/>'
            )
        elif w:
            parts.append(f'<rect x="{label_w}" y="{y}" width="{w}" height="{bar_h}" fill="{ACCENT}"/>')
        parts.append(
            f'<text x="{label_w + w + 6}" y="{y + bar_h - 6}" fill="#1c1917">{count}</text>'
        )
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)
