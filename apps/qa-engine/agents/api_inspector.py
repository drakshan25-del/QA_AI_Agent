"""Fetch and distill the target app's OpenAPI spec for API-generation grounding.

API generation invented request contracts from test-case wording — a JSON
body with an ``email`` field for an endpoint that reads form-encoded
``username``/``password`` — so credentials never reached the app, positive
tests failed falsely and negative tests passed vacuously (AIQA-EXEC-005).
This module is the API-side twin of :mod:`agents.page_inspector`: it fetches
``{base_url}/openapi.json`` at generation time and renders an authoritative
endpoint inventory (method, path, body encoding, field names, response codes)
into the prompt, and hands the structured surface to the payload gate.

Rendered lines start with ``METHOD /path`` on purpose: that is the shape
``automation_agent._DOC_ENDPOINT_RE`` recognises, so a live spec also arms
the existing documented-endpoint gate even when the project has no uploaded
API documentation.

Fail-open everywhere: no spec, unparseable spec, or odd schemas must never
block generation — the model then simply generates ungrounded, exactly as
before this module existed.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.core.logging import get_logger

logger = get_logger(__name__)

FETCH_TIMEOUT_SECONDS = 3.0
MAX_SPEC_BYTES = 500_000
MAX_RENDER_CHARS = 4_000

FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
JSON_CONTENT_TYPE = "application/json"


@dataclass
class Endpoint:
    """One documented operation, with what the payload gate needs to verify."""

    method: str  # lowercase
    path: str  # as documented, may contain {param} templates
    content_type: str = ""  # "" when the operation takes no request body
    fields: list[str] = field(default_factory=list)
    required: list[str] = field(default_factory=list)
    response_codes: list[str] = field(default_factory=list)
    summary: str = ""

    @property
    def matcher(self) -> re.Pattern[str]:
        pattern = re.escape(self.path.rstrip("/") or "/")
        pattern = re.sub(r"\\\{[^/]*?\\\}", r"[^/]+", pattern)
        return re.compile(f"^{pattern}/?$")

    def render(self) -> str:
        line = f"{self.method.upper()} {self.path}"
        if self.content_type == FORM_CONTENT_TYPE:
            line += (
                f"  body={FORM_CONTENT_TYPE} fields: "
                + ", ".join(self.fields)
                + " (use data={...}, NOT json=)"
            )
        elif self.content_type == JSON_CONTENT_TYPE:
            line += (
                f"  body={JSON_CONTENT_TYPE} fields: "
                + ", ".join(self.fields)
                + " (use json={...})"
            )
        elif self.content_type:
            line += f"  body={self.content_type}"
        if self.response_codes:
            line += "  responses: " + ", ".join(self.response_codes)
        if self.summary:
            line += f"  — {self.summary}"
        return line


@dataclass
class ApiSurface:
    """Distilled OpenAPI spec: every documented operation."""

    endpoints: list[Endpoint] = field(default_factory=list)

    def find(self, method: str, path: str) -> Endpoint | None:
        path = "/" + path.split("?", 1)[0].strip("/") if path else "/"
        method = method.lower()
        for ep in self.endpoints:
            if ep.method == method and ep.matcher.match(path):
                return ep
        return None


def _resolve_ref(spec: dict, schema: dict) -> dict:
    """Follow one level of ``$ref`` into ``components.schemas``."""
    ref = schema.get("$ref", "")
    if ref.startswith("#/components/schemas/"):
        return spec.get("components", {}).get("schemas", {}).get(ref.rsplit("/", 1)[-1], {})
    return schema


def distill_openapi(spec: dict) -> ApiSurface:
    """Distill an OpenAPI 3.x document into an :class:`ApiSurface`; never raises."""
    surface = ApiSurface()
    try:
        for path, operations in (spec.get("paths") or {}).items():
            if not isinstance(operations, dict):
                continue
            for method, op in operations.items():
                if method.lower() not in ("get", "post", "put", "patch", "delete", "head", "options"):
                    continue
                if not isinstance(op, dict):
                    continue
                endpoint = Endpoint(
                    method=method.lower(),
                    path=path,
                    response_codes=sorted((op.get("responses") or {}).keys()),
                    summary=(op.get("summary") or "").strip()[:80],
                )
                content = ((op.get("requestBody") or {}).get("content") or {})
                for content_type, body in content.items():
                    endpoint.content_type = content_type.split(";")[0].strip()
                    schema = _resolve_ref(spec, (body or {}).get("schema") or {})
                    props = schema.get("properties") or {}
                    endpoint.fields = list(props.keys())
                    endpoint.required = list(schema.get("required") or [])
                    break  # first (usually only) content type wins
                surface.endpoints.append(endpoint)
    except Exception:  # noqa: BLE001 - odd specs must not break generation
        logger.warning("openapi distillation failed; continuing with partial surface")
    return surface


def fetch_openapi(base_url: str) -> dict | None:
    """GET ``{base_url}/openapi.json``; ``None`` on any failure (fail-open)."""
    if not base_url:
        return None
    import httpx

    url = base_url.rstrip("/") + "/openapi.json"
    try:
        response = httpx.get(url, timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True)
        if response.status_code != 200:
            return None
        spec = json.loads(response.text[:MAX_SPEC_BYTES])
        return spec if isinstance(spec, dict) and spec.get("paths") else None
    except Exception:  # noqa: BLE001 - grounding is best-effort, never fatal
        logger.warning("openapi fetch failed for %s; generating ungrounded", url)
        return None


def collect_api_surface(base_url: str) -> ApiSurface | None:
    """Fetch + distill in one step; ``None`` when the spec is unavailable."""
    spec = fetch_openapi(base_url)
    if spec is None:
        return None
    surface = distill_openapi(spec)
    return surface if surface.endpoints else None


def render_api_surface(surface: ApiSurface | None, test_cases: list[dict]) -> str:
    """Prompt-facing rendering, endpoints referenced by the test cases first."""
    if surface is None or not surface.endpoints:
        return ""
    blob = json.dumps(test_cases, default=str).lower()
    referenced = [ep for ep in surface.endpoints if ep.path.split("{")[0].lower() in blob]
    rest = [ep for ep in surface.endpoints if ep not in referenced]
    lines = [
        "# Live API surface (OpenAPI — authoritative for methods, paths, body "
        "encoding and field names):",
        "# NOTE: auth failures may return 401/403 at runtime even when the "
        "spec does not list them.",
    ]
    for ep in referenced + rest:
        line = ep.render()
        if sum(len(l) + 1 for l in lines) + len(line) > MAX_RENDER_CHARS:
            lines.append("# (further endpoints omitted for brevity)")
            break
        lines.append(line)
    return "\n".join(lines)
