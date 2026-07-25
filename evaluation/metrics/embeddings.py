"""Local text embeddings via Ollama, for semantic-similarity metrics.

Used by the Consistency metric (and available to any metric that needs semantic
comparison). Embeddings come from a local Ollama embedding model
(`nomic-embed-text` by default), so this is **fully offline** and adds no cloud
dependency. Everything is best-effort: if the model or service is unavailable,
functions return ``None`` and callers fall back to structural-only signals —
semantic similarity is never allowed to crash a run.
"""

from __future__ import annotations

import math

import httpx

DEFAULT_EMBEDDING_MODEL = "nomic-embed-text:latest"
DEFAULT_BASE_URL = "http://localhost:11434"


def embed_text(
    text: str,
    model: str = DEFAULT_EMBEDDING_MODEL,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> list[float] | None:
    """Return the embedding vector for ``text`` or ``None`` on any failure."""
    if not text or not text.strip():
        return None
    try:
        resp = httpx.post(
            f"{base_url.rstrip('/')}/api/embeddings",
            json={"model": model, "prompt": text},
            timeout=timeout,
        )
        resp.raise_for_status()
        vector = resp.json().get("embedding")
        return vector if vector else None
    except Exception:  # noqa: BLE001 - best-effort, never raise
        return None


def embed_many(
    texts: list[str],
    model: str = DEFAULT_EMBEDDING_MODEL,
    base_url: str = DEFAULT_BASE_URL,
) -> list[list[float] | None]:
    """Embed several texts (sequentially — the corpora here are tiny)."""
    return [embed_text(t, model=model, base_url=base_url) for t in texts]


def cosine(a: list[float] | None, b: list[float] | None) -> float | None:
    """Cosine similarity in [-1, 1], or ``None`` if either vector is missing."""
    if not a or not b or len(a) != len(b):
        return None
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return None
    return dot / (na * nb)


def mean_pairwise_cosine(vectors: list[list[float] | None]) -> float | None:
    """Mean cosine similarity over all unordered pairs of present vectors.

    Returns ``None`` when fewer than two vectors are available (no pair to
    compare) — the caller then omits the semantic component.
    """
    present = [v for v in vectors if v]
    if len(present) < 2:
        return None
    sims: list[float] = []
    for i in range(len(present)):
        for j in range(i + 1, len(present)):
            c = cosine(present[i], present[j])
            if c is not None:
                sims.append(c)
    return (sum(sims) / len(sims)) if sims else None
