"""Load and validate the benchmark suite from YAML.

Keeping the suite in YAML (data) rather than Python (code) means non-programmers
can extend it and it can be versioned/diffed as an experimental asset. Every
file is validated against :class:`BenchmarkItem` on load, so a malformed item
fails fast with a clear error instead of corrupting a run midway.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from evaluation.benchmark.schema import BenchmarkItem


def load_suite(benchmark_dir: Path | str) -> list[BenchmarkItem]:
    """Load every ``*.yaml`` item under ``benchmark_dir``, sorted by id.

    Args:
        benchmark_dir: Directory containing one YAML document per item.

    Returns:
        Validated benchmark items sorted by ``id`` for deterministic ordering.

    Raises:
        FileNotFoundError: If the directory does not exist.
        ValueError: If it contains no items, an item is malformed, or two items
            share an ``id`` (which would collide in the results store).
    """
    directory = Path(benchmark_dir)
    if not directory.is_dir():
        raise FileNotFoundError(f"benchmark directory not found: {directory}")

    items: list[BenchmarkItem] = []
    for path in sorted(directory.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if raw is None:
            continue
        try:
            items.append(BenchmarkItem.model_validate(raw))
        except Exception as exc:  # noqa: BLE001 - re-raised with the offending file
            raise ValueError(f"invalid benchmark item in {path.name}: {exc}") from exc

    if not items:
        raise ValueError(f"no benchmark items found in {directory}")

    seen: set[str] = set()
    duplicates = {i.id for i in items if i.id in seen or seen.add(i.id)}
    if duplicates:
        raise ValueError(f"duplicate benchmark item id(s): {sorted(duplicates)}")

    return sorted(items, key=lambda i: i.id)
