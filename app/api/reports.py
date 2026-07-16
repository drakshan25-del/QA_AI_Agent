"""Report endpoints (SRS FR-REP-001..004).

POST /reports/execution/{run_id} builds the Markdown + HTML report via
``app.services.report_service`` (measured metrics labelled 'Measured', the
narrative labelled as AI-generated, FR-REP-002) and records an audit event.
GET /reports/{run_id} serves the generated self-contained HTML (FR-REP-003).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.llm import OllamaUnavailableError
from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.services.audit import record_event
from app.services.report_service import generate_report

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/execution/{run_id}", status_code=201)
def create_execution_report(run_id: str, db: Session = Depends(get_db)) -> dict:
    """Generate the execution report for one run (FR-REP-001..004)."""
    try:
        result = generate_report(db, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except OllamaUnavailableError as exc:  # defensive: service falls back itself
        raise HTTPException(status_code=503, detail=str(exc)) from None

    record_event(
        db,
        actor="local-user",
        action="report.generate",
        resource=f"execution:{run_id}",
        correlation_id=new_correlation_id(),
        html_path=result["html_path"],
        md_path=result["md_path"],
        narrative_label=result["data"].get("ai_narrative", {}).get("label", ""),
    )
    return {
        "run_id": run_id,
        "html_path": result["html_path"],
        "md_path": result["md_path"],
        "metrics": result["data"].get("metrics", {}),
        "narrative": result["data"].get("ai_narrative", {}),
    }


@router.get("/{run_id}")
def get_report(run_id: str) -> FileResponse:
    """Serve the generated HTML report for one run (FR-REP-003)."""
    # Guard against path traversal in the id before touching the filesystem.
    if "/" in run_id or "\\" in run_id or ".." in run_id:
        raise HTTPException(status_code=400, detail="Invalid run id.")
    html_path = get_settings().reports_path / run_id / "report.html"
    if not html_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"No report found for run {run_id!r}. Generate it first via "
            "POST /reports/execution/{run_id}.",
        )
    return FileResponse(html_path, media_type="text/html", filename="report.html")
