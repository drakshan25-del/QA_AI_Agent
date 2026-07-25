"""Rubric blending: missing dimensions drop out and weights renormalise."""

from __future__ import annotations

import pytest

from evaluation.metrics import rubric


def test_blend_accuracy_full_vs_partial():
    full = {
        "section_completeness": 1.0, "type_coverage": 1.0,
        "judge_correctness": 1.0, "judge_coverage": 1.0, "judge_readability": 1.0,
    }
    assert rubric.blend_accuracy("test_plan", full) == 1.0

    # Judge disabled: only deterministic sub-scores present -> renormalised mean.
    det_only = {"section_completeness": 1.0, "type_coverage": 0.0}
    got = rubric.blend_accuracy("test_plan", det_only)
    # weights 0.30 and 0.20 -> (0.30*1 + 0.20*0) / 0.50 = 0.6
    assert got == pytest.approx(0.6)


def test_blend_accuracy_none_when_nothing_measured():
    assert rubric.blend_accuracy("automation", {}) is None


def test_blend_overall_drops_absent_satisfaction():
    # accuracy 0.8, speed 0.6, satisfaction absent -> weights 0.60/0.15 renormalise
    got = rubric.blend_overall(0.8, 0.6, None)
    expected = (0.60 * 0.8 + 0.15 * 0.6) / (0.60 + 0.15)
    assert got == pytest.approx(expected)


def test_unknown_task_raises():
    with pytest.raises(KeyError):
        rubric.blend_accuracy("nope", {})
