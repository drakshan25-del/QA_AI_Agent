"""Pure document-parsing layer for requirement ingestion.

Implements SRS FR-IN-001 (accepted formats: .txt, .md, .json, .pdf, .docx),
FR-IN-002 (plain-text extraction), FR-IN-003 (per-chunk source traceability:
every chunk records the source file plus a location such as page, paragraph,
line or heading), FR-IN-004 (scanned / empty PDF detection) and SEC-011
(file type, size and content are validated BEFORE any parser touches the
bytes). No database or LLM access happens here; persistence lives in
``app.services.ingestion``.

All user-facing failures raise :class:`IngestionError` with an actionable,
plain-language message (NFR-USA-002).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path
from typing import Any

#: File extensions accepted for upload (FR-IN-001, SEC-011).
ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".txt", ".md", ".json", ".pdf", ".docx"})

#: Maximum accepted upload size in bytes (SEC-011).
MAX_FILE_SIZE_BYTES: int = 10 * 1024 * 1024  # 10 MB

#: A PDF that yields fewer extractable characters than this is treated as a
#: scanned image / empty document and rejected (FR-IN-004).
MIN_PDF_TEXT_CHARS: int = 20

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_DOCX_HEADING_STYLE = re.compile(r"^heading\s+(\d+)$", re.IGNORECASE)

_KIND_BY_EXTENSION = {
    ".txt": "text",
    ".md": "markdown",
    ".json": "json",
    ".pdf": "pdf",
    ".docx": "docx",
}


class IngestionError(Exception):
    """A document could not be ingested; the message tells the user how to fix it (NFR-USA-002)."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_document(path_or_bytes: str | Path | bytes, filename: str | None = None) -> dict:
    """Parse an uploaded requirements document into text plus traceable chunks.

    Args:
        path_or_bytes: Either a filesystem path to the document or its raw
            bytes (e.g. an upload body).
        filename: Original file name. Required when raw bytes are given;
            defaults to the path's name otherwise. Its extension selects
            the parser.

    Returns:
        A dict with keys:
            ``source``   - the (sanitised) file name,
            ``kind``     - one of text|markdown|json|pdf|docx,
            ``text``     - the full extracted plain text (FR-IN-002),
            ``chunks``   - list of ``{text, location, heading, source}``
                           preserving traceability (FR-IN-003),
            ``metadata`` - size, sha256 hash and format-specific details
                           (JSON documents additionally expose normalised
                           ``stories``).

    Raises:
        IngestionError: On unsupported extension, oversize or empty file
            (SEC-011), unreadable content, or a PDF with no extractable
            text (FR-IN-004).
    """
    data, source = _load_and_validate(path_or_bytes, filename)
    kind = _KIND_BY_EXTENSION[Path(source).suffix.lower()]

    if kind == "text":
        text, chunks, extra = _parse_plaintext(data, source)
    elif kind == "markdown":
        text, chunks, extra = _parse_markdown(data, source)
    elif kind == "json":
        text, chunks, extra = _parse_json(data, source)
    elif kind == "pdf":
        text, chunks, extra = _parse_pdf(data, source)
    else:  # docx
        text, chunks, extra = _parse_docx(data, source)

    if not text.strip():
        raise IngestionError(
            f"'{source}' contains no readable requirement text. "
            "Please upload a document with actual content."
        )

    metadata: dict[str, Any] = {
        "filename": source,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "chunk_count": len(chunks),
        **extra,
    }
    return {"source": source, "kind": kind, "text": text, "chunks": chunks, "metadata": metadata}


# ---------------------------------------------------------------------------
# Validation (runs BEFORE parsing — SEC-011)
# ---------------------------------------------------------------------------


def _load_and_validate(path_or_bytes: str | Path | bytes, filename: str | None) -> tuple[bytes, str]:
    """Validate extension, size and non-emptiness, then return (bytes, name)."""
    if isinstance(path_or_bytes, bytes):
        if not filename:
            raise IngestionError(
                "No file name was provided with the uploaded content, so the "
                "format cannot be determined. Please supply the original file name."
            )
        source = Path(filename).name  # strip any client-supplied directories
        _validate_extension(source)
        data = path_or_bytes
    else:
        path = Path(path_or_bytes)
        source = Path(filename).name if filename else path.name
        _validate_extension(source)
        if not path.is_file():
            raise IngestionError(
                f"File '{path}' was not found. Please check the path and try again."
            )
        if path.stat().st_size > MAX_FILE_SIZE_BYTES:
            raise IngestionError(_too_large_message(source, path.stat().st_size))
        data = path.read_bytes()

    if len(data) > MAX_FILE_SIZE_BYTES:
        raise IngestionError(_too_large_message(source, len(data)))
    if not data.strip():
        raise IngestionError(
            f"'{source}' is empty. Please upload a document that contains requirement text."
        )
    return data, source


