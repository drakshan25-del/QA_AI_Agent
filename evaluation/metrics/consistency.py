"""Consistency — stability of outputs across repeated runs of the same prompt.

Research purpose: LLMs are stochastic; a model that yields wildly different QA
artefacts on identical input is hard to trust or reproduce. Following the
self-consistency idea (Wang et al., 2022), we quantify agreement across the N
repetitions of each (model, task, item) three ways and blend them into a 0–100
score:

* **Structural** — mean pairwise ``difflib`` ratio on normalised output text.
* **Semantic** — mean pairwise cosine of local ``nomic-embed-text`` embeddings
  (offline; omitted if embeddings are unavailable).
* **Coverage stability** — 1 − stdev of requirement-coverage across reps.

Scores are computed per (model, task, item) then averaged to (model, task).
Requires ≥2 successful reps; otherwise the pair is skipped (logged by caller).
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from evaluation.benchmark import load_suite
from evaluation.config import REPO_ROOT, EvalConfig
from evaluation.metrics import coverage as coverage_mod
from evaluation.metrics import embeddings as emb
from evaluation.store import EvalStore

#: Component weights (renormalised over whichever components are available).
_WEIGHTS = {"structural": 0.4, "semantic": 0.4, "coverage_stability": 0.2}


def _read_raw(raw_path: str | None) -> str:
    if not raw_path:
        return ""
    p = Path(raw_path)
    if not p.is_absolute():
        p = REPO_ROOT / p
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def _normalise(text: str) -> str:
    return " ".join(text.split()).lower()


def _mean_pairwise_ratio(texts: list[str]) -> float | None:
    norm = [_normalise(t) for t in texts if t.strip()]
    if len(norm) < 2:
        return None
    ratios = [
        SequenceMatcher(None, norm[i], norm[j]).ratio()
        for i in range(len(norm)) for j in range(i + 1, len(norm))
    ]
    return sum(ratios) / len(ratios) if ratios else None


def compute(store: EvalStore, batch_id: str, config: EvalConfig) -> list[dict]:
    """Return per-(model, task) consistency rows: ``{model_name, task, score, detail}``."""
    items = {i.id: i for i in load_suite(config.benchmark_dir)}
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in store.fetch_runs(batch_id):
        if r["status"] == "ok":
            groups[(r["model_name"], r["task"], r["item_id"])].append(r)

    per_model_task: dict[tuple, list[float]] = defaultdict(list)
    details: dict[tuple, list[dict]] = defaultdict(list)

    for (model, task, item_id), runs in groups.items():
        if len(runs) < 2:
            continue
        texts = [_read_raw(r.get("raw_path")) for r in runs]

        structural = _mean_pairwise_ratio(texts)
        vectors = emb.embed_many(texts, model=config.embedding_model)
        semantic = emb.mean_pairwise_cosine(vectors)

        item = items.get(item_id)
        coverage_stability = None
        if item is not None:
            cov_scores = [coverage_mod.score_coverage(task, t, item)["score"] for t in texts if t.strip()]
            if len(cov_scores) >= 2:
                coverage_stability = max(0.0, 1.0 - statistics.pstdev(cov_scores))

        components = {
            "structural": structural,
            "semantic": (semantic + 1) / 2 if semantic is not None else None,  # map [-1,1]→[0,1]
            "coverage_stability": coverage_stability,
        }
        present = {k: v for k, v in components.items() if v is not None}
        if not present:
            continue
        weight = sum(_WEIGHTS[k] for k in present)
        score01 = sum(_WEIGHTS[k] * v for k, v in present.items()) / weight
        per_model_task[(model, task)].append(score01)
        details[(model, task)].append({
            "item_id": item_id, "reps": len(runs),
            "components": {k: round(v, 4) for k, v in present.items()},
        })

    out: list[dict] = []
    for (model, task), scores in per_model_task.items():
        mean01 = sum(scores) / len(scores)
        out.append({
            "model_name": model,
            "task": task,
            "score": round(mean01 * 100, 2),  # 0–100 consistency score
            "detail": {"items": details[(model, task)], "n_items": len(scores)},
        })
    return out
