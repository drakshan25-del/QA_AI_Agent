"""Pydantic schema for benchmark items (the experiment's fixed inputs + truth).

A :class:`BenchmarkItem` is deliberately self-contained: it carries the fixed
input for *each* of the three tasks so they can be evaluated independently and
comparably across models. In particular the automation task consumes
``reference_test_cases`` (a canonical, human-vetted set) rather than each model's
own Task-2 output, isolating "can the model write valid automation" from "did it
write good cases".
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChecklistItem(BaseModel):
    """One required scenario the generated artefact should cover.

    Attributes:
        id: Stable id (e.g. ``invalid-login``) referenced in scoring output.
        description: Human-readable scenario a good artefact must address.
        keywords: Lowercase cues enabling an optional deterministic keyword
            match as a cheap, judge-independent coverage signal.
    """

    id: str
    description: str
    keywords: list[str] = Field(default_factory=list)


class Requirement(BaseModel):
    """The requirement fed to the plan/case agents (matches their dict shape)."""

    id: str
    title: str = ""
    text: str
    acceptance_criteria: list[str] = Field(default_factory=list)


class PromptVariant(BaseModel):
    """A controlled perturbation of an item's requirement, for the Robustness metric.

    Each variant expresses the SAME underlying requirement in a different way
    (paraphrase / terse / verbose / missing optional info). The ground truth
    (checklist, acceptance criteria) is unchanged, so a robust model should
    produce output of similar quality across all variants.
    """

    id: str
    kind: str = Field(default="paraphrase", description="paraphrase|terse|verbose|missing_info")
    requirement: Requirement


class BenchmarkItem(BaseModel):
    """A single benchmark task instance and its ground truth."""

    id: str
    title: str
    user_story: str = Field(
        default="", description="The 'As a … I want … so that …' narrative"
    )

    # Fixed inputs (identical across every model, for comparability).
    project_name: str
    base_url: str
    allowed_domains: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    requirement: Requirement
    analysis: dict | None = Field(
        default=None,
        description="Optional fixed requirement-analysis dict; None = raw requirement only",
    )
    reference_test_cases: list[dict] = Field(
        default_factory=list,
        description="Canonical approved cases fed to the automation task (fixed input)",
    )

    # Ground truth (coverage-checklist strategy, not gold artefacts).
    coverage_checklist: list[ChecklistItem] = Field(default_factory=list)
    expected_test_types: list[str] = Field(
        default_factory=list, description="Test-plan types a good plan should justify"
    )
    expected_categories: list[str] = Field(
        default_factory=list, description="Test-case categories a good set should include"
    )
    min_cases: int = Field(default=8, description="Minimum cases requested from the model")
    robustness_variants: list[PromptVariant] = Field(
        default_factory=list,
        description="Controlled prompt perturbations for the opt-in Robustness metric",
    )

    def requirement_dict(self) -> dict:
        """The requirement as the agents expect it (plain dict)."""
        return self.requirement.model_dump()

    def with_requirement(self, requirement: Requirement) -> "BenchmarkItem":
        """A copy of this item with its requirement replaced (for robustness variants)."""
        return self.model_copy(update={"requirement": requirement})
