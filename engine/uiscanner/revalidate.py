"""Re-validate stored locators against the live page (§11 "Test locator", §26).

This is the short-lived counterpart of a full scan: it opens the page, rebuilds
each supplied locator from its machine-readable description and reports what it
matched. Nothing is generated, scored or stored here — it exists so that
"Test locator", "Revalidate" and any future self-healing check get their verdict
from the real application rather than from a remembered one.

The same guarantees as a scan apply: the URL passes the SSRF guard, credentials
are used once and never logged, and the browser is closed in a ``finally``.
"""

from __future__ import annotations

from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

from engine.uiscanner.locator_validator import build_locator
from engine.uiscanner.types import ScanOptions, UiScanError
from engine.uiscanner.url_guard import BlockedUrlError, assert_url_allowed

#: Matches inspected per locator; beyond this the verdict is already "many".
_INSPECT_LIMIT = 20

_PROBE_JS = r"""
(elements, limit) => {
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  return {
    total: elements.length,
    matches: elements.slice(0, limit).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      visible: isVisible(el),
      enabled: !(el.disabled === true || el.getAttribute('aria-disabled') === 'true'),
    })),
  };
}
"""


def revalidate_locators(
    options: ScanOptions, locators: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Probe each ``{id, locatorData}`` against ``options.url``.

    Returns one verdict per input locator, in the same order. A locator that
    cannot be rebuilt is reported as invalid with its reason rather than
    aborting the whole request.
    """
    try:
        assert_url_allowed(
            options.url, options.allowed_hosts, options.allow_private_network
        )
    except BlockedUrlError as exc:
        raise UiScanError(
            "UI_SCAN_URL_BLOCKED", exc.reason, stage="NAVIGATING", recoverable=False
        ) from None

    results: list[dict[str, Any]] = []
    with sync_playwright() as playwright:
        engine = getattr(playwright, options.browser, None)
        if engine is None:
            raise UiScanError(
                "UI_SCAN_BROWSER_UNSUPPORTED",
                f"Browser '{options.browser}' is not supported.",
                recoverable=False,
            )
        browser = engine.launch(headless=True)
        context = None
        try:
            context = browser.new_context(storage_state=options.storage_state or None)
            context.set_default_timeout(min(options.timeout_ms, 30_000))
            page = context.new_page()
            try:
                page.goto(
                    options.login_url or options.url,
                    wait_until="domcontentloaded",
                    timeout=options.timeout_ms,
                )
            except PlaywrightTimeout:
                raise UiScanError(
                    "UI_SCAN_NAVIGATION_TIMEOUT",
                    "The page did not load within the configured timeout.",
                    stage="NAVIGATING",
                ) from None
            except PlaywrightError as exc:
                # A refused connection, a DNS failure or a dead host is an
                # ordinary outcome when re-validating a locator months after
                # the scan — it deserves the structured envelope the caller
                # already knows how to read, not a 500 (§18).
                raise UiScanError(
                    "UI_SCAN_NAVIGATION_FAILED",
                    f"The page could not be opened: {str(exc).splitlines()[0]}",
                    stage="NAVIGATING",
                ) from None

            if options.username and options.password:
                _sign_in(page, options)
                if options.login_url and options.url != options.login_url:
                    assert_url_allowed(
                        options.url,
                        options.allowed_hosts,
                        options.allow_private_network,
                    )
                    page.goto(
                        options.url,
                        wait_until="domcontentloaded",
                        timeout=options.timeout_ms,
                    )

            for entry in locators:
                results.append(_probe(page, entry))
        finally:
            # Cleanup runs on every path, including a raised UiScanError (§24).
            for closer in (context, browser):
                if closer is None:
                    continue
                try:
                    closer.close()
                except PlaywrightError:
                    pass
    return results


def _probe(page: Any, entry: dict[str, Any]) -> dict[str, Any]:
    locator_id = str(entry.get("id", ""))
    verdict: dict[str, Any] = {
        "id": locator_id,
        "matchCount": 0,
        "unique": False,
        "valid": False,
        "visible": False,
        "enabled": False,
        "error": "",
    }
    data = entry.get("locatorData")
    if not isinstance(data, dict):
        verdict["error"] = "the locator has no machine-readable description"
        return verdict
    try:
        locator = build_locator(page, data)
        probe = locator.evaluate_all(_PROBE_JS, _INSPECT_LIMIT)
    except (PlaywrightError, ValueError) as exc:
        verdict["error"] = f"the locator could not be evaluated: {exc}"
        return verdict

    total = int(probe.get("total", 0))
    matches = probe.get("matches", [])
    first = matches[0] if matches else {}
    verdict["matchCount"] = total
    verdict["unique"] = total == 1
    verdict["valid"] = total >= 1
    verdict["visible"] = bool(first.get("visible", False))
    verdict["enabled"] = bool(first.get("enabled", False))
    if total == 0:
        verdict["error"] = "matched no elements on the page"
    elif total > 1:
        verdict["error"] = f"matched {total} elements; the locator is not unique"
    return verdict


def _sign_in(page: Any, options: ScanOptions) -> None:
    """Minimal login for a revalidation pass; credentials are never logged."""
    password = page.locator('input[type="password"]').first
    if password.count() == 0:
        raise UiScanError(
            "UI_SCAN_AUTH_NO_FORM",
            "No login form was found on the page — check the login URL.",
            stage="AUTHENTICATING",
        )
    for selector in (
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[name*="user" i]',
        'input[name*="email" i]',
        'input[type="text"]',
    ):
        field = page.locator(selector).first
        if field.count() > 0 and field.is_visible():
            field.fill(options.username)
            break
    else:
        raise UiScanError(
            "UI_SCAN_AUTH_NO_FORM",
            "The login form has no username or email field the scanner could use.",
            stage="AUTHENTICATING",
        )
    password.fill(options.password)
    submit = page.locator('button[type="submit"], input[type="submit"]').first
    if submit.count() > 0:
        submit.click()
    else:
        password.press("Enter")
    page.wait_for_load_state("domcontentloaded", timeout=options.timeout_ms)
    if page.locator('input[type="password"]').count() > 0:
        raise UiScanError(
            "UI_SCAN_AUTH_FAILED",
            "Sign-in did not succeed: the application is still showing the login form.",
            stage="AUTHENTICATING",
        )
