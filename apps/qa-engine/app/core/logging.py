"""Structured logging with correlation IDs and secret redaction (§17 Logging)."""

from __future__ import annotations

import json
import logging
import sys
import uuid
from datetime import datetime, timezone

from app.core.security import redact_secrets


class RedactingJsonFormatter(logging.Formatter):
    """JSON log lines with automatic secret masking (SEC-007)."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_secrets(record.getMessage()),
        }
        for attr in ("run_id", "correlation_id", "project_id", "actor"):
            value = getattr(record, attr, None)
            if value is not None:
                payload[attr] = value
        if record.exc_info:
            payload["exception"] = redact_secrets(self.formatException(record.exc_info))
        return json.dumps(payload)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RedactingJsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def new_correlation_id() -> str:
    return uuid.uuid4().hex[:12]
