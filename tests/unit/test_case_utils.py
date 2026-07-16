"""Unit tests for the Test Case Agent's pure helpers (FR-TC-004, FR-TC-006).

``find_duplicate_cases`` and ``coverage_report`` are deterministic Python —
no LLM call is made here (SRS §15.1, NFR-MNT-003).
"""

from __future__ import annotations

import pytest

from agents.test_case_agent import (
    DUPLICATE_THRESHOLD,
    coverage_report,
    find_duplicate_cases,
)
# Aliased so pytest does not try to collect the imported pydantic model.
from app.models.schemas import TestCaseOutput as CaseOutput

pytestmark = pytest.mark.unit


def _case(title: str, steps: list[str], requirement_ids: list[str] | None = None) -> CaseOutput:
    return CaseOutput(title=title, steps=steps, requirement_ids=requirement_ids or [])


LOGIN_STEPS = [
    "Open the login page",
    "Enter valid credentials from environment variables",
    "Click the Log in button",
]


class TestFindDuplicateCases:
    def test_near_identical_cases_flagged(self):
        a = _case("Valid login shows welcome", LOGIN_STEPS)
        b = _case("Valid login shows welcome message", LOGIN_STEPS)
        c = _case(
            "Delete removes an item",
            ["Log in", "Click Delete on the first item", "Verify the item is gone"],
        )
        pairs = find_duplicate_cases([a, b, c])
        assert len(pairs) == 1
        idx_a, idx_b, similarity = pairs[0]
        assert (idx_a, idx_b) == (0, 1)
        assert similarity >= DUPLICATE_THRESHOLD

    def test_distinct_cases_not_flagged(self):
        a = _case("Valid login shows welcome", LOGIN_STEPS)
        c = _case(
            "Adding an item shows it once",
            ["Log in", "Type a new item", "Click Add", "Verify it appears exactly once"],
        )
        assert find_duplicate_cases([a, c]) == []

    def test_case_insensitive_comparison(self):
        a = _case("VALID LOGIN SHOWS WELCOME", [s.upper() for s in LOGIN_STEPS])
        b = _case("valid login shows welcome", [s.lower() for s in LOGIN_STEPS])
        pairs = find_duplicate_cases([a, b])
        assert pairs and pairs[0][2] == 1.0

    def test_threshold_parameter_respected(self):
        a = _case("Valid login shows welcome", LOGIN_STEPS)
        b = _case("Valid login shows welcome message", LOGIN_STEPS)
        assert find_duplicate_cases([a, b], threshold=0.999) == []

    def test_pairs_sorted_by_descending_similarity(self):
        a = _case("Valid login shows welcome", LOGIN_STEPS)
        b = _case("Valid login shows welcome message", LOGIN_STEPS)
        d = _case("Valid login shows welcome", LOGIN_STEPS)  # exact clone of a
        pairs = find_duplicate_cases([a, b, d])
        sims = [p[2] for p in pairs]
        assert sims == sorted(sims, reverse=True)
        assert pairs[0][2] == 1.0  # the exact clone pair ranks first

    def test_empty_and_single_input(self):
        assert find_duplicate_cases([]) == []
        assert find_duplicate_cases([_case("Only one", ["step"])]) == []


class TestCoverageReport:
    def test_partial_coverage_math(self):
        cases = [
            _case("Login works", LOGIN_STEPS, requirement_ids=["R1"]),
            _case("Logout works", ["Click logout"], requirement_ids=["R2", "R1"]),
        ]
        report = coverage_report(["R1", "R2", "R3"], cases)
        assert report["covered"] == ["R1", "R2"]
        assert report["uncovered"] == ["R3"]
        assert report["coverage_pct"] == pytest.approx(66.7)

    def test_full_coverage(self):
        cases = [_case("Login works", LOGIN_STEPS, requirement_ids=["R1"])]
        report = coverage_report(["R1"], cases)
        assert report["coverage_pct"] == 100.0
        assert report["uncovered"] == []

    def test_zero_coverage(self):
        report = coverage_report(["R1", "R2"], [])
        assert report["covered"] == []
        assert report["uncovered"] == ["R1", "R2"]
        assert report["coverage_pct"] == 0.0

    def test_no_requirements_is_vacuously_full(self):
        report = coverage_report([], [])
        assert report["coverage_pct"] == 100.0

    def test_duplicate_requirement_ids_deduplicated(self):
        cases = [_case("Login works", LOGIN_STEPS, requirement_ids=["R1"])]
        report = coverage_report(["R1", "R1", "R2"], cases)
        assert report["covered"] == ["R1"]
        assert report["uncovered"] == ["R2"]
        assert report["coverage_pct"] == pytest.approx(50.0)

    def test_case_referencing_unknown_requirement_ignored(self):
        cases = [_case("Login works", LOGIN_STEPS, requirement_ids=["R9"])]
        report = coverage_report(["R1"], cases)
        assert report["covered"] == []
        assert report["coverage_pct"] == 0.0
