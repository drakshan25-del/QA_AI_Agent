"""FastAPI application factory for the Agentic AI QA System (SRS §14.2).

``create_app`` wires every API router together; the lifespan hook configures
structured JSON logging (§17) and creates the database schema on startup.
Run locally with:

    .venv/bin/uvicorn app.main:app --reload
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute

from app.api import (
    approvals,
    automation,
    executions,
    export,
    findings,
    generation,
    git_ci,
    health,
    projects,
    reports,
    requirements,
)
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.models.db import init_db

logger = get_logger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Configure logging and initialise the database schema on startup."""
    configure_logging()
    init_db()
    logger.info("%s started", get_settings().app_name)
    yield


def _include_eagerly(app: FastAPI, router: APIRouter) -> None:
    """Attach a router's concrete routes directly to the app.

    FastAPI >= 0.139 defers ``include_router`` behind an internal wrapper
    that hides route paths from ``app.routes``; tooling (and the SRS §14.2
    endpoint inventory) enumerates ``app.routes`` directly, so the fully
    built :class:`APIRoute` objects are appended eagerly instead. Router
    prefixes and tags are already baked into each route at registration.
    """
    for route in router.routes:
        if isinstance(route, APIRoute):
            route.dependency_overrides_provider = app
        app.router.routes.append(route)


def create_app() -> FastAPI:
    """Build the FastAPI application with all routers registered (§14.2)."""
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        description="Agentic AI Quality Assurance System - local-first, "
        "human-in-the-loop QA pipeline (MSc dissertation project).",
        lifespan=_lifespan,
    )
    for router in (
        health.router,
        projects.router,
        requirements.router,
        generation.router,
        automation.router,
        approvals.router,
        executions.router,
        git_ci.router,
        findings.router,
        reports.router,
        export.router,
    ):
        _include_eagerly(app, router)
    return app


app = create_app()
