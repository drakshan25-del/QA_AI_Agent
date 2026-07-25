"""Experiment orchestrator: model × task × item × repetition → score → persist.

This is the deterministic control loop of the study. For every combination it
runs the task, scores it (deterministic gate + optional held-out judge, blended
per the versioned rubric), persists the raw artefact and every measurement, and
moves on. A single failed generation is recorded (``status="failed"``) and never
aborts the batch — so partial results are always usable and failures become
data for the "where do pre-trained models fail" question.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.logging import get_logger
from evaluation.benchmark import BenchmarkItem, load_suite
from evaluation.config import EvalConfig
from evaluation.metrics import deterministic, rubric
from evaluation.metrics.judge import is_judge_available, judge_output
from evaluation.metrics.speed import speed_metrics
from evaluation.models import get_model, slow_model_names
from evaluation.runners import get_runner
from evaluation.store import EvalStore

logger = get_logger(__name__)

_SAFE = re.compile(r"[^A-Za-z0-9]+")


def _slug(text: str) -> str:
    return _SAFE.sub("-", text).strip("-")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Harness:
    """Runs an :class:`EvalConfig` experiment and writes results to the store."""

    def __init__(self, config: EvalConfig) -> None:
        config.validate()
        config.ensure_dirs()
        self.config = config
        self.store = EvalStore(config.db_path)
        self.items = load_suite(config.benchmark_dir)

    def run(self, item_ids: list[str] | None = None) -> str:
        """Execute the full experiment; returns the batch id.

        Args:
            item_ids: Optional subset of benchmark item ids to run.
        """
        cfg = self.config
        items = self._select_items(item_ids)
        models = self._model_list()
        batch_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:6]}"

        judge_ok = cfg.use_judge and is_judge_available(cfg.judge_model)
        if cfg.use_judge and not judge_ok:
            logger.warning(
                "judge model '%s' unavailable — proceeding with deterministic-only "
                "accuracy (offline-safe).", cfg.judge_model
            )

        def _runs_for(model_name: str) -> int:
            reps = cfg.reps_for(model_name)
            return sum(
                reps
                for task in cfg.tasks
                for item in items
                if not (task == "automation" and not item.reference_test_cases)
            )

        total = sum(_runs_for(m) for m in models)
        print(
            f"[eval] batch {batch_id}: {len(models)} model(s) × {len(cfg.tasks)} task(s) "
            f"× {len(items)} item(s) = {total} runs "
            f"(reps≤{cfg.repetitions}, judge={'on' if judge_ok else 'off'})"
        )

        done = 0
        for model_name in models:
            spec = get_model(model_name)
            for task in cfg.tasks:
                runner = get_runner(task)
                for item in items:
                    if task == "automation" and not item.reference_test_cases:
                        logger.info("skip automation for %s (no reference cases)", item.id)
                        continue
                    for rep in range(1, cfg.reps_for(spec.name) + 1):
                        done += 1
                        self._run_one(batch_id, spec, task, runner, item, rep, judge_ok, done, total)

        print("[eval] computing cross-run aggregates (consistency, reliability, research score)…")
        self._compute_aggregates(batch_id)
        if cfg.robustness:
            print("[eval] robustness mode: evaluating prompt variants…")
            self._compute_robustness(batch_id, models, items)
        print(f"[eval] batch {batch_id} complete → {cfg.db_path}")
        return batch_id

    # -- internals --------------------------------------------------------
    def _select_items(self, item_ids: list[str] | None) -> list[BenchmarkItem]:
        if not item_ids:
            return self.items
        wanted = set(item_ids)
        chosen = [i for i in self.items if i.id in wanted]
        missing = wanted - {i.id for i in chosen}
        if missing:
            raise ValueError(f"unknown benchmark item id(s): {sorted(missing)}")
        return chosen

    def _model_list(self) -> list[str]:
        """Models to evaluate, honouring ``--skip-slow-models``."""
        models = list(self.config.models)
        if self.config.skip_slow_models:
            slow = set(slow_model_names())
            dropped = [m for m in models if m in slow]
            models = [m for m in models if m not in slow]
            if dropped:
                logger.warning("skip_slow_models: excluding %s", dropped)
        return models

    def _compute_aggregates(self, batch_id: str) -> None:
        """Post-batch pass: consistency, reliability, and the rolled-up research score."""
        from evaluation.metrics import consistency as consistency_mod
        from evaluation.metrics import reliability as reliability_mod
        from evaluation.metrics.aggregate import build_run_frame

        df = build_run_frame(self.store, batch_id)
        if df.empty:
            return
        rows: list[dict] = []

        reliability = reliability_mod.compute(df)
        rel_map = {(r["model_name"], r["task"]): r for r in reliability}
        rows += [
            {"batch_id": batch_id, "model_name": r["model_name"], "task": r["task"],
             "metric_key": "reliability", "value": r["score"], "detail": r["detail"]}
            for r in reliability
        ]

        consistency: list[dict] = []
        try:
            consistency = consistency_mod.compute(self.store, batch_id, self.config)
        except Exception as exc:  # noqa: BLE001 - consistency is best-effort
            logger.warning("consistency computation skipped: %s", exc)
        con_map = {(c["model_name"], c["task"]): c for c in consistency}
        rows += [
            {"batch_id": batch_id, "model_name": c["model_name"], "task": c["task"],
             "metric_key": "consistency", "value": c["score"], "detail": c["detail"]}
            for c in consistency
        ]

        # Overall Research Score per (model, task): mean per-run dims + cohort speed
        # + consistency + reliability (satisfaction pending).
        ok = df[df["ok"]]
        for (model, task), g in ok.groupby(["model_name", "task"]):
            con = con_map.get((model, task))
            rel = rel_map.get((model, task))
            dims = {
                "accuracy": _mean(g, "accuracy_score"),
                "completeness": _pct(_mean(g, "metric_completeness_pct")),
                "requirement_coverage": _pct(_mean(g, "metric_requirement_coverage_pct")),
                "hallucination": _clean(_mean(g, "metric_hallucination_rate_pct")),
                "code_quality": _mean(g, "metric_code_quality"),
                "executability": _mean(g, "metric_executability_score"),
                "speed": _mean(g, "speed_score"),
                "consistency": (con["score"] / 100.0) if con else None,
                "reliability": rel["score"] if rel else None,
            }
            dims = {k: v for k, v in dims.items() if v is not None}
            research = rubric.blend_research_score(dims)
            rows.append({
                "batch_id": batch_id, "model_name": model, "task": task,
                "metric_key": "research_score", "value": research, "detail": {"dims": dims},
            })

        self.store.insert_aggregate_metrics(rows)

    def _compute_robustness(self, batch_id: str, models: list[str], items: list[BenchmarkItem]) -> None:
        """Opt-in: run each item's prompt variants and score quality stability.

        Uses deterministic-only accuracy + completeness (no judge) so robustness
        stays fast and offline. Variant generations are not stored as ``runs`` —
        only a per-(model, task, item) robustness row lands in aggregate_metrics.
        """
        from evaluation.metrics import completeness as comp_mod
        from evaluation.metrics import robustness as rob

        cfg = self.config
        targets = [it for it in items if it.robustness_variants]
        if not targets:
            logger.warning("robustness requested but no benchmark item has variants")
            return

        rows: list[dict] = []
        for model_name in models:
            spec = get_model(model_name)
            for task in cfg.tasks:
                runner = get_runner(task)
                for item in targets:
                    if task == "automation" and not item.reference_test_cases:
                        continue
                    variants = [("base", item)] + [
                        (v.id, item.with_requirement(v.requirement)) for v in item.robustness_variants
                    ]
                    qualities: list[float | None] = []
                    per_variant: list[dict] = []
                    for vid, vitem in variants:
                        res = runner.run(vitem, spec.ollama_tag)
                        if not res.ok:
                            qualities.append(0.0)  # failure = maximal instability
                            per_variant.append({"variant": vid, "status": "failed", "quality": 0.0})
                            continue
                        det = deterministic.score_task(task, res.output_dict, vitem, cfg.run_collection)
                        acc = rubric.blend_accuracy(task, det["scores"])
                        comp = comp_mod.score_completeness(task, res.output_dict, vitem)["score"]
                        q = rob.quality(acc, comp)
                        qualities.append(q)
                        per_variant.append({"variant": vid, "quality": q, "accuracy_det": acc, "completeness": comp})
                    score = rob.robustness_score(qualities)
                    rows.append({
                        "batch_id": batch_id, "model_name": model_name, "task": task, "item_id": item.id,
                        "metric_key": "robustness", "value": score,
                        "detail": {"variants": per_variant},
                    })
                    logger.info("robustness %s/%s/%s = %s", model_name, task, item.id, score)
        self.store.insert_aggregate_metrics(rows)

    def _run_one(self, batch_id, spec, task, runner, item, rep, judge_ok, done, total) -> None:
        cfg = self.config
        run_id = _slug(f"{batch_id}_{spec.name}_{task}_{item.id}_r{rep}")
        started = _now()
        result = runner.run(item, spec.ollama_tag)

        det_scores: dict = {}
        det_detail: dict = {}
        judge_result: dict = {"scores": {}, "judgements": [], "detail": {}, "hallucinations": []}
        accuracy = None
        research_score = None
        research_metrics: dict = {}
        research_details: dict = {}

        if result.ok:
            det = deterministic.score_task(task, result.output_dict, item, cfg.run_collection)
            det_scores = det["scores"]
            det_detail = det["detail"]
            exec_result = None
            if task == "automation" and cfg.run_execution:
                from evaluation.metrics.execution import run_execution

                exec_result = run_execution(result.output_dict.get("files") or [])
                det_scores["execution_success"] = exec_result["value"]
                det_detail["execution"] = exec_result["detail"]
            if judge_ok:
                judge_result = judge_output(task, item, result.raw_text, cfg.judge_model)
            sub_scores = {k: v for k, v in {**det_scores, **judge_result["scores"]}.items() if v is not None}
            accuracy = rubric.blend_accuracy(task, sub_scores)

            # Research-grade per-run metrics (completeness, coverage, hallucination,
            # code quality, explainability, executability) and the per-run research score.
            dims, research_metrics, research_details = _research_metrics(
                task, result.output_dict, result.raw_text, item, det_detail, judge_result, exec_result
            )
            dims["accuracy"] = accuracy
            research_score = rubric.blend_research_score({k: v for k, v in dims.items() if v is not None})

        raw_path = self._persist_raw(run_id, result.raw_text) if result.raw_text else None
        speed = speed_metrics(result.latency_s, result.tokens)

        self.store.insert_run({
            "run_id": run_id, "batch_id": batch_id,
            "model_name": spec.name, "model_source": spec.source,
            "task": task, "item_id": item.id, "repetition": rep,
            "prompt_version": _prompt_version(task), "rubric_version": rubric.RUBRIC_VERSION,
            "temperature": cfg.temperature, "started_at": started, "finished_at": _now(),
            "latency_s": result.latency_s,
            "tokens_prompt": result.tokens.get("tokens_prompt"),
            "tokens_completion": result.tokens.get("tokens_completion"),
            "tokens_total": result.tokens.get("tokens_total"),
            "tokens_per_s": speed["tokens_per_s"], "retries": result.retries,
            "status": result.status, "error": result.error, "raw_path": raw_path,
            "accuracy_score": accuracy, "overall_score": None,  # cohort-relative, set at aggregation
            "research_score": research_score,
        })

        metrics: dict = dict(det_scores)
        metrics.update(research_metrics)
        if speed["tokens_per_s"] is not None:
            metrics["tokens_per_s"] = speed["tokens_per_s"]
        if det_detail:
            metrics["deterministic_detail"] = {"value": None, "detail": det_detail}
        if judge_result["detail"]:
            metrics["judge_detail"] = {"value": None, "detail": judge_result["detail"]}
        if research_details:
            metrics["research_detail"] = {"value": None, "detail": research_details}
        self.store.insert_metrics(run_id, metrics)
        self.store.insert_judgements(run_id, judge_result["judgements"])

        acc_str = f"{accuracy:.2f}" if accuracy is not None else "  – "
        rsc_str = f"{research_score:.2f}" if research_score is not None else "  – "
        status_mark = "ok " if result.ok else "FAIL"
        print(
            f"[eval] {done:>3}/{total}  {status_mark}  {spec.name:<22} {task:<11} "
            f"{item.id:<16} acc={acc_str} research={rsc_str}  {result.latency_s:5.1f}s"
            + ("" if result.ok else f"  ({result.error})")
        )

    def _persist_raw(self, run_id: str, raw_text: str) -> str:
        """Save the raw artefact for evidence; return a repo-relative path."""
        from evaluation.config import REPO_ROOT

        path = self.config.raw_dir / f"{run_id}.txt"
        path.write_text(raw_text, encoding="utf-8")
        try:
            return str(path.relative_to(REPO_ROOT))
        except ValueError:
            return str(path)


def _research_metrics(task, output_dict, raw_text, item, det_detail, judge_result, exec_result):
    """Compute the research-grade per-run metrics.

    Returns ``(dims, metrics, details)`` where ``dims`` are the 0..1 sub-scores
    that feed the research-score blend, ``metrics`` are scalar values to persist,
    and ``details`` is a structured breakdown for audit.
    """
    from evaluation.metrics import code_quality as cq_mod
    from evaluation.metrics import completeness as comp_mod
    from evaluation.metrics import coverage as cov_mod
    from evaluation.metrics import explainability as expl_mod
    from evaluation.metrics import hallucination as hall_mod
    from evaluation.metrics.execution import score_executability

    comp = comp_mod.score_completeness(task, output_dict, item)
    cov = cov_mod.score_coverage(task, raw_text, item)
    hall = hall_mod.score_hallucination(task, output_dict, judge_result.get("hallucinations"))
    expl = expl_mod.score_explainability(task, output_dict, raw_text, judge_result["scores"])

    dims = {
        "completeness": comp["score"],
        "requirement_coverage": cov["score"],
        "hallucination": hall["score"],  # cleanliness
    }
    metrics: dict = {}
    details: dict = {}
    for name, res in (("completeness", comp), ("coverage", cov), ("hallucination", hall), ("explainability", expl)):
        metrics.update(res["metrics"])
        details[name] = res["detail"]

    if task == "automation":
        cq = cq_mod.score_code_quality(output_dict, judge_result["scores"])
        exe = score_executability(det_detail, exec_result)
        dims["code_quality"] = cq["score"]
        dims["executability"] = exe["score"]
        metrics.update(cq["metrics"])
        metrics.update(exe["metrics"])
        details["code_quality"] = cq["detail"]
        details["executability"] = exe["detail"]

    return dims, metrics, details


def _mean(group, col):
    """Mean of a DataFrame column if present and non-null, else None."""
    import pandas as pd

    if col not in group:
        return None
    val = group[col].mean()
    return None if pd.isna(val) else float(val)


def _pct(value):
    """Convert a 0–100 percentage mean to a 0..1 score (None-safe)."""
    return None if value is None else value / 100.0


def _clean(rate_pct):
    """Convert a hallucination rate % to cleanliness (1 − rate), None-safe."""
    return None if rate_pct is None else max(0.0, 1.0 - rate_pct / 100.0)


def _prompt_version(task: str) -> str | None:
    """Record the agent's own prompt version for provenance (NFR-EXP-001)."""
    try:
        if task == "test_plan":
            from agents.test_plan_agent import PROMPT_VERSION
            return PROMPT_VERSION
        if task == "test_cases":
            from agents.test_case_agent import PROMPT_VERSION
            return PROMPT_VERSION
    except Exception:  # noqa: BLE001
        return None
    return None
