"""Robustness math + benchmark variant loading."""

from __future__ import annotations

from evaluation.benchmark import load_suite
from evaluation.config import DEFAULT_BENCHMARK_DIR
from evaluation.metrics import robustness as rob


def test_robustness_score_stability():
    assert rob.robustness_score([0.8, 0.8, 0.8]) == 1.0            # identical → perfectly stable
    assert rob.robustness_score([1.0, 0.0]) == 0.0                 # σ=0.5 → 0
    assert rob.robustness_score([0.9]) is None                     # need ≥2
    mid = rob.robustness_score([0.9, 0.7])                         # σ=0.1 → 1−0.2=0.8
    assert abs(mid - 0.8) < 1e-6


def test_quality_blend():
    assert rob.quality(0.8, 0.6) == 0.7
    assert rob.quality(None, 0.6) == 0.6
    assert rob.quality(None, None) is None


def test_benchmark_items_have_variants():
    items = {i.id: i for i in load_suite(DEFAULT_BENCHMARK_DIR)}
    login = items["01-login"]
    assert len(login.robustness_variants) >= 3
    # with_requirement produces a copy carrying the same ground truth
    v = login.robustness_variants[0]
    variant_item = login.with_requirement(v.requirement)
    assert variant_item.coverage_checklist == login.coverage_checklist
    assert variant_item.requirement.text != login.requirement.text
