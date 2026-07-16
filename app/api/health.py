"""Health endpoint (SRS §17: dependency health is always inspectable).

Reports the API itself, database connectivity (``SELECT 1``) and Ollama
availability including the pulled models, so an operator can immediately see
which dependency is down and how to fix it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.llm import check_ollama_health
from app.models.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Liveness/readiness of the API, database and local LLM (§17)."""
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # noqa: BLE001 - reported, never crashes the probe
        database = f"error: {exc}"
    return {
        "api": "ok",
        "database": database,
        "ollama": check_ollama_health(),
    }
