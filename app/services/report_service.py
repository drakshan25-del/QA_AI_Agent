"""Report service: duplicate-finding detection and execution report generation.

Implements:
    - FR-BUG-003: similarity search over existing findings so drafted defects
      can be flagged as potential duplicates before filing.
    - FR-REP-001: report sections (scope, environment, build/commit, run
      summary metrics, per-test outcomes, failures, defects, coverage,
      evidence links, recommendations).
    - FR-REP-002: measured metrics come straight from the database and are
      labelled 'Measured'; the AI narrative is labelled 'AI-generated
      narrative' (or 'auto-generated (no LLM)' on fallback).
    - FR-REP-003: reports written as self-contained Markdown + HTML files
      under ``reports/<run_id>/``.
    - FR-REP-004: reproducibility block with model, prompt versions,
      source commit and CI identifiers.

Rendering is done by the pure functions :func:`render_report_md` and
:func:`render_report_html` which take a plain ``data`` dict, so reports can
be built and tested without a database or LLM (see ``__main__`` self-check).
"""

from __future__ import annotations

import difflib
from datetime import datetime, timezone
from typing import Any

from jinja2 import Template
from sqlalchemy import select
from sqlalchemy.orm import Session

from agents import report_agent, result_analysis_agent
from app.core.config import get_settings
from app.core.llm import OllamaUnavailableError, generation_metadata
from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.entities import (
    ExecutionRun,
    Finding,
    GenerationRun,
    Project,
    TestCase,
    TestResult,
)

logger = get_logger(__name__)

SIMILARITY_THRESHOLD = 0.8

MEASURED_LABEL = "Measured"
AI_NARRATIVE_LABEL = "AI-generated narrative"
FALLBACK_NARRATIVE_LABEL = "auto-generated (no LLM)"

_MAX_TABLE_ERROR_CHARS = 300
_MAX_DETAIL_ERROR_CHARS = 1500


# ---------------------------------------------------------------------------
# Duplicate detection (FR-BUG-003)
# ---------------------------------------------------------------------------


def find_similar_findings(db: Session, project_id: str, title: str) -> list[Finding]:
    """Return existing findings whose drafted title resembles ``title``.

    Similarity uses :class:`difflib.SequenceMatcher` ratio >= 0.8 on the
    ``report_fields['title']`` of every finding recorded for the project
    (FR-BUG-003), most similar first.

    Args:
        db: Open SQLAlchemy session.
        project_id: Project whose historical findings are searched.
        title: Candidate defect title.

    Returns:
        Findings ordered by descending similarity.
    """
    wanted = (title or "").strip().lower()
    if not wanted:
        return []

    stmt = (
        select(Finding)
        .join(TestResult, Finding.result_id == TestResult.id)
        .join(ExecutionRun, TestResult.execution_run_id == ExecutionRun.id)
        .where(ExecutionRun.project_id == project_id)
    )
    scored: list[tuple[float, Finding]] = []
    for finding in db.scalars(stmt).all():
        existing = str((finding.report_fields or {}).get("title", "")).strip().lower()
        if not existing:
            continue
        ratio = difflib.SequenceMatcher(None, wanted, existing).ratio()
        if ratio >= SIMILARITY_THRESHOLD:
            scored.append((ratio, finding))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [finding for _, finding in scored]


# ---------------------------------------------------------------------------
# Report generation (FR-REP-001..004)
# ---------------------------------------------------------------------------


