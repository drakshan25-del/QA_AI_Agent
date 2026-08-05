"""SSRF protection for user-supplied scan targets (FR-UIS-023, SEC-003).

The engine opens URLs a user typed, from inside the trusted network, so these
rules are the difference between a scanner and a confused deputy.
"""

from __future__ import annotations

import pytest

from engine.uiscanner.url_guard import (
    BlockedUrlError,
    _host_allowed,
    _normalise_allowlist,
    assert_url_allowed,
    is_url_allowed,
    resolve_addresses,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "data:text/html,<h1>hi</h1>",
        "javascript:alert(1)",
        "ftp://example.com/file",
        "blob:https://example.com/abc",
    ],
)
def test_non_http_schemes_are_refused(url: str) -> None:
    with pytest.raises(BlockedUrlError, match="scheme"):
        assert_url_allowed(url)


def test_empty_url_is_refused() -> None:
    with pytest.raises(BlockedUrlError, match="required"):
        assert_url_allowed("")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8000/",
        "http://localhost:3000/app",
        "http://10.0.0.5/admin",
        "http://192.168.1.10/",
        "http://172.16.4.4/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0:8080/",
        "http://100.64.0.1/",
        "http://[::1]:9000/",
    ],
)
def test_internal_addresses_are_refused_by_default(url: str) -> None:
    with pytest.raises(BlockedUrlError):
        assert_url_allowed(url)


def test_cloud_metadata_address_is_refused_even_when_private_is_allowed() -> None:
    with pytest.raises(BlockedUrlError, match="metadata"):
        assert_url_allowed(
            "http://169.254.169.254/latest/meta-data/", allow_private_network=True
        )


def test_cloud_metadata_hostname_is_refused() -> None:
    with pytest.raises(BlockedUrlError, match="metadata"):
        assert_url_allowed("http://metadata.google.internal/computeMetadata/v1/")


def test_allow_list_re_enables_a_named_internal_host() -> None:
    assert (
        assert_url_allowed("http://localhost:5173/login", allowed_hosts=["localhost"])
        == "http://localhost:5173/login"
    )


def test_allow_list_matches_subdomains_and_nothing_else() -> None:
    allowlist = _normalise_allowlist(["*.internal.test", "localhost"])
    assert _host_allowed("app.internal.test", allowlist) is True
    assert _host_allowed("internal.test", allowlist) is True
    assert _host_allowed("localhost", allowlist) is True
    # A host that merely *ends with* the same characters must not match.
    assert _host_allowed("evil-internal.test", allowlist) is False
    assert _host_allowed("internal.test.attacker.com", allowlist) is False


def test_development_escape_hatch_allows_loopback() -> None:
    assert (
        assert_url_allowed("http://127.0.0.1:8000/", allow_private_network=True)
        == "http://127.0.0.1:8000/"
    )


def test_unresolvable_host_reports_dns_failure() -> None:
    with pytest.raises(BlockedUrlError, match="DNS resolution failed"):
        assert_url_allowed("http://this-host-does-not-exist.invalid/")


def test_ip_literals_resolve_to_themselves_without_dns() -> None:
    assert resolve_addresses("203.0.113.7") == ["203.0.113.7"]


def test_boolean_form_never_raises() -> None:
    assert is_url_allowed("file:///etc/passwd") is False
    assert is_url_allowed("http://127.0.0.1/", allow_private_network=True) is True
