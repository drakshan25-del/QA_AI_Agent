"""Fetch and distill the target app's pages for generation grounding (FR-AUT-003).

UI automation generation used to invent locators from test-case wording — a
"submit" button that is really labelled "Log in", an "email" field the page
calls "Username" — and every guess became a 30-second ``Locator`` timeout at
execution time (AIQA-EXEC-004). This module gives the Automation Agent the
same ground truth the API pipeline already enjoys via its documented API
surface: a compact, authoritative inventory of the real page.

Everything here is fail-open by design: the target app being down, a page
404ing, or HTML the distiller cannot make sense of must never block
generation — the prompt then carries an explicit "structure unavailable"
sentinel instead, and the locator gate skips what it cannot verify.

Only stdlib + httpx (an existing dependency) are used; fetches are bounded
(size, timeout, page count) and locked to the ``base_url`` origin — candidate
paths are derived from untrusted test-case text and must never redirect the
fetch to another host (SEC-003).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Upper bounds keeping the snapshot cheap and the prompt small.
MAX_PAGES = 6
MAX_HTML_BYTES = 200_000
FETCH_TIMEOUT_SECONDS = 3.0
MAX_LINES_PER_PAGE = 40

#: Absolute-path tokens inside test-case text ("/login", "/admin/users").
_PATH_TOKEN_RE = re.compile(r"(?<![\w.:])(/[a-zA-Z][a-zA-Z0-9_\-/]*)")

#: Extensions that are clearly not HTML pages worth fetching.
_NON_PAGE_SUFFIXES = (".js", ".css", ".png", ".jpg", ".svg", ".ico", ".json", ".xml")


@dataclass
class PageInventory:
    """Distilled accessible surface of one fetched page.

    ``redirected_to`` marks a page that could not be observed because the
    unauthenticated fetch was redirected elsewhere (an auth-gated page
    bouncing to /login). Its inventory is empty and must not be treated as
    the page's real structure — the locator gate skips it, and the prompt
    rendering says so instead of showing the redirect target's form.
    """

    redirected_to: str = ""
    requires_login: bool = False  # observed via an authenticated session
    inputs: list[dict] = field(default_factory=list)  # label/placeholder/testid/type/name
    buttons: list[str] = field(default_factory=list)  # visible text (accessible name)
    links: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    testids: list[str] = field(default_factory=list)  # every data-testid on the page
    roles: list[str] = field(default_factory=list)  # explicit role="..." attributes
    selects: list[dict] = field(default_factory=list)
    forms: list[str] = field(default_factory=list)  # "METHOD action"

    def element_kind(self, locator_kind: str, arg: str, kwargs: dict) -> dict | None:
        """Resolve a literal locator to its element descriptor, or ``None``.

        Matching mirrors Playwright semantics loosely (non-exact = case-
        insensitive substring; ``exact=True`` = equality). Descriptors carry
        ``kind`` (``input`` / ``select`` / ``textarea`` / ``button`` /
        ``link`` / ``heading`` / ``other``) plus the element's recorded
        attributes, so gates can judge both existence AND how the element
        may be interacted with.
        """
        def hit(text: str) -> bool:
            if not text:
                return False
            if kwargs.get("exact"):
                return arg == text
            return arg.lower() in text.lower()

        if locator_kind == "testid":
            for i in self.inputs:
                if i.get("testid") == arg:
                    return {"kind": "input", **i}
            for s in self.selects:
                if s.get("testid") == arg:
                    return {"kind": s.get("tag", "select"), **s}
            if arg in self.testids:
                return {"kind": "other"}
            return None
        if locator_kind == "label":
            for i in self.inputs:
                if hit(i.get("label", "")):
                    return {"kind": "input", **i}
            for s in self.selects:
                if hit(s.get("label", "")):
                    return {"kind": s.get("tag", "select"), **s}
            return None
        if locator_kind == "placeholder":
            for i in self.inputs:
                if hit(i.get("placeholder", "")):
                    return {"kind": "input", **i}
            return None
        # role
        source = {"button": self.buttons, "link": self.links, "heading": self.headings}.get(arg)
        name = kwargs.get("name")
        if source is not None:
            if isinstance(name, str):
                low = name.lower()
                for text in source:
                    if (name == text) if kwargs.get("exact") else (low in text.lower()):
                        return {"kind": arg, "text": text}
                return None
            return {"kind": arg} if source else None
        return {"kind": "other"} if arg in self.roles else None

    def describe(self) -> str:
        """One-line inventory used in locator-gate error messages."""
        parts: list[str] = []
        if self.inputs:
            parts.append(
                "inputs: "
                + ", ".join(
                    " ".join(
                        bit
                        for bit in (
                            f'label "{i["label"]}"' if i.get("label") else "",
                            f'placeholder "{i["placeholder"]}"' if i.get("placeholder") else "",
                            f'(testid={i["testid"]})' if i.get("testid") else "",
                        )
                        if bit
                    )
                    or f'name={i.get("name", "?")}'
                    for i in self.inputs
                )
            )
        if self.buttons:
            parts.append("buttons: " + ", ".join(f'"{b}"' for b in self.buttons))
        if self.testids:
            parts.append("testids: " + ", ".join(self.testids))
        if self.roles:
            parts.append("explicit roles: " + ", ".join(self.roles))
        return "; ".join(parts) or "(no interactive elements found)"

    def render(self) -> list[str]:
        """Prompt-facing block body (without the '## Page' header)."""
        if self.redirected_to:
            return [
                f"  (not observable without a session — redirects to "
                f"{self.redirected_to} when unauthenticated; reuse existing "
                f"page objects or assert on the URL, do not guess locators)"
            ]
        lines: list[str] = []
        if self.forms or self.inputs or self.selects or self.buttons:
            lines.append("form:")
            for i in self.inputs:
                bits = ["  input "]
                if i.get("label"):
                    bits.append(f'label="{i["label"]}"')
                if i.get("placeholder"):
                    bits.append(f'placeholder="{i["placeholder"]}"')
                if i.get("testid"):
                    bits.append(f'testid={i["testid"]}')
                if i.get("type") and i["type"] not in ("text",):
                    bits.append(f'type={i["type"]}')
                if not i.get("label") and not i.get("placeholder") and i.get("name"):
                    bits.append(f'name={i["name"]}')
                if i.get("required"):
                    bits.append("required")
                if i.get("min"):
                    bits.append(f'min={i["min"]}')
                if i.get("datalist"):
                    bits.append(
                        "(autocomplete suggestions — a TEXT INPUT: use fill(), NOT select())"
                    )
                lines.append(" ".join(bits))
            for s in self.selects:
                bits = ["  " + s.get("tag", "select")]
                if s.get("label"):
                    bits.append(f'label="{s["label"]}"')
                if s.get("testid"):
                    bits.append(f'testid={s["testid"]}')
                if s.get("options"):
                    bits.append("options: " + ", ".join(s["options"]))
                lines.append(" ".join(bits))
            for b in self.buttons:
                lines.append(f'  button "{b}"')
        other: list[str] = []
        for h in self.headings:
            other.append(f'  heading "{h}"')
        for t in self.testids:
            if not any(i.get("testid") == t for i in self.inputs + self.selects):
                other.append(f"  element testid={t}")
        for r in self.roles:
            other.append(f"  element role={r}")
        for a in self.links[:10]:
            other.append(f'  link "{a}"')
        if other:
            lines.append("other:")
            lines.extend(other)
        return lines[:MAX_LINES_PER_PAGE]


class _Distiller(HTMLParser):
    """Single-pass HTML walker collecting the accessible-element inventory."""

    _TEXT_CAPTURE = {"button", "a", "label", "h1", "h2", "h3", "h4", "h5", "h6", "option"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.inv = PageInventory()
        self._stack: list[tuple[str, dict, list[str]]] = []  # (tag, attrs, text parts)
        self._label_for: dict[str, str] = {}  # input id -> label text
        self._pending_inputs: list[dict] = []  # inputs awaiting a for= label
        self._open_select: dict | None = None  # select entry collecting options
        self._pending_option_value: str | None = None

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict:
        return {k: (v or "") for k, v in attrs}

    def _open_label_text(self) -> str:
        for tag, _, parts in reversed(self._stack):
            if tag == "label":
                return " ".join(" ".join(parts).split())
        return ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = self._attrs(attrs)
        testid = a.get("data-testid", "")
        if testid and testid not in self.inv.testids:
            self.inv.testids.append(testid)
        role = a.get("role", "")
        if role and role not in self.inv.roles:
            self.inv.roles.append(role)

        if tag == "form":
            self.inv.forms.append(f'{a.get("method", "get").upper()} {a.get("action", "")}'.strip())
        elif tag == "input":
            input_type = a.get("type", "text").lower()
            if input_type in ("submit", "button"):
                text = a.get("value", "") or "Submit"
                if text not in self.inv.buttons:
                    self.inv.buttons.append(text)
            elif input_type != "hidden":
                entry = {
                    "label": self._open_label_text(),
                    "placeholder": a.get("placeholder", ""),
                    "testid": testid,
                    "type": input_type,
                    "name": a.get("name", ""),
                    "id": a.get("id", ""),
                    "datalist": bool(a.get("list")),
                    "required": "required" in a,
                    "min": a.get("min", ""),
                    "max": a.get("max", ""),
                }
                self.inv.inputs.append(entry)
                if not entry["label"] and entry["id"]:
                    self._pending_inputs.append(entry)
        elif tag in ("select", "textarea"):
            entry = {
                "label": self._open_label_text(),
                "testid": testid,
                "name": a.get("name", ""),
                "tag": tag,
                "options": [],
            }
            self.inv.selects.append(entry)
            if tag == "select":
                self._open_select = entry
        elif tag == "option" and self._open_select is not None:
            self._pending_option_value = a.get("value")

        if tag in self._TEXT_CAPTURE:
            self._stack.append((tag, a, []))

    def handle_data(self, data: str) -> None:
        for _, _, parts in self._stack:
            parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "select":
            self._open_select = None
            return
        if not self._stack or self._stack[-1][0] != tag:
            return
        _, a, parts = self._stack.pop()
        text = " ".join(" ".join(parts).split())
        if tag == "option":
            if self._open_select is not None and len(self._open_select["options"]) < 12:
                value = self._pending_option_value
                value = value if value not in (None, "") else text
                if value and value not in self._open_select["options"]:
                    self._open_select["options"].append(value)
            self._pending_option_value = None
            return
        if tag == "button":
            if text and text not in self.inv.buttons:
                self.inv.buttons.append(text)
        elif tag == "a":
            if text and text not in self.inv.links:
                self.inv.links.append(text)
        elif tag.startswith("h") and text:
            if text not in self.inv.headings:
                self.inv.headings.append(text)
        elif tag == "label":
            target = a.get("for", "")
            if target and text:
                self._label_for[target] = text

    def close(self) -> None:  # resolve <label for=...> associations
        super().close()
        for entry in self._pending_inputs:
            if entry["id"] in self._label_for:
                entry["label"] = self._label_for[entry["id"]]


def distill(html: str) -> PageInventory:
    """Distill raw HTML into a :class:`PageInventory`; never raises."""
    parser = _Distiller()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed HTML must not break generation
        logger.warning("page distillation failed; continuing without this page")
    return parser.inv


def candidate_paths(test_cases: list[dict], page_object_paths: list[str]) -> list[str]:
    """Paths worth snapshotting: known page-object paths, paths quoted in the
    test cases, and the root. Deduped, order-preserving, capped."""
    seen: list[str] = []

    def add(path: str) -> None:
        path = "/" + path.strip().lstrip("/")
        path = path.rstrip("/") or "/"
        if path.lower().endswith(_NON_PAGE_SUFFIXES):
            return
        if path not in seen:
            seen.append(path)

    for p in page_object_paths:
        if p:
            add(p)
    import json as _json

    blob = _json.dumps(test_cases, default=str)
    for match in _PATH_TOKEN_RE.findall(blob):
        add(match)
    add("/")
    return seen[:MAX_PAGES]


@dataclass
class PageSnapshot:
    """Everything one snapshot pass learned about the target app.

    ``statuses`` records a liveness verdict per probed path — ``"ok"``
    (observed directly), ``"auth"`` (requires a login session; the inventory
    is either the authenticated page or a redirect note), ``"missing"``
    (404/405/410 — the path does not exist), ``"error"`` (fetch failed) —
    so gates can distinguish "page not observable" from "page not real".
    """

    structures: dict[str, PageInventory] = field(default_factory=dict)
    statuses: dict[str, str] = field(default_factory=dict)
    base_url: str = ""


def _login_fields(inv: PageInventory) -> tuple[str, str] | None:
    """Derive (username_field, password_field) from a login form's inputs."""
    password = next((i for i in inv.inputs if i.get("type") == "password" and i.get("name")), None)
    username = next(
        (i for i in inv.inputs if i.get("type") != "password" and i.get("name")), None
    )
    if password and username:
        return username["name"], password["name"]
    return None


