"""Requirement ingestion persistence layer.

Turns parsed documents (``tools.file_ingestion``) and manual input into
:class:`~app.models.entities.Requirement` rows, implementing SRS FR-IN-005
(exact-duplicate detection within a project) and FR-IN-006 (same title +
source re-ingested with new text creates a NEW version, preserving the old
row). Splitting rules: JSON story lists yield one requirement per story;
documents yield one requirement per top-level heading section when headings
exist, otherwise a single requirement for the whole document.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.entities import Project, Requirement
from tools.file_ingestion import IngestionError, _derive_title, parse_document

logger = get_logger(__name__)


class DuplicateRequirementError(Exception):
    """Raised when identical requirement text already exists in the project (FR-IN-005)."""


def create_requirement_from_text(
    db: Session,
    project_id: str,
    title: str,
    text: str,
    acceptance_criteria: list[str] | None = None,
    source: str = "manual",
) -> Requirement:
    """Persist one requirement, with duplicate detection and versioning.

    Args:
        db: Open SQLAlchemy session (committed on success).
        project_id: Owning project id; must exist.
        title: Requirement title; derived from the first line of ``text``
            when blank.
        text: Requirement body; must be non-empty after stripping.
        acceptance_criteria: Optional list of acceptance criteria strings.
        source: Origin of the requirement — 'manual' or the uploaded
            file name (FR-IN-003).

    Returns:
        The newly created (and committed) :class:`Requirement`.

    Raises:
        IngestionError: If the text is empty/whitespace or the project does
            not exist (NFR-USA-002).
        DuplicateRequirementError: If the exact same text already exists in
            this project (FR-IN-005).
    """
    text = (text or "").strip()
    if not text:
        raise IngestionError(
            "Requirement text is empty. Please provide the requirement or "
            "user-story text before saving."
        )

    project = db.get(Project, project_id)
    if project is None:
        raise IngestionError(
            f"Project '{project_id}' was not found. Please create or select a "
            "project before ingesting requirements."
        )

    # FR-IN-005: exact-duplicate text within the same project is rejected.
    existing_same_text = db.scalars(
        select(Requirement).where(
            Requirement.project_id == project_id, Requirement.text == text
        )
    ).first()
    if existing_same_text is not None:
        raise DuplicateRequirementError(
            f"An identical requirement already exists in this project "
            f"(id={existing_same_text.id}, title='{existing_same_text.title}', "
            f"version={existing_same_text.version}). Edit the existing "
            "requirement or change the text to add a new one."
        )

    title = (title or "").strip() or _derive_title(text)

    # FR-IN-006: same title + source with different text becomes a new
    # version; the previous row is kept for audit/traceability.
    latest_version = db.scalars(
        select(Requirement)
        .where(
            Requirement.project_id == project_id,
            Requirement.title == title,
            Requirement.source == source,
        )
        .order_by(Requirement.version.desc())
    ).first()
    version = latest_version.version + 1 if latest_version is not None else 1

    requirement = Requirement(
        project_id=project_id,
        source=source,
        version=version,
        title=title,
        text=text,
        acceptance_criteria=[c.strip() for c in (acceptance_criteria or []) if c.strip()],
    )
    db.add(requirement)
    db.commit()
    db.refresh(requirement)
    logger.info(
        "Requirement stored: id=%s title='%s' source='%s' version=%d",
        requirement.id,
        requirement.title,
        requirement.source,
        requirement.version,
        extra={"project_id": project_id},
    )
    return requirement


def ingest_file(db: Session, project_id: str, filename: str, data: bytes) -> list[Requirement]:
    """Parse an uploaded document and persist its requirements (FR-IN-001..006).

    Splitting rules:
        * JSON story list/object  -> one requirement per story.
        * Document with headings  -> one requirement per top-level heading
          section (content before the first heading becomes its own
          requirement titled after the file).
        * Document, no headings   -> one requirement for the whole document.

    Items whose exact text already exists in the project are skipped
    (FR-IN-005); items whose title + source match an existing requirement
    but whose text changed are stored as a new version (FR-IN-006).

    Args:
        db: Open SQLAlchemy session.
        project_id: Owning project id.
        filename: Original upload name; stored as each requirement's source.
        data: Raw file bytes.

    Returns:
        The newly created requirements (may be fewer than the parsed items
        when duplicates were skipped).

    Raises:
        IngestionError: If validation or parsing fails (SEC-011, FR-IN-004).
        DuplicateRequirementError: If every item in the file already exists
            in the project, so nothing new was stored.
    """
    parsed = parse_document(data, filename)
    source = parsed["source"]
    fallback_title = Path(source).stem

    items: list[dict]
    if parsed["kind"] == "json":
        items = [
            {
                "title": story["title"],
                "text": story["text"],
                "acceptance_criteria": story["acceptance_criteria"],
            }
            for story in parsed["metadata"]["stories"]
        ]
    elif any(chunk["heading"] for chunk in parsed["chunks"]):
        items = [
            {
                "title": chunk["heading"] or fallback_title,
                "text": chunk["text"],
                "acceptance_criteria": [],
            }
            for chunk in parsed["chunks"]
            if chunk["text"].strip()
        ]
    else:
        items = [
            {"title": fallback_title, "text": parsed["text"].strip(), "acceptance_criteria": []}
        ]

    if not items:
        raise IngestionError(
            f"'{source}' contains headings but no requirement text under them. "
            "Please add the requirement details and upload again."
        )

    created: list[Requirement] = []
    skipped = 0
    for item in items:
        try:
            created.append(
                create_requirement_from_text(
                    db,
                    project_id,
                    title=item["title"],
                    text=item["text"],
                    acceptance_criteria=item["acceptance_criteria"],
                    source=source,
                )
            )
        except DuplicateRequirementError:
            skipped += 1
            logger.info(
                "Skipped exact duplicate from '%s': title='%s' (FR-IN-005)",
                source,
                item["title"],
                extra={"project_id": project_id},
            )

    if not created:
        raise DuplicateRequirementError(
            f"All {skipped} requirement(s) in '{source}' already exist in this "
            "project with identical text — nothing new was ingested. Update "
            "the document if you intended to add or revise requirements."
        )
    logger.info(
        "Ingested '%s': %d requirement(s) created, %d duplicate(s) skipped",
        source,
        len(created),
        skipped,
        extra={"project_id": project_id},
    )
    return created


if __name__ == "__main__":  # pragma: no cover - happy-path self-check
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models.db import Base

    # Isolated in-memory DB so the self-check never touches the real database.
    check_engine = create_engine("sqlite://")
    Base.metadata.create_all(check_engine)
    session = sessionmaker(bind=check_engine, expire_on_commit=False)()

    project = Project(name="ingestion-self-check")
    session.add(project)
    session.commit()

    req = create_requirement_from_text(
        session, project.id, "Login", "Users must be able to log in.", ["Valid creds work"]
    )
    assert req.version == 1 and req.source == "manual"

    try:
        create_requirement_from_text(session, project.id, "Login copy", "Users must be able to log in.")
        raise AssertionError("duplicate text accepted")
    except DuplicateRequirementError:
        pass  # FR-IN-005

    v2 = create_requirement_from_text(
        session, project.id, "Login", "Users must be able to log in with MFA."
    )
    assert v2.version == 2 and req.id != v2.id  # FR-IN-006, old row kept

    md = b"# Checkout\nUsers can pay by card.\n\n# Refunds\nRefunds within 30 days.\n"
    reqs = ingest_file(session, project.id, "spec.md", md)
    assert [r.title for r in reqs] == ["Checkout", "Refunds"]
    assert all(r.source == "spec.md" for r in reqs)

    import json as _json

    stories = _json.dumps(
        [{"title": "Search", "text": "Users search products.", "acceptance_criteria": ["Results ranked"]}]
    ).encode()
    (story_req,) = ingest_file(session, project.id, "stories.json", stories)
    assert story_req.acceptance_criteria == ["Results ranked"]

    print("app/services/ingestion.py self-check OK")
