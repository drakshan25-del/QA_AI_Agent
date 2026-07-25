"""SQLite DDL for the evaluation store.

One table per concern, all linked by ``run_id`` / ``batch_id`` so results can be
sliced by model, task, benchmark item or repetition without reshaping. Every
column that a dissertation statistic needs (timings, tokens, scores, provenance)
is stored explicitly rather than derived at read time.
"""

from __future__ import annotations

#: Schema version — bump when columns change so old DBs are detectable.
#: v2: added runs.research_score + aggregate_metrics table (research enhancement).
SCHEMA_VERSION = 2

DDL = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One row per (model x task x item x repetition) attempt.
CREATE TABLE IF NOT EXISTS runs (
    run_id         TEXT PRIMARY KEY,
    batch_id       TEXT NOT NULL,               -- groups an experiment invocation
    model_name     TEXT NOT NULL,
    model_source   TEXT NOT NULL,               -- pretrained|finetuned|lora
    task           TEXT NOT NULL,               -- test_plan|test_cases|automation
    item_id        TEXT NOT NULL,               -- benchmark item id
    repetition     INTEGER NOT NULL,
    prompt_version TEXT,                         -- agent PROMPT_VERSION (provenance)
    rubric_version TEXT,                         -- scoring rubric version
    temperature    REAL,
    started_at     TEXT NOT NULL,               -- ISO-8601 UTC
    finished_at    TEXT,
    latency_s      REAL,                         -- wall-clock generation time
    tokens_prompt      INTEGER,                  -- best-effort (Ollama eval counts)
    tokens_completion  INTEGER,
    tokens_total       INTEGER,
    tokens_per_s   REAL,
    retries        INTEGER DEFAULT 0,
    status         TEXT NOT NULL,               -- ok|failed
    error          TEXT,                         -- failure detail (failures are data)
    raw_path       TEXT,                         -- path to persisted raw output
    accuracy_score REAL,                         -- 0..1 composite accuracy for the task
    overall_score  REAL,                         -- 0..1 blended (accuracy + speed [+ sat])
    research_score REAL                          -- 0..1 per-run Overall Research Score (v2)
);

-- Individual metric values (deterministic + composite) for a run.
CREATE TABLE IF NOT EXISTS metrics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    metric_key   TEXT NOT NULL,                  -- e.g. requirement_coverage_pct
    metric_value REAL,
    detail_json  TEXT                            -- structured breakdown for audit
);

-- LLM-as-judge sub-scores (one row per rubric dimension), kept separate so the
-- judge model and its rationale are auditable and re-scorable.
CREATE TABLE IF NOT EXISTS judgements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    dimension   TEXT NOT NULL,                   -- correctness|coverage|readability|...
    score       REAL,
    max_score   REAL,
    rationale   TEXT,
    judge_model TEXT
);

-- SUS + Likert satisfaction. Rows are inserted only when REAL raters provide
-- data in the later user study; nothing here is auto-generated.
CREATE TABLE IF NOT EXISTS satisfaction (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id      TEXT,
    model_name    TEXT NOT NULL,
    task          TEXT,                           -- NULL = overall system rating
    rater_id      TEXT NOT NULL,
    sus_score     REAL,                           -- 0..100 (SUS formula)
    sus_items_json  TEXT,                         -- raw 10 SUS item responses (1..5)
    likert_json     TEXT,                         -- {usefulness, readability, trust, ...}
    collected_at  TEXT NOT NULL
);

-- Cross-run / derived metrics (Consistency, Reliability, Robustness, and the
-- rolled-up Research Score) computed in a post-batch pass. item_id is NULL for
-- (model, task)-level rows. Kept separate from per-run `metrics` so aggregates
-- are not confused with raw run measurements.
CREATE TABLE IF NOT EXISTS aggregate_metrics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id     TEXT NOT NULL,
    model_name   TEXT NOT NULL,
    task         TEXT,                            -- NULL = across all tasks
    item_id      TEXT,                            -- NULL = across all items
    metric_key   TEXT NOT NULL,                   -- consistency|reliability|robustness|research_score|...
    metric_value REAL,
    detail_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_batch  ON runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_runs_model  ON runs(model_name);
CREATE INDEX IF NOT EXISTS idx_runs_task   ON runs(task);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_judge_run   ON judgements(run_id);
CREATE INDEX IF NOT EXISTS idx_agg_batch   ON aggregate_metrics(batch_id);
"""
