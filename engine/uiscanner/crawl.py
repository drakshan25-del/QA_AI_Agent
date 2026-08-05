"""In-application link discovery for multi-page scans (§15).

Scanning one page tells you about one page. Most of an application's testable
surface is behind its navigation, so the scanner follows in-app links and scans
what it finds — but a browser that wanders an authenticated application under a
user's own session is a liability unless it is firmly fenced in.

The fences, in order of importance:

* **never sign itself out** — a logout link ends the session and every
  remaining page becomes the login screen;
* **never take a destructive action** — links whose URL or text reads as
  delete/remove/revoke are skipped, because a GET that mutates is a real (if
  unfortunate) pattern in older applications;
* **never leave the application** — different origin, `mailto:`, `tel:`,
  `javascript:`, downloads and new-tab targets are all out of scope;
* **never revisit** — URLs are normalised (fragment dropped) and de-duplicated,
  so a nav bar repeated on every page does not loop the crawl.

Everything skipped is reported, so a crawl that covers less than expected says
why rather than looking complete.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

#: Links that end the session. Following one turns the rest of a crawl into
#: repeated scans of the login page.
LOGOUT_PATTERN = re.compile(
    # The separator matters: link *text* reads "Log Out" or "Sign out" far more
    # often than the URL-shaped "logout", and missing it ends the session.
    r"log[\s\-_]?out|sign[\s\-_]?out|/logoff|/exit\b|session/end",
    re.IGNORECASE,
)

#: Links whose target reads as a mutation. A GET should never change state, but
#: plenty of applications disagree, and a scanner must not be the thing that
#: finds out.
DESTRUCTIVE_PATTERN = re.compile(
    r"\b(delete|destroy|remove|revoke|deactivate|terminate|purge|reset|cancel)\b",
    re.IGNORECASE,
)

#: Collects same-origin anchor targets. Pure DOM reads; no navigation.
DISCOVER_LINKS_JS = r"""
() => {
  const origin = document.location.origin;
  const out = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const raw = anchor.getAttribute('href') || '';
    if (!raw || raw.startsWith('#')) continue;
    if (anchor.hasAttribute('download')) continue;
    if ((anchor.getAttribute('target') || '') === '_blank') continue;
    let url;
    try { url = new URL(raw, document.baseURI); } catch (_) { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.origin !== origin) continue;
    url.hash = '';
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({
      url: href,
      text: (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      label: anchor.getAttribute('aria-label') || '',
    });
  }
  return out;
}
"""


def normalise_url(url: str) -> str:
    """Canonical form used for de-duplication: no fragment, no trailing slash."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


def is_followable(link: dict[str, Any]) -> tuple[bool, str]:
    """Decide whether a discovered link may be visited.

    Returns ``(followable, reason_when_not)`` so the caller can report what it
    chose not to open rather than silently covering less of the application.
    """
    url = str(link.get("url") or "")
    text = f"{link.get('text', '')} {link.get('label', '')}"
    if not url:
        return False, "empty target"
    if LOGOUT_PATTERN.search(url) or LOGOUT_PATTERN.search(text):
        return False, "signs the session out"
    if DESTRUCTIVE_PATTERN.search(url) or DESTRUCTIVE_PATTERN.search(text):
        return False, "looks like it changes or deletes data"
    return True, ""


def select_next_pages(
    links: list[dict[str, Any]],
    visited: set[str],
    queued: set[str],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Filter discovered links down to the ones worth visiting next.

    Returns the followable links plus a tally of why others were skipped, for
    the scan log.
    """
    accepted: list[dict[str, Any]] = []
    skipped: dict[str, int] = {}
    for link in links:
        followable, reason = is_followable(link)
        if not followable:
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        key = normalise_url(link["url"])
        if key in visited or key in queued:
            continue
        queued.add(key)
        accepted.append({**link, "normalised": key})
    return accepted, skipped


def page_slug(url: str) -> str:
    """Short, stable, human-readable identifier for a page within a scan.

    Derived from the URL path so the same page keeps the same slug between
    scans — which is what lets a locator approved today still match tomorrow.
    """
    try:
        path = urlsplit(url).path
    except ValueError:
        path = url
    # Drop framework noise that carries no meaning ("/web/index.php/...").
    segments = [
        seg
        for seg in path.split("/")
        if seg and seg not in {"web", "index.php", "index.html", "app"}
    ]
    slug = "-".join(segments[-2:]) if segments else "home"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", slug).strip("-").lower()
    return slug[:40] or "home"