def _try_authenticate(client, base_url: str, login_path: str, login_inv: PageInventory) -> bool:
    """Log into the target with the same credentials the tests use.

    Field names come from the login form's own markup; credentials from the
    env vars the ``credentials`` fixture reads (same defaults as
    ``automation/conftest.py``). Cookies persist on ``client``. Never raises.
    """
    import os

    fields = _login_fields(login_inv)
    if not fields:
        return False
    username_field, password_field = fields
    payload = {
        username_field: os.environ.get("QA_TEST_USERNAME", "demo@example.com"),
        password_field: os.environ.get("QA_TEST_PASSWORD", "change-me"),
    }
    try:
        url = urljoin(base_url.rstrip("/") + "/", login_path.lstrip("/"))
        response = client.post(url, data=payload)
        return response.status_code < 400
    except Exception:  # noqa: BLE001
        return False


def collect_page_structures(base_url: str, paths: list[str]) -> PageSnapshot:
    """Fetch and distill each candidate page; fail-open on any error.

    Fetches are same-origin only: a candidate path is joined onto ``base_url``
    and dropped unless the resulting URL stays on ``base_url``'s host — paths
    come from untrusted test-case text (SEC-003).

    Pages that redirect to a login page are retried once through an
    authenticated session (the app's own login form, test credentials), so
    auth-gated pages get real inventories marked ``requires_login`` instead
    of a blind "not observable" note.
    """
    snapshot = PageSnapshot(base_url=base_url)
    if not base_url:
        return snapshot
    import httpx

    origin = urlsplit(base_url)

    def fetch(client, path: str):
        url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
        target = urlsplit(url)
        if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
            return None
        return client.get(url)

    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            auth_gated: list[str] = []
            for path in paths:
                try:
                    response = fetch(client, path)
                except httpx.HTTPError:
                    snapshot.statuses[path] = "error"
                    continue
                if response is None:
                    continue  # cross-origin candidate: silently dropped
                if response.status_code in (404, 405, 410):
                    snapshot.statuses[path] = "missing"
                    continue
                content_type = response.headers.get("content-type", "")
                if response.status_code >= 300 or "html" not in content_type:
                    snapshot.statuses[path] = "error"
                    continue
                final_path = urlsplit(str(response.url)).path.rstrip("/") or "/"
                if response.history and final_path != path:
                    # Auth-gated page bounced elsewhere: the body we hold is
                    # the redirect target's, not this page's — retried below
                    # through an authenticated session.
                    snapshot.structures[path] = PageInventory(redirected_to=final_path)
                    snapshot.statuses[path] = "auth"
                    auth_gated.append(path)
                    continue
                snapshot.structures[path] = distill(response.text[:MAX_HTML_BYTES])
                snapshot.statuses[path] = "ok"

            if auth_gated:
                login_path = snapshot.structures[auth_gated[0]].redirected_to
                login_inv = snapshot.structures.get(login_path)
                if login_inv is None:
                    try:
                        response = fetch(client, login_path)
                        if response is not None and response.status_code < 300:
                            login_inv = distill(response.text[:MAX_HTML_BYTES])
                    except httpx.HTTPError:
                        login_inv = None
                if login_inv and _try_authenticate(client, base_url, login_path, login_inv):
                    for path in auth_gated:
                        try:
                            response = fetch(client, path)
                        except httpx.HTTPError:
                            continue
                        if response is None or response.status_code >= 300:
                            continue
                        final_path = urlsplit(str(response.url)).path.rstrip("/") or "/"
                        if final_path != path:
                            continue  # still bounced: keep the redirect note
                        inv = distill(response.text[:MAX_HTML_BYTES])
                        inv.requires_login = True
                        snapshot.structures[path] = inv
    except Exception:  # noqa: BLE001 - grounding is best-effort, never fatal
        logger.warning("page-structure collection failed; generating ungrounded")
    return snapshot


