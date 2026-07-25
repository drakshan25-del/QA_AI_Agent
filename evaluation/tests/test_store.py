"""Store round-trip: runs, metrics, judgements and satisfaction persist/read back."""

from __future__ import annotations

from evaluation.store import EvalStore


def _run_row(run_id="r1", batch="b1"):
    return {
        "run_id": run_id, "batch_id": batch, "model_name": "qwen2.5:latest",
        "model_source": "pretrained", "task": "test_plan", "item_id": "01-login",
        "repetition": 1, "started_at": "2026-07-25T00:00:00Z", "status": "ok",
        "latency_s": 1.25, "tokens_total": 800, "accuracy_score": 0.8, "overall_score": 0.75,
    }


def test_run_metrics_judgements_roundtrip(tmp_path):
    store = EvalStore(tmp_path / "e.sqlite")
    store.insert_run(_run_row())
    store.insert_metrics("r1", {
        "section_completeness": 0.9,
        "type_coverage": {"value": 0.66, "detail": {"matched": ["UI", "security"]}},
    })
    store.insert_judgements("r1", [
        {"dimension": "correctness", "score": 4, "max_score": 5, "rationale": "ok", "judge_model": "j"},
    ])

    runs = store.fetch_runs()
    assert len(runs) == 1 and runs[0]["model_name"] == "qwen2.5:latest"
    metrics = {m["metric_key"]: m for m in store.fetch_metrics("r1")}
    assert metrics["section_completeness"]["metric_value"] == 0.9
    assert metrics["type_coverage"]["detail_json"]  # structured detail persisted
    judged = store.fetch_judgements("r1")
    assert judged[0]["dimension"] == "correctness" and judged[0]["score"] == 4.0


def test_insert_run_ignores_unknown_keys(tmp_path):
    store = EvalStore(tmp_path / "e.sqlite")
    row = _run_row()
    row["not_a_column"] = "ignored"  # harness may pass a superset
    store.insert_run(row)
    assert len(store.fetch_runs()) == 1


def test_latest_batch_id(tmp_path):
    store = EvalStore(tmp_path / "e.sqlite")
    store.insert_run(_run_row(run_id="r1", batch="b1"))
    assert store.latest_batch_id() == "b1"
