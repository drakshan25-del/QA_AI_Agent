"""Crawl safety rules for multi-page scans (FR-UIS-015).

A scanner that follows links inside an authenticated application is one bad
link away from signing itself out or deleting a record. These are the rules
that stop it, tested without a browser.
"""

from __future__ import annotations

import pytest

from engine.uiscanner.crawl import (
    is_followable,
    normalise_url,
    page_slug,
    select_next_pages,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "url",
    [
        "https://app.test/logout",
        "https://app.test/auth/log-out",
        "https://app.test/user/signout",
        "https://app.test/sign_out",
        "https://app.test/session/end",
    ],
)
def test_sign_out_links_are_never_followed(url: str) -> None:
    followable, reason = is_followable({"url": url, "text": ""})
    assert followable is False
    assert "signs the session out" in reason


def test_sign_out_is_detected_from_the_link_text_too() -> None:
    followable, reason = is_followable(
        {"url": "https://app.test/x/y", "text": "Log Out"}
    )
    assert followable is False
    assert "signs the session out" in reason


@pytest.mark.parametrize(
    "url",
    [
        "https://app.test/users/7/delete",
        "https://app.test/token/revoke",
        "https://app.test/account/deactivate",
        "https://app.test/items?action=remove&id=3",
    ],
)
def test_destructive_links_are_never_followed(url: str) -> None:
    followable, reason = is_followable({"url": url, "text": ""})
    assert followable is False
    assert "changes or deletes data" in reason


def test_ordinary_navigation_is_followed() -> None:
    followable, reason = is_followable(
        {"url": "https://app.test/reports/monthly", "text": "Monthly reports"}
    )
    assert followable is True
    assert reason == ""


def test_urls_are_deduplicated_by_their_canonical_form() -> None:
    assert normalise_url("https://app.test/a/b/#section") == "https://app.test/a/b"
    assert normalise_url("https://app.test/a/b/") == normalise_url(
        "https://app.test/a/b"
    )
    # A different query is a different page.
    assert normalise_url("https://app.test/a?p=1") != normalise_url(
        "https://app.test/a?p=2"
    )


def test_selection_skips_visited_queued_and_unsafe_links() -> None:
    links = [
        {"url": "https://app.test/reports", "text": "Reports"},
        {"url": "https://app.test/reports/", "text": "Reports again"},  # duplicate
        {"url": "https://app.test/settings", "text": "Settings"},
        {"url": "https://app.test/logout", "text": "Log out"},
        {"url": "https://app.test/items/4/delete", "text": "Delete"},
        {"url": "https://app.test/home", "text": "Home"},  # already visited
    ]
    visited = {normalise_url("https://app.test/home")}
    queued: set[str] = set()
    accepted, skipped = select_next_pages(links, visited, queued)

    assert [a["url"] for a in accepted] == [
        "https://app.test/reports",
        "https://app.test/settings",
    ]
    assert skipped["signs the session out"] == 1
    assert skipped["looks like it changes or deletes data"] == 1


def test_queue_is_not_re_offered_the_same_page() -> None:
    links = [{"url": "https://app.test/reports", "text": "Reports"}]
    queued: set[str] = set()
    first, _ = select_next_pages(links, set(), queued)
    second, _ = select_next_pages(links, set(), queued)
    assert len(first) == 1
    assert second == []


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://app.test/web/index.php/dashboard/index", "dashboard-index"),
        ("https://app.test/reports.html", "reports-html"),
        ("https://app.test/", "home"),
        ("https://app.test/admin/viewSystemUsers", "admin-viewsystemusers"),
    ],
)
def test_page_slugs_are_stable_and_readable(url: str, expected: str) -> None:
    assert page_slug(url) == expected
