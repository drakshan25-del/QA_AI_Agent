"""User-satisfaction instrument: System Usability Scale (SUS) + 5-point Likert.

Research-integrity note
-----------------------
Satisfaction is a *human* measurement. This module builds the **instrument and
scoring pipeline** so the later user study can capture and persist real ratings
consistently — it deliberately generates **no** satisfaction data itself. Until
participants provide ratings, the dashboard reports satisfaction as "pending".

SUS scoring (Brooke, 1996): ten items on a 1–5 agreement scale, alternating
positive/negative wording. Odd (positive) items contribute ``response − 1``;
even (negative) items contribute ``5 − response``. Summing the ten contributions
(0–40) and multiplying by 2.5 yields the 0–100 SUS score.
"""

from __future__ import annotations

from collections.abc import Sequence

#: The ten standard SUS statements (odd = positive, even = negative), phrased for
#: an AI QA assistant. Order matters for the scoring formula.
SUS_ITEMS: list[str] = [
    "I think that I would like to use this AI QA assistant frequently.",              # 1 +
    "I found the AI QA assistant unnecessarily complex.",                             # 2 -
    "I thought the AI QA assistant was easy to use.",                                 # 3 +
    "I think I would need support to be able to use this AI QA assistant.",           # 4 -
    "I found the various functions of the assistant were well integrated.",           # 5 +
    "I thought there was too much inconsistency in the assistant.",                   # 6 -
    "I would imagine most QA engineers would learn to use this assistant quickly.",   # 7 +
    "I found the AI QA assistant very cumbersome to use.",                            # 8 -
    "I felt very confident using the AI QA assistant.",                               # 9 +
    "I needed to learn a lot before I could get going with the assistant.",           # 10 -
]

#: 5-point Likert dimensions collected per model/task alongside SUS.
LIKERT_DIMENSIONS: list[str] = [
    "usefulness",       # Are the generated artefacts useful for real QA work?
    "readability",      # Are they clear and easy to read?
    "trust",            # Would you trust them enough to use with review?
    "accuracy",         # Do they correctly reflect the requirement?
    "overall_quality",  # Overall quality of the artefact.
]

LIKERT_SCALE = {
    1: "Strongly disagree",
    2: "Disagree",
    3: "Neutral",
    4: "Agree",
    5: "Strongly agree",
}


def score_sus(responses: Sequence[int]) -> float:
    """Compute the 0–100 SUS score from ten 1–5 responses.

    Args:
        responses: Ten integers (1–5), in :data:`SUS_ITEMS` order.

    Returns:
        SUS score in [0, 100].

    Raises:
        ValueError: If not exactly ten responses, or any is outside 1–5.
    """
    if len(responses) != len(SUS_ITEMS):
        raise ValueError(f"SUS needs exactly {len(SUS_ITEMS)} responses, got {len(responses)}")
    if any(not (1 <= r <= 5) for r in responses):
        raise ValueError("every SUS response must be an integer in 1..5")
    total = 0
    for index, response in enumerate(responses):
        if index % 2 == 0:  # odd item (1-based) = positive
            total += response - 1
        else:               # even item (1-based) = negative
            total += 5 - response
    return round(total * 2.5, 2)


def questionnaire_template() -> dict:
    """A blank questionnaire for the user study (structure the UI/form mirrors)."""
    return {
        "sus": [{"index": i + 1, "statement": s, "response": None} for i, s in enumerate(SUS_ITEMS)],
        "likert": [{"dimension": d, "response": None} for d in LIKERT_DIMENSIONS],
        "scale": LIKERT_SCALE,
    }


def build_record(
    *,
    model_name: str,
    rater_id: str,
    collected_at: str,
    sus_responses: Sequence[int],
    likert: dict[str, int],
    task: str | None = None,
    batch_id: str | None = None,
) -> dict:
    """Validate a real rating and shape it for :meth:`EvalStore.insert_satisfaction`.

    Raises:
        ValueError: On malformed SUS responses or out-of-range Likert values.
    """
    sus_score = score_sus(sus_responses)
    for dim, val in likert.items():
        if dim not in LIKERT_DIMENSIONS:
            raise ValueError(f"unknown Likert dimension '{dim}'")
        if not (1 <= val <= 5):
            raise ValueError(f"Likert '{dim}' must be 1..5, got {val}")
    return {
        "batch_id": batch_id,
        "model_name": model_name,
        "task": task,
        "rater_id": rater_id,
        "sus_score": sus_score,
        "sus_items": list(sus_responses),
        "likert": likert,
        "collected_at": collected_at,
    }
