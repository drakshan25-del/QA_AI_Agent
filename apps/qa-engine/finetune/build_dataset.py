"""Build chat-format JSONL fine-tuning datasets for the two QA models.

* ``planner`` (qwen2.5): test-case generation + test-plan generation, using
  the REAL prompts from ``agents.test_case_agent`` / ``agents.test_plan_agent``.
* ``coder`` (qwen2.5-coder): automation generation, using the REAL prompts
  from ``agents.automation_agent``.

Every assistant label is validated against the real Pydantic output schema;
every generated Python file must compile and its page-object imports must
resolve. Examples from the held-out app are written to ``data/eval`` and are
never trained on.

Run from ``apps/qa-engine``:  uv run python -m finetune.build_dataset
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

from agents import automation_agent, test_case_agent, test_plan_agent
from app.models.schemas import AutomationOutput, TestCasesOutput, TestPlanOutput
from finetune import gold, seeds

ROOT = Path(__file__).resolve().parent
_IMPORT_RE = re.compile(r"from\s+automation\.pages\.(\w+)\s+import")


def chat(system: str, user: str, assistant: str) -> dict:
    return {"messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
        {"role": "assistant", "content": assistant},
    ]}


# ---------------------------------------------------------------------------
# Label validation — a bad label must crash the build, never train.
# ---------------------------------------------------------------------------


def validate_cases_label(cases: list[dict], min_cases: int, req_id: str) -> str:
    out = TestCasesOutput.model_validate({"test_cases": cases})
    if len(out.test_cases) < min_cases:
        raise ValueError(f"gold has {len(out.test_cases)} cases < min_cases={min_cases}")
    keys = [c.case_key for c in out.test_cases]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate case keys in gold label")
    for c in out.test_cases:
        if req_id not in c.requirement_ids:
            raise ValueError(f"{c.case_key} lacks requirement id {req_id}")
        for field in ("title", "objective", "steps", "expected_results", "preconditions"):
            if not getattr(c, field):
                raise ValueError(f"{c.case_key} has empty {field}")
    return out.model_dump_json()


def validate_plan_label(plan: dict) -> str:
    out = TestPlanOutput.model_validate(plan)
    for section in ("objectives", "scope", "exclusions", "test_types", "environments",
                    "test_data", "entry_criteria", "exit_criteria", "risks", "deliverables"):
        if not getattr(out, section):
            raise ValueError(f"gold plan section '{section}' is empty")
    return out.model_dump_json()


def validate_automation_label(payload: dict, page_object_exists: bool) -> str:
    out = AutomationOutput.model_validate(payload)
    if not out.files:
        raise ValueError("gold automation output has no files")
    available = {f.path.rsplit("/", 1)[-1][:-3] for f in out.files if f.kind == "page_object"}
    for f in out.files:
        compile(f.content, f.path, "exec")  # SyntaxError on bad gold code
        if not f.path.startswith(("automation/generated_tests/", "automation/pages/")):
            raise ValueError(f"bad gold path {f.path}")
        if f.kind == "test_file":
            if "pytestmark = [pytest.mark.generated]" not in f.content:
                raise ValueError(f"{f.path} lacks pytestmark")
            if "# TC:" not in f.content or "# REQ:" not in f.content:
                raise ValueError(f"{f.path} lacks traceability comments")
            for banned in ("time.sleep", "wait_for_timeout", "page.locator(", "css=", "xpath="):
                if banned in f.content:
                    raise ValueError(f"{f.path} contains forbidden pattern {banned!r}")
            for mod in _IMPORT_RE.findall(f.content):
                if mod not in available and not page_object_exists:
                    raise ValueError(f"{f.path} imports unavailable page object {mod}")
    return out.model_dump_json()


# ---------------------------------------------------------------------------
# Example builders
# ---------------------------------------------------------------------------


def case_examples(features: tuple[seeds.Feature, ...]) -> list[dict]:
    out: list[dict] = []
    for feat in features:
        cases = gold.make_cases(feat)
        variants = (
            ("formal", True, min(10, len(cases))),
            ("story", False, min(8, len(cases))),
        )
        for phrasing, with_analysis, min_cases in variants:
            req = seeds.make_requirement(feat, phrasing)
            analysis = seeds.make_analysis(feat) if with_analysis else None
            user = test_case_agent._build_user_prompt(req, analysis, min_cases)
            label = validate_cases_label(cases, min_cases, feat.req_id)
            out.append(chat(test_case_agent.SYSTEM_PROMPT, user, label))
    return out


def plan_examples(features: tuple[seeds.Feature, ...]) -> list[dict]:
    out: list[dict] = []
    by_app: dict[str, list[seeds.Feature]] = {}
    for feat in features:
        by_app.setdefault(feat.app, []).append(feat)
    for app, feats in by_app.items():
        base_url = feats[0].base_url
        variants: list[tuple[str, list[seeds.Feature], bool]] = [
            (app, feats, True),
        ]
        if len(feats) >= 3:
            variants.append((f"{app} — Phase 1", feats[:2][::-1], False))
        for name, subset, with_analyses in variants:
            reqs = [seeds.make_requirement(f, "formal") for f in subset]
            analyses = [seeds.make_analysis(f) for f in subset] if with_analyses else []
            user = test_plan_agent._build_user_prompt(name, base_url, reqs, analyses)
            label = validate_plan_label(gold.make_plan(app, base_url, subset))
            out.append(chat(test_plan_agent.SYSTEM_PROMPT, user, label))
    return out


def coder_examples(features: tuple[seeds.Feature, ...]) -> list[dict]:
    out: list[dict] = []
    for feat in features:
        cases = gold.make_cases(feat)
        for emit_po, include_req in ((True, True), (False, False)):
            if emit_po:
                summary = "(none yet — emit page_object files for any you need)"
            else:
                summary = (
                    f"- automation.pages.{gold.po_module(feat)} ({gold.po_class(feat)})\n"
                    "- automation.pages.sample_login_page (SampleLoginPage)"
                )
            prompt_cases = gold.prompt_cases(feat, cases, include_req)
            user = automation_agent._HUMAN_TEMPLATE.format(
                base_url=feat.base_url,
                page_objects_summary=summary,
                test_cases_json=json.dumps(prompt_cases, indent=2, default=str),
            )
            payload = gold.make_automation_output(feat, cases, emit_po, include_req)
            label = validate_automation_label(payload, page_object_exists=not emit_po)
            out.append(chat(automation_agent._SYSTEM_PROMPT, user, label))
    return out


def practice_login_examples() -> list[dict]:
    """One real, verified example from this repository: the fixed
    practicetestautomation.com login suite (page object exists on disk)."""
    repo = ROOT.parent
    test_src = (repo / "automation/generated_tests/test_login_validation.py").read_text()
    cases = [
        {"id": "c116cf01-0000-4000-8000-000000000001", "case_key": "TC-001",
         "title": "Valid username and password login",
         "steps": ["1. Navigate to /practice-test-login/.",
                   "2. Enter 'student' into the 'Username' field.",
                   "3. Enter the QA_TEST_PASSWORD value into the 'Password' field.",
                   "4. Click the 'Submit' button."],
         "expected_results": ["The browser is redirected to /logged-in-successfully/.",
                              'The "Logged In Successfully" heading is visible.'],
         "test_data": {"Username": "student", "Password": "QA_TEST_PASSWORD"},
         "preconditions": ["The practice login page is reachable."]},
        {"id": "c116cf01-0000-4000-8000-000000000002", "case_key": "TC-002",
         "title": "Empty username and valid password login",
         "steps": ["1. Navigate to /practice-test-login/.",
                   "2. Leave the 'Username' field empty.",
                   "3. Enter a valid password.", "4. Click the 'Submit' button."],
         "expected_results": ['The page shows "Your username is invalid!".'],
         "test_data": {"Username": "(empty)", "Password": "QA_TEST_PASSWORD"},
         "preconditions": ["The practice login page is reachable."]},
        {"id": "c116cf01-0000-4000-8000-000000000003", "case_key": "TC-003",
         "title": "Empty password and valid username login",
         "steps": ["1. Navigate to /practice-test-login/.",
                   "2. Enter 'student' into the 'Username' field.",
                   "3. Leave the 'Password' field empty.", "4. Click the 'Submit' button."],
         "expected_results": ['The page shows "Your password is invalid!".'],
         "test_data": {"Username": "student", "Password": "(empty)"},
         "preconditions": ["The practice login page is reachable."]},
        {"id": "c116cf01-0000-4000-8000-000000000004", "case_key": "TC-004",
         "title": "Malformed username and valid password login",
         "steps": ["1. Navigate to /practice-test-login/.",
                   "2. Enter 'user@invalid' into the 'Username' field.",
                   "3. Enter a valid password.", "4. Click the 'Submit' button."],
         "expected_results": ['The page shows "Your username is invalid!".'],
         "test_data": {"Username": "user@invalid", "Password": "QA_TEST_PASSWORD"},
         "preconditions": ["The practice login page is reachable."]},
    ]
    summary = "- automation.pages.login_page (LoginPage)"
    user = automation_agent._HUMAN_TEMPLATE.format(
        base_url="https://practicetestautomation.com",
        page_objects_summary=summary,
        test_cases_json=json.dumps(cases, indent=2, default=str),
    )
    payload = {
        "files": [{
            "path": "automation/generated_tests/test_login_validation.py",
            "kind": "test_file",
            "content": test_src,
            "test_case_ids": [c["id"] for c in cases],
        }],
        "notes": "Reused the existing LoginPage page object; all four cases are automatable.",
    }
    label = validate_automation_label(payload, page_object_exists=True)
    return [chat(automation_agent._SYSTEM_PROMPT, user, label)]


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def token_estimate(example: dict) -> int:
    return sum(len(m["content"]) for m in example["messages"]) // 3


def write_split(examples: list[dict], out_dir: Path, valid_n: int, rng: random.Random) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    shuffled = examples[:]
    rng.shuffle(shuffled)
    valid, train = shuffled[:valid_n], shuffled[valid_n:]
    for name, rows in (("train", train), ("valid", valid)):
        with (out_dir / f"{name}.jsonl").open("w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    lengths = sorted(token_estimate(e) for e in examples)
    return {
        "train": len(train), "valid": len(valid),
        "approx_tokens_p50": lengths[len(lengths) // 2],
        "approx_tokens_max": lengths[-1],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT / "data"))
    args = parser.parse_args()
    out_root = Path(args.out)
    rng = random.Random(20260808)

    planner = case_examples(seeds.TRAIN_FEATURES) + plan_examples(seeds.TRAIN_FEATURES)
    coder = coder_examples(seeds.TRAIN_FEATURES) + practice_login_examples()
    eval_planner = case_examples(seeds.HOLDOUT_FEATURES) + plan_examples(seeds.HOLDOUT_FEATURES)
    eval_coder = coder_examples(seeds.HOLDOUT_FEATURES)

    stats = {
        "planner": write_split(planner, out_root / "planner", valid_n=8, rng=rng),
        "coder": write_split(coder, out_root / "coder", valid_n=6, rng=rng),
        "eval_planner": write_split(eval_planner, out_root / "eval_planner", valid_n=0, rng=rng),
        "eval_coder": write_split(eval_coder, out_root / "eval_coder", valid_n=0, rng=rng),
    }
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