def probe_path(base_url: str, path: str) -> str:
    """Classify one path on demand: ``ok`` / ``auth`` / ``missing`` / ``error``.

    Used by the path-existence gate for page-object paths that were not in
    the original candidate set. Same-origin only; never raises.
    """
    if not base_url:
        return "error"
    import httpx

    origin = urlsplit(base_url)
    url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    target = urlsplit(url)
    if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
        return "error"
    try:
        response = httpx.get(url, timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True)
    except Exception:  # noqa: BLE001
        return "error"
    if response.status_code in (404, 405, 410):
        return "missing"
    if response.status_code >= 400:
        return "error"
    final_path = urlsplit(str(response.url)).path.rstrip("/") or "/"
    return "auth" if (response.history and final_path != path) else "ok"


#: Sentinel injected into the prompt when no page could be fetched.
STRUCTURE_UNAVAILABLE = (
    "(page structure unavailable — target app unreachable at generation time; "
    "reuse existing page objects, do not guess new locators)"
)


def render_structures(snapshot: "PageSnapshot | dict[str, PageInventory]") -> str:
    """Prompt-facing rendering of every fetched page, or the sentinel."""
    structures = snapshot.structures if isinstance(snapshot, PageSnapshot) else snapshot
    if not structures:
        return STRUCTURE_UNAVAILABLE
    blocks: list[str] = []
    for path, inv in structures.items():
        if inv.requires_login:
            blocks.append(
                f"## Page {path} (REQUIRES LOGIN — authenticate via the login "
                "page object before visiting)"
            )
        else:
            blocks.append(f"## Page {path}")
        blocks.extend(inv.render())
    return "\n".join(blocks)
