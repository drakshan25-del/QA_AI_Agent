"""SSRF protection for user-supplied scan targets (§23, SEC-003).

The UI Scanner opens URLs chosen by an authenticated user, so the engine is a
confused-deputy risk: it sits inside the trusted network and can reach hosts a
browser on the user's laptop cannot. Every navigation — the initial target, the
login page and every redirect hop — is checked here before Playwright is
allowed to continue.

Rules:

* only ``http`` and ``https`` — ``file:``, ``data:``, ``javascript:``,
  ``blob:``, ``ftp:`` and friends are refused outright;
* the hostname is resolved and **every** returned address is checked, so a DNS
  entry that answers with one public and one private address is still refused;
* loopback, private, link-local, unique-local, multicast, reserved and
  carrier-grade-NAT ranges are refused, as are the cloud metadata endpoints;
* a configurable allow-list re-enables specific hosts for local development
  (the project's ``allowedDomains`` field feeds it), and the backend may pass
  ``allow_private_network`` for a fully local setup.

The check is deliberately duplicated on the backend (``url-safety.ts``) so a
direct engine call can never bypass it either.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

ALLOWED_SCHEMES = frozenset({"http", "https"})

#: Hostnames that resolve to instance credentials on the major clouds.
BLOCKED_HOSTNAMES = frozenset(
    {
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
        "metadata",
    }
)

#: Literal addresses that serve cloud metadata regardless of hostname.
BLOCKED_ADDRESSES = frozenset(
    {
        "169.254.169.254",  # AWS / Azure / GCP / DO IMDS
        "169.254.170.2",  # AWS ECS task metadata
        "100.100.100.200",  # Alibaba Cloud
        "fd00:ec2::254",  # AWS IMDSv6
    }
)


class BlockedUrlError(ValueError):
    """Raised when a URL must not be opened by the engine."""

    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"{reason}")
        self.url = url
        self.reason = reason


def _normalise_allowlist(allowed_hosts: list[str] | None) -> set[str]:
    return {
        h.strip().lower().lstrip("*.")
        for h in (allowed_hosts or [])
        if h and h.strip()
    }


def _host_allowed(host: str, allowlist: set[str]) -> bool:
    """True when ``host`` matches an allow-list entry exactly or as a suffix."""
    host = host.lower()
    return any(host == entry or host.endswith("." + entry) for entry in allowlist)


def _address_is_private(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        # Not an IP literal: the caller resolves names before reaching here.
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


def resolve_addresses(host: str) -> list[str]:
    """Resolve ``host`` to every A/AAAA address, or raise ``BlockedUrlError``.

    An IP literal resolves to itself without a DNS round trip.
    """
    try:
        ipaddress.ip_address(host)
        return [host]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise BlockedUrlError(host, f"DNS resolution failed for {host}: {exc}") from None
    return sorted({str(info[4][0]) for info in infos})


def assert_url_allowed(
    url: str,
    allowed_hosts: list[str] | None = None,
    allow_private_network: bool = False,
) -> str:
    """Validate ``url`` for navigation; returns the normalised URL.

    Args:
        url: Absolute URL to open.
        allowed_hosts: Hosts that may be opened even when they resolve into a
            private range (the project's domain allow-list).
        allow_private_network: Development escape hatch that permits any
            private/loopback address. Never enabled by default.

    Raises:
        BlockedUrlError: When the URL must not be opened.
    """
    raw = (url or "").strip()
    if not raw:
        raise BlockedUrlError(raw, "A target URL is required.")
    try:
        parsed = urlparse(raw)
    except ValueError as exc:
        raise BlockedUrlError(raw, f"The URL could not be parsed: {exc}") from None

    scheme = (parsed.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise BlockedUrlError(
            raw,
            f"URL scheme '{scheme or 'none'}' is not supported; use http or https.",
        )

    host = (parsed.hostname or "").lower()
    if not host:
        raise BlockedUrlError(raw, "The URL has no hostname.")
    if host in BLOCKED_HOSTNAMES:
        raise BlockedUrlError(raw, f"Host '{host}' is a cloud metadata endpoint.")

    allowlist = _normalise_allowlist(allowed_hosts)
    explicitly_allowed = _host_allowed(host, allowlist)

    addresses = resolve_addresses(host)
    for addr in addresses:
        if addr in BLOCKED_ADDRESSES:
            raise BlockedUrlError(
                raw, f"Host '{host}' resolves to the cloud metadata address {addr}."
            )
        if _address_is_private(addr) and not (allow_private_network or explicitly_allowed):
            raise BlockedUrlError(
                raw,
                f"Host '{host}' resolves to the internal address {addr}. "
                "Add it to the project's allowed domains to scan it.",
            )
    return raw


def is_url_allowed(
    url: str,
    allowed_hosts: list[str] | None = None,
    allow_private_network: bool = False,
) -> bool:
    """Boolean form of :func:`assert_url_allowed` (used on redirect hops)."""
    try:
        assert_url_allowed(url, allowed_hosts, allow_private_network)
        return True
    except BlockedUrlError:
        return False
