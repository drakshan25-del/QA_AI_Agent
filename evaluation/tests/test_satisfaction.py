"""SUS scoring formula on known inputs (Brooke, 1996)."""

from __future__ import annotations

import pytest

from evaluation.metrics import satisfaction as sat


def test_sus_best_case_is_100():
    # Positive items (odd) = 5, negative items (even) = 1 -> perfect usability.
    responses = [5 if i % 2 == 0 else 1 for i in range(10)]
    assert sat.score_sus(responses) == 100.0


def test_sus_worst_case_is_0():
    responses = [1 if i % 2 == 0 else 5 for i in range(10)]
    assert sat.score_sus(responses) == 0.0


def test_sus_neutral_is_50():
    assert sat.score_sus([3] * 10) == 50.0


def test_sus_validates_length_and_range():
    with pytest.raises(ValueError):
        sat.score_sus([3] * 9)
    with pytest.raises(ValueError):
        sat.score_sus([6] + [3] * 9)


def test_build_record_validates_and_shapes():
    rec = sat.build_record(
        model_name="qwen2.5:latest", rater_id="p01", collected_at="2026-08-01T00:00:00Z",
        sus_responses=[3] * 10, likert={"usefulness": 4, "trust": 3},
    )
    assert rec["sus_score"] == 50.0 and rec["model_name"] == "qwen2.5:latest"
    with pytest.raises(ValueError):
        sat.build_record(
            model_name="m", rater_id="p", collected_at="t",
            sus_responses=[3] * 10, likert={"unknown_dim": 3},
        )