def _validate_extension(source: str) -> None:
    ext = Path(source).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
        shown = ext if ext else "(none)"
        raise IngestionError(
            f"File type '{shown}' is not supported. Please upload one of: {supported}."
        )


def _too_large_message(source: str, size: int) -> str:
    mb = size / (1024 * 1024)
    return (
        f"'{source}' is {mb:.1f} MB, which exceeds the 10 MB limit. "
        "Please split the document or remove embedded images and retry."
    )


def _decode_utf8(data: bytes, source: str) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise IngestionError(
            f"'{source}' is not valid UTF-8 text. Please re-save the file "
            "with UTF-8 encoding and upload it again."
        ) from exc


# ---------------------------------------------------------------------------
# Chunk building (FR-IN-003)
# ---------------------------------------------------------------------------


def _chunk(text: str, location: str, heading: str, source: str) -> dict:
    """One traceable chunk: records its source file and location (FR-IN-003)."""
    return {"text": text, "location": location, "heading": heading, "source": source}


def _build_section_chunks(items: list[tuple[str, int | None, str]], source: str) -> list[dict]:
    """Group ``(text, heading_level | None, location)`` items into chunks.

    If headings exist, one chunk is produced per *top-level* heading section
    (deeper headings stay inside the section body, re-serialised as
    ``## Sub-heading`` lines); content before the first heading becomes a
    preamble chunk. Without headings each item becomes its own chunk.
    """
    levels = [level for _, level, _ in items if level is not None]
    if not levels:
        return [
            _chunk(text, location, "", source)
            for text, _, location in items
            if text.strip()
        ]

    top = min(levels)
    chunks: list[dict] = []
    heading = ""
    location = items[0][2]
    parts: list[str] = []

    def _flush() -> None:
        body = "\n".join(p for p in parts if p.strip()).strip()
        if heading or body:
            chunks.append(_chunk(body, location, heading, source))

    for text, level, loc in items:
        if level == top:
            _flush()
            heading, location, parts = text.strip(), loc, []
        elif level is not None:
            parts.append(f"{'#' * level} {text.strip()}")
        else:
            parts.append(text)
    _flush()
    return chunks


# ---------------------------------------------------------------------------
# Format parsers (FR-IN-002)
# ---------------------------------------------------------------------------


def _parse_plaintext(data: bytes, source: str) -> tuple[str, list[dict], dict]:
    """Plain text: one chunk per blank-line-separated paragraph."""
    text = _decode_utf8(data, source)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks = [
        _chunk(paragraph, f"paragraph {i}", "", source)
        for i, paragraph in enumerate(paragraphs, 1)
    ]
    return text, chunks, {"paragraph_count": len(paragraphs)}


def _parse_markdown(data: bytes, source: str) -> tuple[str, list[dict], dict]:
    """Markdown: one chunk per top-level ATX heading section, else paragraphs."""
    text = _decode_utf8(data, source)
    items: list[tuple[str, int | None, str]] = []
    pending: list[str] = []
    pending_start = 1

    for lineno, line in enumerate(text.splitlines(), 1):
        match = _MD_HEADING.match(line)
        if match:
            if any(part.strip() for part in pending):
                items.append(("\n".join(pending).strip(), None, f"line {pending_start}"))
            pending = []
            items.append((match.group(2).strip(), len(match.group(1)), f"line {lineno}"))
        else:
            if not pending:
                pending_start = lineno
            pending.append(line)
    if any(part.strip() for part in pending):
        items.append(("\n".join(pending).strip(), None, f"line {pending_start}"))

    chunks = _build_section_chunks(items, source)
    heading_count = sum(1 for c in chunks if c["heading"])
    return text, chunks, {"heading_count": heading_count}


def _parse_json(data: bytes, source: str) -> tuple[str, list[dict], dict]:
    """JSON user stories: a single story object or a list of stories.

    Each story is ``{title, text | story, acceptance_criteria}`` (FR-IN-001).
    Normalised stories are returned under ``metadata['stories']`` so the
    persistence layer can create one requirement per story.
    """
    raw = _decode_utf8(data, source)
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise IngestionError(
            f"'{source}' is not valid JSON (error at line {exc.lineno}: {exc.msg}). "
            "Please fix the JSON syntax and upload it again."
        ) from exc

    if isinstance(loaded, dict):
        raw_stories: list[Any] = [loaded]
    elif isinstance(loaded, list):
        raw_stories = loaded
    else:
        raise IngestionError(
            f"'{source}' must contain a JSON object (one user story) or a list "
            "of user stories, each with 'title', 'text' (or 'story') and "
            "optional 'acceptance_criteria'."
        )
    if not raw_stories:
        raise IngestionError(
            f"'{source}' contains an empty list — there are no user stories to ingest."
        )

    stories = [_normalise_story(item, i, source) for i, item in enumerate(raw_stories, 1)]
    chunks = [
        _chunk(story["text"], f"story {i}", story["title"], source)
        for i, story in enumerate(stories, 1)
    ]
    text = "\n\n".join(f"{s['title']}\n{s['text']}" for s in stories)
    return text, chunks, {"story_count": len(stories), "stories": stories}