def generate_report(db: Session, execution_run_id: str) -> dict:
    """Build and persist the Markdown + HTML report for an execution run.

    Pulls the run, its test results, findings, project and generation runs
    from the database, assembles the section data (FR-REP-001), obtains the
    AI narrative (FR-REP-002, with deterministic fallback when Ollama is
    down) and writes ``report.md`` / ``report.html`` under
    ``reports/<run_id>/`` (FR-REP-003).

    Args:
        db: Open SQLAlchemy session.
        execution_run_id: Id of the :class:`ExecutionRun` to report on.

    Returns:
        ``{"html_path": str, "md_path": str, "data": dict}``.

    Raises:
        ValueError: If the execution run does not exist.
    """
    run = db.get(ExecutionRun, execution_run_id)
    if run is None:
        raise ValueError(f"ExecutionRun {execution_run_id!r} not found")

    results = list(
        db.scalars(
            select(TestResult).where(TestResult.execution_run_id == run.id)
        ).all()
    )
    result_ids = [r.id for r in results]
    findings = (
        list(db.scalars(select(Finding).where(Finding.result_id.in_(result_ids))).all())
        if result_ids
        else []
    )
    findings_by_result: dict[str, list[Finding]] = {}
    for finding in findings:
        findings_by_result.setdefault(finding.result_id, []).append(finding)

    project = db.get(Project, run.project_id)
    generation_runs = list(
        db.scalars(
            select(GenerationRun)
            .where(GenerationRun.project_id == run.project_id)
            .order_by(GenerationRun.created_at)
        ).all()
    )

    data = _build_report_data(db, run, results, findings_by_result, project, generation_runs)
    data["ai_narrative"] = _narrative_section(data)

    md_text = render_report_md(data)
    html_text = render_report_html(data)

    out_dir = get_settings().reports_path / run.id
    out_dir.mkdir(parents=True, exist_ok=True)
    md_path = out_dir / "report.md"
    html_path = out_dir / "report.html"
    md_path.write_text(md_text, encoding="utf-8")
    html_path.write_text(html_text, encoding="utf-8")
    logger.info("report generated for run %s at %s", run.id, out_dir)

    return {"html_path": str(html_path), "md_path": str(md_path), "data": data}


def _narrative_section(data: dict) -> dict:
    """AI narrative with deterministic fallback (FR-REP-002)."""
    metrics = data["metrics"]
    run_summary = {
        "run_id": data["run"]["id"],
        "project": data["project"]["name"],
        "status": data["run"]["status"],
        "environment": data["run"]["environment"],
        "metrics": {k: v for k, v in metrics.items() if k != "label"},
        "failures": [
            {"node_id": f["node_id"], "classification": f["classification"]}
            for f in data["failures"]
        ],
    }
    try:
        return {"label": AI_NARRATIVE_LABEL, "text": report_agent.summarise_run(run_summary)}
    except OllamaUnavailableError as exc:
        logger.warning("narrative fallback (Ollama unavailable): %s", exc)
        text = (
            f"Run {run_summary['run_id']} on environment "
            f"'{run_summary['environment']}' finished with status "
            f"'{run_summary['status']}': {metrics['passed']} of {metrics['total']} "
            f"tests passed, {metrics['failed']} failed, {metrics['errors']} errored "
            f"and {metrics['skipped']} were skipped "
            f"(pass rate {metrics['pass_rate_percent']}%)."
        )
        return {"label": FALLBACK_NARRATIVE_LABEL, "text": text}


