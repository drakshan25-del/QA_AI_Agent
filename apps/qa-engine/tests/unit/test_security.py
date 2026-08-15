"""Unit tests for app.core.security (SEC-003, SEC-007; SRS §15.1).

Covers secret redaction, hard-coded credential detection and the domain
allow-list check. Pure functions — no network, no LLM, no browser
(NFR-MNT-003).
"""

from __future__ import annotations

import pytest

from app.core.security import (
    REDACTED,
    extract_urls,
    find_secrets,
    is_domain_allowed,
    redact_secrets,
)

pytestmark = pytest.mark.unit

# Secret-looking fixtures are assembled at runtime so this file never
# contains a literal `password = "..."` string itself (SEC-007 hygiene).
_PASSWORD_LINE = "pass" + 'word = "SuperSecret123!"'
_TOKEN_LINE = "tok" + 'en: "abcdef0123456789"'
_API_KEY_LINE = "api_" + 'key = "sk-not-a-real-key-000"'
_GITHUB_PAT = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"
_BEARER_LINE = "Authorization: Bear" + "er abcdefghijklmnop1234"


class TestRedactSecrets:
    def test_masks_hardcoded_password(self):
        redacted = redact_secrets(f"config: {_PASSWORD_LINE}\n")
        assert "SuperSecret123!" not in redacted
        assert REDACTED in redacted

    def test_masks_token_assignment(self):
        redacted = redact_secrets(_TOKEN_LINE)
        assert "abcdef0123456789" not in redacted
        assert REDACTED in redacted

    def test_masks_api_key(self):
        redacted = redact_secrets(_API_KEY_LINE)
        assert "sk-not-a-real-key-000" not in redacted
        assert REDACTED in redacted

    def test_masks_github_pat(self):
        redacted = redact_secrets(f"remote error for {_GITHUB_PAT} rejected")
        assert _GITHUB_PAT not in redacted
        assert REDACTED in redacted

    def test_masks_bearer_header(self):
        redacted = redact_secrets(_BEARER_LINE)
        assert "abcdefghijklmnop1234" not in redacted
        assert REDACTED in redacted

    def test_plain_text_untouched(self):
        text = "login failed: flash message was 'Invalid credentials'"
        assert redact_secrets(text) == text


class TestFindSecrets:
    def test_catches_hardcoded_credentials(self):
        code = f"USER = 'demo'\n{_PASSWORD_LINE}\n{_TOKEN_LINE}\n"
        findings = find_secrets(code)
        assert len(findings) >= 2

    def test_findings_are_truncated_snippets(self):
        findings = find_secrets(_PASSWORD_LINE)
        assert findings, "expected the hard-coded password to be found"
        # Long matches are cut to a short redacted snippet, never the full value.
        assert all(len(f) <= 15 for f in findings)
        assert all("SuperSecret123!" not in f for f in findings)

    def test_clean_code_yields_nothing(self):
        code = 'import os\npassword = os.environ["QA_TEST_PASSWORD"]\n'
        assert find_secrets(code) == []


class TestIsDomainAllowed:
    ALLOWED = ["example.com", "localhost"]

    def test_listed_domain_allowed(self):
        assert is_domain_allowed("https://example.com/login", self.ALLOWED)

    def test_subdomain_of_listed_domain_allowed(self):
        assert is_domain_allowed("https://staging.example.com/x", self.ALLOWED)
        assert is_domain_allowed("https://a.b.example.com", self.ALLOWED)

    def test_unlisted_domain_blocked(self):
        assert not is_domain_allowed("https://evil.org/", self.ALLOWED)

    def test_lookalike_suffix_domain_blocked(self):
        # notexample.com must NOT match the example.com entry.
        assert not is_domain_allowed("https://notexample.com/", self.ALLOWED)

    def test_private_ip_blocked_unless_listed(self):
        assert not is_domain_allowed("http://10.0.0.5/admin", self.ALLOWED)
        assert not is_domain_allowed("http://192.168.1.10/", self.ALLOWED)
        assert not is_domain_allowed("http://172.16.0.1/", self.ALLOWED)

    def test_private_ip_allowed_when_explicitly_listed(self):
        assert is_domain_allowed("http://192.168.1.10/", ["192.168.1.10"])

    def test_localhost_only_when_listed(self):
        assert is_domain_allowed("http://localhost:8001/items", self.ALLOWED)
        assert not is_domain_allowed("http://localhost:8001/items", ["example.com"])
        assert not is_domain_allowed("http://127.0.0.1:8001/", ["example.com"])

    def test_case_insensitive_host_match(self):
        assert is_domain_allowed("https://EXAMPLE.com/path", self.ALLOWED)

    def test_wildcard_prefix_in_allowlist(self):
        assert is_domain_allowed("https://api.example.com", ["*.example.com"])

    def test_empty_or_garbage_url_blocked(self):
        assert not is_domain_allowed("", self.ALLOWED)
        assert not is_domain_allowed("not a url", self.ALLOWED)


class TestExtractUrls:
    def test_extracts_http_and_https(self):
        text = 'page.goto("http://localhost:8001/login")\n# see https://example.com/docs.'
        urls = extract_urls(text)
        assert "http://localhost:8001/login" in urls
        assert any(u.startswith("https://example.com/docs") for u in urls)

    def test_no_urls(self):
        assert extract_urls("def test_x():\n    pass\n") == []