def _normalise_story(item: Any, index: int, source: str) -> dict:
    """Normalise one JSON story to {title, text, acceptance_criteria}."""
    if not isinstance(item, dict):
        raise IngestionError(
            f"Story {index} in '{source}' is not a JSON object. Each story must "
            "be an object with 'title', 'text' (or 'story') and optional "
            "'acceptance_criteria'."
        )
    text = str(item.get("text") or item.get("story") or "").strip()
    if not text:
        raise IngestionError(
            f"Story {index} in '{source}' has no 'text' or 'story' field. "
            "Please add the user story text and upload again."
        )
    criteria = item.get("acceptance_criteria") or []
    if not isinstance(criteria, list):
        raise IngestionError(
            f"Story {index} in '{source}': 'acceptance_criteria' must be a list "
            "of strings."
        )
    title = str(item.get("title") or "").strip() or _derive_title(text)
    return {
        "title": title,
        "text": text,
        "acceptance_criteria": [str(c).strip() for c in criteria if str(c).strip()],
    }


def _parse_pdf(data: bytes, source: str) -> tuple[str, list[dict], dict]:
    """PDF via pypdf: one chunk per page; scanned/empty PDFs rejected (FR-IN-004)."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # pragma: no cover - password-protected
                raise IngestionError(
                    f"'{source}' is password-protected. Please remove the "
                    "password and upload it again."
                ) from exc
        page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
    except IngestionError:
        raise
    except Exception as exc:
        raise IngestionError(
            f"'{source}' could not be read as a PDF ({exc}). The file may be "
            "corrupted — please re-export it and try again."
        ) from exc

    text = "\n\n".join(t for t in page_texts if t)
    if len(text.strip()) < MIN_PDF_TEXT_CHARS:
        # FR-IN-004: never silently treat a scanned PDF as empty input.
        raise IngestionError(
            f"'{source}' appears to be a scanned image or contains no "
            "extractable text. Please provide a text-based PDF (or the same "
            "content as .docx, .txt, .md or .json)."
        )
    chunks = [
        _chunk(page_text, f"page {i}", "", source)
        for i, page_text in enumerate(page_texts, 1)
        if page_text
    ]
    return text, chunks, {"page_count": len(page_texts)}


def _parse_docx(data: bytes, source: str) -> tuple[str, list[dict], dict]:
    """DOCX via python-docx: one chunk per top-level heading section, else paragraphs."""
    import docx

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise IngestionError(
            f"'{source}' could not be read as a Word document ({exc}). Please "
            "re-save it as .docx and try again."
        ) from exc

    items: list[tuple[str, int | None, str]] = []
    for i, paragraph in enumerate(document.paragraphs, 1):
        para_text = paragraph.text.strip()
        if not para_text:
            continue
        style_name = (paragraph.style.name if paragraph.style is not None else "") or ""
        match = _DOCX_HEADING_STYLE.match(style_name.strip())
        level = int(match.group(1)) if match else None
        items.append((para_text, level, f"paragraph {i}"))

    text = "\n".join(item[0] for item in items)
    chunks = _build_section_chunks(items, source)
    heading_count = sum(1 for c in chunks if c["heading"])
    return text, chunks, {"paragraph_count": len(items), "heading_count": heading_count}


def _derive_title(text: str, max_length: int = 80) -> str:
    """Derive a short title from the first line of a requirement text."""
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    return first_line[:max_length].rstrip() or "Untitled requirement"


if __name__ == "__main__":  # pragma: no cover - happy-path self-check
    md = b"# Login\nUsers must log in.\n\n## Details\nWith email + password.\n\n# Logout\nUsers can log out.\n"
    result = parse_document(md, "spec.md")
    assert result["kind"] == "markdown" and len(result["chunks"]) == 2, result
    assert result["chunks"][0]["heading"] == "Login"
    assert result["chunks"][0]["source"] == "spec.md"

    stories = json.dumps(
        [
            {"title": "Login", "story": "As a user I log in.", "acceptance_criteria": ["Valid creds work"]},
            {"text": "As a user I reset my password."},
        ]
    ).encode()
    result = parse_document(stories, "stories.json")
    assert len(result["metadata"]["stories"]) == 2, result["metadata"]

    try:
        parse_document(b"x", "notes.xlsx")
        raise AssertionError("unsupported extension accepted")
    except IngestionError as err:
        assert "not supported" in str(err)

    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    try:
        parse_document(buffer.getvalue(), "scan.pdf")
        raise AssertionError("scanned PDF accepted")
    except IngestionError as err:
        assert "scanned" in str(err)  # FR-IN-004

    print("tools/file_ingestion.py self-check OK")
