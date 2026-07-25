"""Benchmark loader: the suite parses, validates and de-duplicates ids."""

from __future__ import annotations

import textwrap

import pytest

from evaluation.benchmark import load_suite
from evaluation.config import DEFAULT_BENCHMARK_DIR


def test_suite_loads_and_is_well_formed():
    items = load_suite(DEFAULT_BENCHMARK_DIR)
    assert len(items) >= 6
    ids = [i.id for i in items]
    assert len(ids) == len(set(ids)), "ids must be unique"
    # Every item carries the fixed inputs and ground truth the harness relies on.
    for item in items:
        assert item.requirement.id and item.requirement.text
        assert item.coverage_checklist, f"{item.id} has no coverage checklist"
        assert item.expected_test_types, f"{item.id} has no expected test types"


def test_duplicate_ids_rejected(tmp_path):
    for name in ("a.yaml", "b.yaml"):
        (tmp_path / name).write_text(
            textwrap.dedent(
                """
                id: "dup"
                title: "t"
                project_name: "p"
                base_url: "http://localhost:8001"
                requirement: {id: "R", text: "some requirement text"}
                """
            ).strip(),
            encoding="utf-8",
        )
    with pytest.raises(ValueError, match="duplicate"):
        load_suite(tmp_path)


def test_empty_dir_rejected(tmp_path):
    with pytest.raises(ValueError, match="no benchmark items"):
        load_suite(tmp_path)
