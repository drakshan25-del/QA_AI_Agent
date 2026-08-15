"""Security helpers: secret redaction, domain allow-list checks (SEC-003, SEC-007)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Patterns that indicate a hard-coded secret in logs or generated code (SEC-007)
SECRET_PATTERNS: list[re.Pattern] = [
    re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*['\"][^'\"]{4,}['\"]"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),  # GitHub classic PAT
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),  # GitHub fine-grained PAT
    re.compile(r"(?i)bearer\s+[a-z0-9._\-]{16,}"),
]

REDACTED = "***REDACTED***"


def redact_secrets(text: str) -> str:
    """Mask secret-looking substrings before logging or reporting (SEC-007)."""
    result = text
    for pattern in SECRET_PATTERNS:
        result = pattern.sub(REDACTED, result)
    return result


def find_secrets(text: str) -> list[str]:
    """Return matched secret-looking snippets (redacted) for validation reports."""
    findings = []
    for pattern in SECRET_PATTERNS:
        for match in pattern.finditer(text):
            snippet = match.group(0)
            findings.append(snippet[:12] + "..." if len(snippet) > 12 else snippet)
    return findings


def is_domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    """True if the URL's host matches the project allow-list (SEC-003).

    localhost / private ranges are only allowed when explicitly listed.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    for domain in allowed_domains:
        d = domain.lower().lstrip("*.")
        if host == d or host.endswith("." + d):
            return True
    return False


def extract_urls(text: str) -> list[str]:
    """Extract http(s) URLs from source code or documents for allow-list checks."""
    return re.findall(r"https?://[^\s'\")\]>]+", text)