def _build_report_data(
    db: Session,
    run: ExecutionRun,
    results: list[TestResult],
    findings_by_result: dict[str, list[Finding]],
    project: Project | None,
    generation_runs: list[GenerationRun],
) -> dict:
    """Assemble the section data dict consumed by the pure renderers."""
    outcomes = [r.outcome for r in results]
    total = len(results)
    passed = outcomes.count("passed")
    failed = outcomes.count("failed")
    skipped = outcomes.count("skipped")
    errors = outcomes.count("error")
    executed = total - skipped
    pass_rate = round(100.0 * passed / executed, 1) if executed else 0.0
    duration = round(sum(r.duration_seconds for r in results), 2)

    result_rows = []
    evidence_links: list[str] = []
    for r in sorted(results, key=lambda x: x.node_id):
        links = _flatten_evidence(r.evidence)
        evidence_links.extend(links)
        result_rows.append(
            {
                "node_id": r.node_id,
                "outcome": r.outcome,
                "duration_seconds": round(r.duration_seconds, 2),
                "error_message": redact_secrets(r.error_message or "")[:_MAX_TABLE_ERROR_CHARS],
                "evidence": links,
            }
        )

    failures = []
    defects = []
    classifications: list[str] = []
    for r in results:
        if r.outcome not in ("failed", "error"):
            continue
        r_findings = findings_by_result.get(r.id, [])
        top = r_findings[0] if r_findings else None
        classification = top.classification if top else "unclassified"
        classifications.append(classification)
        failures.append(
            {
                "node_id": r.node_id,
                "outcome": r.outcome,
                "classification": classification,
                "confidence": round(top.confidence, 2) if top else None,
                "severity": top.severity if top else "",
                "rationale": redact_secrets(top.rationale) if top else "",
                "error_message": redact_secrets(r.error_message or "")[:_MAX_DETAIL_ERROR_CHARS],
                "evidence": _flatten_evidence(r.evidence),
            }
        )
        for finding in r_findings:
            fields = finding.report_fields or {}
            if fields:
                defects.append(
                    {
                        "finding_id": finding.id,
                        "node_id": r.node_id,
                        "classification": finding.classification,
                        "severity": finding.severity,
                        "title": str(fields.get("title", "")),
                        "description": redact_secrets(str(fields.get("description", ""))),
                        "steps_to_reproduce": list(fields.get("steps_to_reproduce", [])),
                        "expected_result": str(fields.get("expected_result", "")),
                        "actual_result": redact_secrets(str(fields.get("actual_result", ""))),
                        "external_issue_ref": finding.external_issue_ref,
                    }
                )

    coverage = _coverage_metrics(db, run.project_id, results)
    recommendations = _recommendations(failed + errors, classifications)

    # Reproducibility block (FR-REP-004): model, prompt versions, commit, CI.
    llm_meta = generation_metadata()
    prompt_versions = {gr.kind: gr.prompt_version for gr in generation_runs}
    prompt_versions["result_analysis"] = result_analysis_agent.PROMPT_VERSION
    prompt_versions["report"] = report_agent.PROMPT_VERSION

    return {
        "title": f"Test Execution Report - run {run.id}",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project": {
            "name": project.name if project else run.project_id,
            "environment": project.environment if project else run.environment,
            "base_url": project.base_url if project else "",
        },
        "run": {
            "id": run.id,
            "status": run.status,
            "mode": run.mode,
            "environment": run.environment,
            "browser": run.browser,
            "source_commit": run.source_commit,
            "ci_run_id": run.ci_run_id,
            "ci_url": run.ci_url,
            "started_at": run.started_at.isoformat(timespec="seconds") if run.started_at else "",
            "finished_at": run.finished_at.isoformat(timespec="seconds") if run.finished_at else "",
        },
        "scope": sorted({r.node_id.split("::", 1)[0] for r in results if r.node_id}),
        "metrics": {
            "label": MEASURED_LABEL,  # FR-REP-002: measured, straight from DB
            "total": total,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "pass_rate_percent": pass_rate,
            "duration_seconds": duration,
        },
        "results": result_rows,
        "failures": failures,
        "defects": defects,
        "coverage": coverage,
        "evidence_links": sorted(set(evidence_links)),
        "recommendations": recommendations,
        "reproducibility": {
            "provider": llm_meta["provider"],
            "model": llm_meta["model"],
            "temperature": llm_meta["temperature"],
            "prompt_versions": prompt_versions,
            "source_commit": run.source_commit or "(not recorded)",
            "ci_run_id": run.ci_run_id or "(local run)",
            "ci_url": run.ci_url,
        },
    }


def _flatten_evidence(evidence: dict | None) -> list[str]:
    """Flatten the TestResult.evidence JSON dict into a list of link strings."""
    links: list[str] = []
    for value in (evidence or {}).values():
        if isinstance(value, str) and value:
            links.append(value)
        elif isinstance(value, list):
            links.extend(str(v) for v in value if v)
    return links


def _coverage_metrics(db: Session, project_id: str, results: list[TestResult]) -> dict:
    """Measured coverage: executed cases vs stored cases, requirements touched."""
    all_cases = list(
        db.scalars(select(TestCase).where(TestCase.project_id == project_id)).all()
    )
    executed_case_ids = {r.test_case_id for r in results if r.test_case_id}
    covered_requirements: set[str] = set()
    for case in all_cases:
        if case.id in executed_case_ids:
            covered_requirements.update(str(rid) for rid in (case.requirement_ids or []))
    total = len(all_cases)
    executed = len(executed_case_ids)
    return {
        "label": MEASURED_LABEL,
        "test_cases_total": total,
        "test_cases_executed": executed,
        "coverage_percent": round(100.0 * executed / total, 1) if total else 0.0,
        "requirements_covered": sorted(covered_requirements),
    }


