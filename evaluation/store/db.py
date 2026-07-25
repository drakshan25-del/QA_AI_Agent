"""Thin, dependency-free SQLite store for evaluation results.

Uses the standard-library :mod:`sqlite3` (no ORM) — the schema is small, the
access patterns are simple inserts + analytical reads, and avoiding an ORM keeps
the experiment store trivially inspectable with any SQLite client. All writes go
through typed helper methods so the harness never hand-writes SQL.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from evaluation.store.schema import DDL, SCHEMA_VERSION


class EvalStore:
    """Persistence gateway for runs, metrics, judgements and satisfaction.

    Args:
        db_path: SQLite file to open/create. Parent directory must exist.
    """

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self._init_schema()

    # -- connection -------------------------------------------------------
    @contextmanager
    def _connect(self):
        """Yield a connection with foreign keys and row access by name."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(DDL)
            self._migrate(conn)
            conn.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', ?)",
                (str(SCHEMA_VERSION),),
            )

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Idempotently add columns missing from pre-v2 databases.

        ``CREATE TABLE IF NOT EXISTS`` does not add columns to an existing table,
        so a v1 ``runs`` table needs ``research_score`` back-filled. Safe to run
        every open (checks ``PRAGMA table_info`` first)."""
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(runs)")}
        if "research_score" not in existing:
            conn.execute("ALTER TABLE runs ADD COLUMN research_score REAL")

    # -- writes -----------------------------------------------------------
    def insert_run(self, run: Mapping[str, Any]) -> None:
        """Insert one run row. Unknown keys are ignored so callers may pass a
        superset (keeps the harness decoupled from column order)."""
        cols = [
            "run_id", "batch_id", "model_name", "model_source", "task", "item_id",
            "repetition", "prompt_version", "rubric_version", "temperature",
            "started_at", "finished_at", "latency_s", "tokens_prompt",
            "tokens_completion", "tokens_total", "tokens_per_s", "retries",
            "status", "error", "raw_path", "accuracy_score", "overall_score",
            "research_score",
        ]
        values = [run.get(c) for c in cols]
        placeholders = ", ".join("?" for _ in cols)
        with self._connect() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO runs ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )

    def insert_metrics(self, run_id: str, metrics: Mapping[str, Any]) -> None:
        """Insert scalar metrics for a run.

        ``metrics`` maps ``metric_key`` -> either a number, or a dict with
        ``{"value": float, "detail": <json-able>}`` for metrics that carry a
        structured breakdown (e.g. per-check validation counts).
        """
        rows: list[tuple] = []
        for key, raw in metrics.items():
            if isinstance(raw, Mapping) and "value" in raw:
                value = raw.get("value")
                detail = json.dumps(raw.get("detail"), default=str)
            else:
                value, detail = (raw, None)
            rows.append((run_id, key, _as_float(value), detail))
        with self._connect() as conn:
            conn.executemany(
                "INSERT INTO metrics (run_id, metric_key, metric_value, detail_json) "
                "VALUES (?, ?, ?, ?)",
                rows,
            )

    def insert_judgements(self, run_id: str, judgements: Iterable[Mapping[str, Any]]) -> None:
        """Insert LLM-judge sub-scores for a run."""
        rows = [
            (
                run_id,
                j.get("dimension"),
                _as_float(j.get("score")),
                _as_float(j.get("max_score")),
                j.get("rationale"),
                j.get("judge_model"),
            )
            for j in judgements
        ]
        if not rows:
            return
        with self._connect() as conn:
            conn.executemany(
                "INSERT INTO judgements (run_id, dimension, score, max_score, rationale, "
                "judge_model) VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )

    def insert_satisfaction(self, record: Mapping[str, Any]) -> None:
        """Insert one real satisfaction record (from a human rater)."""
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO satisfaction (batch_id, model_name, task, rater_id, sus_score, "
                "sus_items_json, likert_json, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.get("batch_id"),
                    record["model_name"],
                    record.get("task"),
                    record["rater_id"],
                    _as_float(record.get("sus_score")),
                    json.dumps(record.get("sus_items"), default=str),
                    json.dumps(record.get("likert"), default=str),
                    record["collected_at"],
                ),
            )

    def insert_aggregate_metrics(self, rows: Iterable[Mapping[str, Any]]) -> None:
        """Insert cross-run/derived metrics (consistency, reliability, research score…).

        Each row: ``{batch_id, model_name, task?, item_id?, metric_key, value, detail?}``.
        """
        prepared = [
            (
                r["batch_id"], r["model_name"], r.get("task"), r.get("item_id"),
                r["metric_key"], _as_float(r.get("value")),
                json.dumps(r.get("detail"), default=str) if r.get("detail") is not None else None,
            )
            for r in rows
        ]
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                "INSERT INTO aggregate_metrics (batch_id, model_name, task, item_id, metric_key, "
                "metric_value, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                prepared,
            )

    # -- reads ------------------------------------------------------------
    def fetch_aggregate_metrics(self, batch_id: str | None = None) -> list[dict]:
        sql = "SELECT * FROM aggregate_metrics"
        params: Sequence = ()
        if batch_id:
            sql += " WHERE batch_id = ?"
            params = (batch_id,)
        with self._connect() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]

    def fetch_runs(self, batch_id: str | None = None) -> list[dict]:
        """Return run rows (optionally filtered to one batch), newest first."""
        sql = "SELECT * FROM runs"
        params: Sequence = ()
        if batch_id:
            sql += " WHERE batch_id = ?"
            params = (batch_id,)
        sql += " ORDER BY started_at DESC"
        with self._connect() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]

    def fetch_metrics(self, run_id: str) -> list[dict]:
        with self._connect() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT metric_key, metric_value, detail_json FROM metrics WHERE run_id = ?",
                    (run_id,),
                ).fetchall()
            ]

    def fetch_judgements(self, run_id: str) -> list[dict]:
        with self._connect() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT dimension, score, max_score, rationale, judge_model "
                    "FROM judgements WHERE run_id = ?",
                    (run_id,),
                ).fetchall()
            ]

    def fetch_satisfaction(self) -> list[dict]:
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM satisfaction").fetchall()]

    def latest_batch_id(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT batch_id FROM runs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
            return row["batch_id"] if row else None


def _as_float(value: Any) -> float | None:
    """Coerce a metric to float for storage, tolerating None/str."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
