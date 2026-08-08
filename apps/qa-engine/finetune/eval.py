"""Evaluate base vs fine-tuned models on the held-out app (Beacon Helpdesk).

Calls the REAL agents (same prompts, retries and structured-output path as
production) against each candidate model and scores what the workflow cares
about:

* planner / test cases: structured-output success, case count vs the minimum,
  category coverage, traceability, duration.
* planner / test plan: all ten sections populated, justified test types.
* coder / automation: files returned, page object emitted when missing,
  compiles, framework rules (no sleeps/raw selectors, pytestmark, TC comments),
  imports resolve, duration.

Run from apps/qa-engine (Ollama must be up, models pulled/created):

    uv run python -m finetune.eval \
        --planner-models qwen2.5:latest,qwen2.5-qa:latest \
        --coder-models qwen2.5-coder:7b,qwen2.5-coder-qa:7b
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

# The coder-model override must not hijack per-model comparisons: eval passes
# the model explicitly, so the env override is disabled for this process.
os.environ["QA_LLM_CODER_MODEL"] = ""

from agents import automation_agent, test_case_agent, test_plan_agent
from finetune import gold, seeds

_IMPORT_RE = re.compile(r"from\s+automation\.pages\.(\w+)\s+import")
_FORBIDDEN = ("time.sleep", "wait_for_timeout", "page.locator(", "css=", "xpath=")


def eval_cases(model: str) -> list[dict]:
    rows = []
    for feat in seeds.HOLDOUT_FEATURES:
        req = seeds.make_requirement(feat, "formal")
        analysis = seeds.make_analysis(feat)
        started = time.perf_counter()
        row = {"feature": feat.key, "model": model, "ok": False}
        try:
            out = test_case_agent.generate_test_cases(req, analysis, min_cases=8, model=model)
            cases = out.test_cases
            row.update({
                "ok": True,
                "n_cases": len(cases),
                "met_minimum": len(cases) >= 8,
                "categories": len({c.category for c in cases}),
                "traceable": all(feat.req_id in c.requirement_ids for c in cases),
                "unique_keys": len({c.case_key for c in cases}) == len(cases),
            })
        except Exception as exc:  # noqa: BLE001 - scored, not raised
            row["error"] = str(exc)[:160]
        row["seconds"] = round(time.perf_counter() - started, 1)
        rows.append(row)
    return rows


def eval_plan(model: str) -> dict:
    feats = list(seeds.HOLDOUT_FEATURES)
    reqs = [seeds.make_requirement(f, "formal") for f in feats]
    analyses = [seeds.make_analysis(f) for f in feats]
    started = time.perf_counter()
    row = {"feature": "beacon_plan", "model": model, "ok": False}
    try:
        plan = test_plan_agent.generate_test_plan(
            "Beacon Helpdesk", feats[0].base_url, reqs, analyses, model=model)
        sections = [
            "objectives", "scope", "exclusions", "test_types", "environments",
            "test_data", "entry_criteria", "exit_criteria", "risks", "deliverables",
        ]
        filled = sum(1 for s in sections if getattr(plan, s))
        justified = sum(1 for t in plan.test_types if ":" in t)
        row.update({
            "ok": True,
            "sections_filled": f"{filled}/10",
            "test_types": len(plan.test_types),
            "justified_types": justified,
        })
    except Exception as exc:  # noqa: BLE001
        row["error"] = str(exc)[:160]
    row["seconds"] = round(time.perf_counter() - started, 1)
    return row


def eval_automation(model: str) -> list[dict]:
    rows = []
    for feat in seeds.HOLDOUT_FEATURES:
        cases = gold.prompt_cases(feat, gold.make_cases(feat), include_req=False)
        summary = "(none yet — emit page_object files for any you need)"
        started = time.perf_counter()
        row = {"feature": feat.key, "model": model, "ok": False}
        try:
            out = automation_agent.generate_automation(
                cases, feat.base_url, summary, model=model)
            files = out.files
            test_files = [f for f in files if f.kind == "test_file"]
            pages = {f.path.rsplit("/", 1)[-1][:-3] for f in files if f.kind == "page_object"}
            compiles, clean, resolved, marked, traced = True, True, True, True, True
            for f in files:
                try:
                    compile(f.content, f.path, "exec")
                except SyntaxError:
                    compiles = False
                if any(b in f.content for b in _FORBIDDEN):
                    clean = False
                if f.kind == "test_file":
                    marked &= "pytest.mark.generated" in f.content
                    traced &= "# TC:" in f.content
                    for mod in _IMPORT_RE.findall(f.content):
                        if mod not in pages:
                            resolved = False
            row.update({
                "ok": True, "files": len(files), "test_files": len(test_files),
                "page_objects": len(pages), "compiles": compiles,
                "no_forbidden": clean, "imports_resolve": resolved,
                "pytestmark": marked, "tc_comments": traced,
            })
        except Exception as exc:  # noqa: BLE001
            row["error"] = str(exc)[:160]
        row["seconds"] = round(time.perf_counter() - started, 1)
        rows.append(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planner-models", default="")
    parser.add_argument("--coder-models", default="")
    parser.add_argument("--out", default=str(Path(__file__).parent / "work" / "eval_report.json"))
    args = parser.parse_args()

    report: dict = {"planner": [], "coder": []}
    for model in [m for m in args.planner_models.split(",") if m.strip()]:
        model = model.strip()
        print(f"\n=== planner eval: {model} ===")
        rows = eval_cases(model) + [eval_plan(model)]
        for r in rows:
            print(json.dumps(r))
        report["planner"].extend(rows)
    for model in [m for m in args.coder_models.split(",") if m.strip()]:
        model = model.strip()
        print(f"\n=== coder eval: {model} ===")
        rows = eval_automation(model)
        for r in rows:
            print(json.dumps(r))
        report["coder"].extend(rows)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nreport written to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