def _recommendations(failure_count: int, classifications: list[str]) -> list[str]:
    """Deterministic, rule-based next steps derived from measured outcomes."""
    recs: list[str] = []
    if failure_count == 0:
        recs.append(
            "No failures recorded. Consider extending negative, boundary and "
            "role-based coverage in the next generation cycle."
        )
        return recs
    if "environment" in classifications:
        recs.append(
            "Environment-classified failures present: verify the target "
            "application and its services are reachable, then re-run before triaging."
        )
    if "test_defect" in classifications:
        recs.append(
            "Test-defect failures present: repair or regenerate the affected "
            "generated tests (selectors, fixtures, imports) before re-running."
        )
    if "app_defect" in classifications:
        recs.append(
            "Application-defect candidates found: review the drafted defect "
            "reports below and confirm before filing (human approval required, FR-HITL)."
        )
    if "data" in classifications:
        recs.append(
            "Data-classified failures present: refresh or re-seed test data "
            "and confirm data preconditions."
        )
    if "inconclusive" in classifications or "unclassified" in classifications:
        recs.append(
            "Some failures are inconclusive/unclassified: inspect the linked "
            "evidence (screenshots, traces) manually."
        )
    return recs


# ---------------------------------------------------------------------------
# Pure renderers (no DB, no LLM) - FR-REP-001/002/003/004
# ---------------------------------------------------------------------------


def _md_cell(text: Any, limit: int = _MAX_TABLE_ERROR_CHARS) -> str:
    """Make a value safe for a Markdown table cell."""
    return str(text).replace("|", "\\|").replace("\n", " ").strip()[:limit]


def _md_code_block(text: str) -> str:
    """Fence arbitrary text safely (strip fence-breaking backticks)."""
    return "```text\n" + str(text).replace("```", "` ` `") + "\n```"


def render_report_md(data: dict) -> str:
    """Render the report data dict to Markdown (pure function, FR-REP-003)."""
    m = data["metrics"]
    cov = data["coverage"]
    rep = data["reproducibility"]
    lines: list[str] = []
    add = lines.append

    add(f"# {data['title']}")
    add("")
    add(f"Project: **{data['project']['name']}** | Generated: {data['generated_at']}")
    add("")

    add("## 1. Scope")
    add("")
    if data["scope"]:
        lines.extend(f"- `{s}`" for s in data["scope"])
    else:
        add("- (no tests executed)")
    add("")

    add("## 2. Environment and Build")
    add("")
    add(f"- Environment: {data['run']['environment']}")
    add(f"- Browser: {data['run']['browser']}")
    add(f"- Base URL: {data['project']['base_url'] or '(not set)'}")
    add(f"- Mode: {data['run']['mode']}")
    add(f"- Build / source commit: `{data['run']['source_commit'] or '(not recorded)'}`")
    add(f"- CI run: {data['run']['ci_run_id'] or '(local run)'}"
        + (f" ({data['run']['ci_url']})" if data['run']['ci_url'] else ""))
    add(f"- Started: {data['run']['started_at'] or 'n/a'} | Finished: {data['run']['finished_at'] or 'n/a'}")
    add("")

    add(f"## 3. Run Summary [{m['label']}]")
    add("")
    add("| Total | Passed | Failed | Errors | Skipped | Pass rate | Duration (s) |")
    add("|---|---|---|---|---|---|---|")
    add(
        f"| {m['total']} | {m['passed']} | {m['failed']} | {m['errors']} | "
        f"{m['skipped']} | {m['pass_rate_percent']}% | {m['duration_seconds']} |"
    )
    add("")
    add(f"*All figures in this section are measured directly from stored results ({m['label']}).*")
    add("")

    narrative = data.get("ai_narrative", {})
    add(f"## 4. Narrative [{narrative.get('label', AI_NARRATIVE_LABEL)}]")
    add("")
    add(f"> {narrative.get('text', '(no narrative)')}")
    add("")

    add("## 5. Per-test Outcomes")
    add("")
    add("| Test | Outcome | Duration (s) | Error (truncated) |")
    add("|---|---|---|---|")
    for r in data["results"]:
        add(
            f"| `{_md_cell(r['node_id'])}` | {r['outcome']} | "
            f"{r['duration_seconds']} | {_md_cell(r['error_message']) or '-'} |"
        )
    if not data["results"]:
        add("| (none) | - | - | - |")
    add("")

    add("## 6. Failures and Classification")
    add("")
    if data["failures"]:
        for f in data["failures"]:
            conf = f" (confidence {f['confidence']})" if f["confidence"] is not None else ""
            add(f"### `{f['node_id']}`")
            add("")
            add(f"- Classification: **{f['classification']}**{conf}"
                + (f" | severity: {f['severity']}" if f['severity'] else ""))
            if f["rationale"]:
                add(f"- Rationale: {f['rationale']}")
            add("")
            add(_md_code_block(f["error_message"]))
            add("")
    else:
        add("No failures.")
        add("")

    add("## 7. Defect Drafts")
    add("")
    if data["defects"]:
        for d in data["defects"]:
            add(f"### {d['title'] or '(untitled draft)'}")
            add("")
            add(f"- Test: `{_md_cell(d['node_id'])}`")
            add(f"- Classification: {d['classification']} | Severity: {d['severity']}")
            if d["external_issue_ref"]:
                add(f"- External issue: {d['external_issue_ref']}")
            add(f"- Description: {d['description']}")
            if d["steps_to_reproduce"]:
                add("- Steps to reproduce:")
                lines.extend(f"  {i}. {s}" for i, s in enumerate(d["steps_to_reproduce"], 1))
            add(f"- Expected result: {d['expected_result']}")
            add(f"- Actual result: {d['actual_result']}")
            add("")
    else:
        add("No defect drafts recorded for this run.")
        add("")

    add(f"## 8. Coverage [{cov['label']}]")
    add("")
    add(f"- Test cases executed: {cov['test_cases_executed']} of {cov['test_cases_total']}"
        f" ({cov['coverage_percent']}%)")
    if cov["requirements_covered"]:
        add(f"- Requirements covered: {', '.join(cov['requirements_covered'])}")
    else:
        add("- Requirements covered: (no traceability links recorded)")
    add("")

    add("## 9. Evidence")
    add("")
    if data["evidence_links"]:
        lines.extend(f"- `{link}`" for link in data["evidence_links"])
    else:
        add("- (no evidence captured)")
    add("")

    add("## 10. Recommendations")
    add("")
    lines.extend(f"- {rec}" for rec in data["recommendations"])
    add("")

    add("## 11. Reproducibility (FR-REP-004)")
    add("")
    add(f"- LLM provider/model: {rep['provider']} / `{rep['model']}` (temperature {rep['temperature']})")
    add("- Prompt versions: "
        + ", ".join(f"{k}={v}" for k, v in sorted(rep["prompt_versions"].items())))
    add(f"- Source commit: `{rep['source_commit']}`")
    add(f"- CI run id: {rep['ci_run_id']}"
        + (f" ({rep['ci_url']})" if rep["ci_url"] else ""))
    add("")
    return "\n".join(lines)


_HTML_TEMPLATE_SOURCE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ data.title }}</title>
<style>
  :root { --ok:#1a7f37; --bad:#b42318; --warn:#b54708; --muted:#667085; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
         Helvetica, Arial, sans-serif; margin: 0; color: #1d2430;
         background: #f5f6f8; line-height: 1.5; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 32px 0 10px; border-bottom: 1px solid #dde1e7;
       padding-bottom: 4px; }
  h3 { font-size: 1rem; margin: 18px 0 6px; }
  .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 12px; }
  .label { display: inline-block; font-size: 0.72rem; font-weight: 600;
           text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px;
           border-radius: 10px; vertical-align: middle; }
  .label-measured { background: #e6f4ea; color: var(--ok); }
  .label-ai { background: #ede9fe; color: #5b21b6; }
  table { border-collapse: collapse; width: 100%; background: #fff;
          font-size: 0.88rem; }
  th, td { border: 1px solid #dde1e7; padding: 6px 10px; text-align: left;
           vertical-align: top; }
  th { background: #eef0f3; }
  .table-wrap { overflow-x: auto; }
  .outcome { font-weight: 600; }
  .outcome-passed { color: var(--ok); }
  .outcome-failed, .outcome-error { color: var(--bad); }
  .outcome-skipped { color: var(--muted); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size: 0.85em; }
  code { background: #eef0f3; padding: 1px 5px; border-radius: 4px; }
  pre { background: #101828; color: #e4e7ec; padding: 12px 14px;
        border-radius: 8px; overflow-x: auto; white-space: pre-wrap;
        word-break: break-word; }
  blockquote { margin: 0; padding: 12px 16px; background: #fff;
               border-left: 4px solid #7c5cff; border-radius: 0 8px 8px 0; }
  ul { margin: 6px 0; padding-left: 22px; }
  .card { background: #fff; border: 1px solid #dde1e7; border-radius: 8px;
          padding: 12px 16px; margin: 10px 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
  .kpi { background: #fff; border: 1px solid #dde1e7; border-radius: 8px;
         padding: 10px 16px; min-width: 92px; }
  .kpi b { display: block; font-size: 1.3rem; }
  .kpi span { color: var(--muted); font-size: 0.78rem; }
</style>
</head>
<body>
<main>
  <h1>{{ data.title }}</h1>
  <p class="meta">Project: <strong>{{ data.project.name }}</strong>
     &middot; Generated: {{ data.generated_at }}</p>

  <h2>1. Scope</h2>
  <ul>
    {% for s in data.scope %}<li><code>{{ s }}</code></li>
    {% else %}<li>(no tests executed)</li>{% endfor %}
  </ul>

  <h2>2. Environment and Build</h2>
  <div class="card"><ul>
    <li>Environment: {{ data.run.environment }}</li>
    <li>Browser: {{ data.run.browser }}</li>
    <li>Base URL: {{ data.project.base_url or "(not set)" }}</li>
    <li>Mode: {{ data.run.mode }}</li>
    <li>Build / source commit: <code>{{ data.run.source_commit or "(not recorded)" }}</code></li>
    <li>CI run: {{ data.run.ci_run_id or "(local run)" }}
        {% if data.run.ci_url %} &mdash; {{ data.run.ci_url }}{% endif %}</li>
    <li>Started: {{ data.run.started_at or "n/a" }} &middot;
        Finished: {{ data.run.finished_at or "n/a" }}</li>
  </ul></div>

  <h2>3. Run Summary <span class="label label-measured">{{ data.metrics.label }}</span></h2>
  <div class="kpis">
    <div class="kpi"><b>{{ data.metrics.total }}</b><span>Total</span></div>
    <div class="kpi"><b class="outcome-passed">{{ data.metrics.passed }}</b><span>Passed</span></div>
    <div class="kpi"><b class="outcome-failed">{{ data.metrics.failed }}</b><span>Failed</span></div>
    <div class="kpi"><b class="outcome-failed">{{ data.metrics.errors }}</b><span>Errors</span></div>
    <div class="kpi"><b class="outcome-skipped">{{ data.metrics.skipped }}</b><span>Skipped</span></div>
    <div class="kpi"><b>{{ data.metrics.pass_rate_percent }}%</b><span>Pass rate</span></div>
    <div class="kpi"><b>{{ data.metrics.duration_seconds }}</b><span>Duration (s)</span></div>
  </div>
  <p class="meta">All figures in this section are measured directly from stored results.</p>

  <h2>4. Narrative <span class="label label-ai">{{ data.ai_narrative.label }}</span></h2>
  <blockquote>{{ data.ai_narrative.text }}</blockquote>

  <h2>5. Per-test Outcomes</h2>
  <div class="table-wrap">
  <table>
    <tr><th>Test</th><th>Outcome</th><th>Duration (s)</th><th>Error (truncated)</th></tr>
    {% for r in data.results %}
    <tr>
      <td><code>{{ r.node_id }}</code></td>
      <td class="outcome outcome-{{ r.outcome }}">{{ r.outcome }}</td>
      <td>{{ r.duration_seconds }}</td>
      <td>{{ r.error_message or "-" }}</td>
    </tr>
    {% else %}<tr><td colspan="4">(none)</td></tr>{% endfor %}
  </table>
  </div>

  <h2>6. Failures and Classification</h2>
  {% for f in data.failures %}
  <div class="card">
    <h3><code>{{ f.node_id }}</code></h3>
    <p>Classification: <strong>{{ f.classification }}</strong>
       {% if f.confidence is not none %}(confidence {{ f.confidence }}){% endif %}
       {% if f.severity %} &middot; severity: {{ f.severity }}{% endif %}</p>
    {% if f.rationale %}<p>Rationale: {{ f.rationale }}</p>{% endif %}
    <pre>{{ f.error_message }}</pre>
  </div>
  {% else %}<p>No failures.</p>{% endfor %}

  <h2>7. Defect Drafts</h2>
  {% for d in data.defects %}
  <div class="card">
    <h3>{{ d.title or "(untitled draft)" }}</h3>
    <ul>
      <li>Test: <code>{{ d.node_id }}</code></li>
      <li>Classification: {{ d.classification }} &middot; Severity: {{ d.severity }}</li>
      {% if d.external_issue_ref %}<li>External issue: {{ d.external_issue_ref }}</li>{% endif %}
      <li>Description: {{ d.description }}</li>
      {% if d.steps_to_reproduce %}
      <li>Steps to reproduce:
        <ol>{% for s in d.steps_to_reproduce %}<li>{{ s }}</li>{% endfor %}</ol>
      </li>
      {% endif %}
      <li>Expected result: {{ d.expected_result }}</li>
      <li>Actual result: {{ d.actual_result }}</li>
    </ul>
  </div>
  {% else %}<p>No defect drafts recorded for this run.</p>{% endfor %}

  <h2>8. Coverage <span class="label label-measured">{{ data.coverage.label }}</span></h2>
  <ul>
    <li>Test cases executed: {{ data.coverage.test_cases_executed }} of
        {{ data.coverage.test_cases_total }} ({{ data.coverage.coverage_percent }}%)</li>
    <li>Requirements covered:
      {% if data.coverage.requirements_covered %}
        {{ data.coverage.requirements_covered | join(", ") }}
      {% else %}(no traceability links recorded){% endif %}</li>
  </ul>

  <h2>9. Evidence</h2>
  <ul>
    {% for link in data.evidence_links %}<li><code>{{ link }}</code></li>
    {% else %}<li>(no evidence captured)</li>{% endfor %}
  </ul>

  <h2>10. Recommendations</h2>
  <ul>
    {% for rec in data.recommendations %}<li>{{ rec }}</li>{% endfor %}
  </ul>

  <h2>11. Reproducibility (FR-REP-004)</h2>
  <div class="card"><ul>
    <li>LLM provider/model: {{ data.reproducibility.provider }} /
        <code>{{ data.reproducibility.model }}</code>
        (temperature {{ data.reproducibility.temperature }})</li>
    <li>Prompt versions:
      {% for k, v in data.reproducibility.prompt_versions | dictsort %}
        <code>{{ k }}={{ v }}</code>{% if not loop.last %}, {% endif %}
      {% endfor %}</li>
    <li>Source commit: <code>{{ data.reproducibility.source_commit }}</code></li>
    <li>CI run id: {{ data.reproducibility.ci_run_id }}
        {% if data.reproducibility.ci_url %} &mdash; {{ data.reproducibility.ci_url }}{% endif %}</li>
  </ul></div>
</main>
</body>
</html>
"""

_HTML_TEMPLATE = Template(_HTML_TEMPLATE_SOURCE, autoescape=True)


def render_report_html(data: dict) -> str:
    """Render the report data dict to self-contained HTML (pure function).

    Uses the embedded Jinja2 template with autoescaping; no external assets
    (FR-REP-003).
    """
    return _HTML_TEMPLATE.render(data=data)


# ---------------------------------------------------------------------------
# Self-check: render a fake run without any DB or LLM
# ---------------------------------------------------------------------------


def _demo_data() -> dict:
    """Fake in-memory report data for the __main__ self-check."""
    return {
        "title": "Test Execution Report - run demo123",
        "generated_at": "2026-07-16T12:00:00+00:00",
        "project": {"name": "Demo Project", "environment": "test",
                    "base_url": "http://localhost:8001"},
        "run": {
            "id": "demo123", "status": "completed", "mode": "local",
            "environment": "local", "browser": "chromium",
            "source_commit": "abc1234", "ci_run_id": "", "ci_url": "",
            "started_at": "2026-07-16T11:58:00+00:00",
            "finished_at": "2026-07-16T11:59:30+00:00",
        },
        "scope": ["automation/generated_tests/test_login.py"],
        "metrics": {"label": MEASURED_LABEL, "total": 3, "passed": 2,
                    "failed": 1, "errors": 0, "skipped": 0,
                    "pass_rate_percent": 66.7, "duration_seconds": 42.5},
        "results": [
            {"node_id": "test_login.py::test_valid_login", "outcome": "passed",
             "duration_seconds": 12.1, "error_message": "", "evidence": []},
            {"node_id": "test_login.py::test_invalid_login", "outcome": "passed",
             "duration_seconds": 10.4, "error_message": "", "evidence": []},
            {"node_id": "test_login.py::test_locked_account", "outcome": "failed",
             "duration_seconds": 20.0,
             "error_message": "AssertionError: expected 'Account locked' but got 'Welcome'",
             "evidence": ["artifacts/demo123/locked_account.png"]},
        ],
        "failures": [
            {"node_id": "test_login.py::test_locked_account", "outcome": "failed",
             "classification": "app_defect", "confidence": 0.82,
             "severity": "high",
             "rationale": "The assertion 'expected Account locked but got Welcome' "
                          "shows the app admitted a locked user.",
             "error_message": "AssertionError: expected 'Account locked' but got 'Welcome'",
             "evidence": ["artifacts/demo123/locked_account.png"]},
        ],
        "defects": [
            {"finding_id": "f1", "node_id": "test_login.py::test_locked_account",
             "classification": "app_defect", "severity": "high",
             "title": "Locked account can still log in",
             "description": "A locked account is granted a session instead of being rejected.",
             "steps_to_reproduce": ["Open the login page", "Enter locked-user credentials",
                                    "Submit the form"],
             "expected_result": "Message 'Account locked' and no session created",
             "actual_result": "User is logged in and sees 'Welcome'",
             "external_issue_ref": ""},
        ],
        "coverage": {"label": MEASURED_LABEL, "test_cases_total": 5,
                     "test_cases_executed": 3, "coverage_percent": 60.0,
                     "requirements_covered": ["REQ-1", "REQ-2"]},
        "evidence_links": ["artifacts/demo123/locked_account.png"],
        "recommendations": [
            "Application-defect candidates found: review the drafted defect "
            "reports below and confirm before filing (human approval required, FR-HITL)."
        ],
        "ai_narrative": {"label": FALLBACK_NARRATIVE_LABEL,
                         "text": "Run demo123 on environment 'local' finished with "
                                 "status 'completed': 2 of 3 tests passed, 1 failed."},
        "reproducibility": {
            "provider": "ollama", "model": "qwen2.5:latest", "temperature": 0.1,
            "prompt_versions": {"result_analysis": "v1", "report": "v1"},
            "source_commit": "abc1234", "ci_run_id": "(local run)", "ci_url": "",
        },
    }


if __name__ == "__main__":
    demo = _demo_data()
    md = render_report_md(demo)
    html = render_report_html(demo)
    assert MEASURED_LABEL in md and MEASURED_LABEL in html, "Measured label missing"
    assert demo["ai_narrative"]["label"] in md, "narrative label missing in md"
    assert demo["ai_narrative"]["label"] in html, "narrative label missing in html"
    assert "FR-REP-004" in md and "FR-REP-004" in html, "reproducibility block missing"
    assert "Locked account can still log in" in html, "defect draft missing in html"
    print(f"self-check OK: markdown={len(md)} chars, html={len(html)} chars")
