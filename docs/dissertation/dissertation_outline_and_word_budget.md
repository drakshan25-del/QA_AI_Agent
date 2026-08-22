# Dissertation Outline and Word Budget — v1 (for approval)

**Title (confirmed by proposal CSC-40040 and RQ document):**
*AI Quality Assurance Agent for SaaS Applications: UI, API and Regression Testing with CI/CD Pipeline*

Author: Rakshan Dangol · Programme: MSc Advanced Computer Science (exact wording TBC) · Module: CSC-40040
Counted-body target: **≈12,500 words** (KLE range 10,000–15,000; contents page, abstract, reference list and appendices excluded from count).
Format: KLE rules — A4, one-sided, ≥1.5 in binding margin, ≥1 in others, TNR or equivalent, double spacing (single for indented quotations), consecutive page numbers bottom-right, third-person passive, past tense, Harvard referencing.

## Preliminary pages (uncounted)

Title Page (official KLE document — **file still awaited**) · Abstract (~250 w) · Acknowledgement · Candidate's Declaration (official wording awaited) · Table of Contents (automatic) · List of Figures · List of Tables/Graphs · List of Appendices · List of Abbreviations/Acronyms.

## Chapters (counted ≈12,500)

### Ch 1 — Introduction (≈1,000)
Context: SaaS release cadence vs manual/scripted QA cost (from proposal). Problem statement. Aim + derived objectives (O1 build the agentic pipeline; O2 ground and gate generation; O3 integrate Playwright/API/GitHub Actions/regression; O4 evaluate pre-trained local LLMs on measurable metrics; O5 fine-tune and re-evaluate; O6 assess safety/HITL governance — **derived from proposal + RQs; student to approve**). RQ1–RQ3 verbatim. Scope and exclusions (no participant study; sample-app target). Contributions. Structure.
Evidence: proposal CSC-40040; RQ document.

### Ch 2 — Background and Critical Literature Review (≈2,000)
2.1 LLM test generation (TestPilot; Li et al. web forms; LIBRO) — critique: coverage-centric metrics, non-executable output rates. 2.2 API testing with LLMs (RESTGPT) vs this project's deterministic OpenAPI gate. 2.3 Agentic software engineering (SWE-agent, RepairAgent) — critique: autonomy without governance. 2.4 Trust/safety of generated code (Zhang et al.; prompt injection; OWASP) → motivation for deterministic gates + HITL. 2.5 Regression and evolution (Haroon et al.) → regression suites/gates. 2.6 Local vs cloud LLMs; PEFT (LoRA→QLoRA); Qwen2.5 family; evaluation practice incl. LLM-as-judge and its biases. 2.7 Gap synthesis → maps to RQs.
Evidence: verified references only (see reference_verification.md).

### Ch 3 — Research Methodology and Requirements (≈1,300)
Design-science / constructive methodology combining software artefact + experimental evaluation; iterative development evidenced by git history (V1→V2→V3, 16 Jul–15 Aug 2026). Requirements summary: FR-*/SEC-*/NFR families cited in code; SRS V3 as source **[EVIDENCE REQUIRED: the three SRS .docx files]**. Evaluation methodology: metric suite design, benchmark items, repetitions, judge design; fine-tune before/after protocol. Ethics and data handling: synthetic/self-authored data; no participants; employer material (Keepme) excluded/anonymised; GDPR posture from proposal; ethical clearance status **[EVIDENCE REQUIRED: approval form/outcome]**.

### Ch 4 — System Design and Architecture (≈1,700)
Three-tier architecture + trust boundaries; integration contracts (/api/v2, /internal/v1, SSE/WS event streams); pipeline with four approval gates + invalidation cascade; state machines; data model (24 entities, application-level keys); security architecture (token handling, allow-lists, redaction, prompt-injection guards); regression design (baseline invariant, comparison semantics, marker algebra); CI design (five suites, regression gate); LLM routing (LOCAL/CLOUD). Design alternatives discussed: LangGraph interrupt-based orchestration (built, demo-only) vs imperative backend orchestration (adopted) — rationale and trade-off.
Evidence: docs/V2_CONTRACT.md; source files per evidence register §3; System_Architecture.docx (project artefact).

### Ch 5 — Implementation (≈1,900)
Engine: six agents + structured output; DOM/OpenAPI grounding; 12 in-loop gates + retry-with-feedback; deterministic security gate (ordering property); execution runner (process-group control, telemetry, redaction); reporting (measured vs AI-narrative separation). Backend: jobs/executions orchestration, approvals, git push (token hygiene), CI dispatch/import. Frontend: live timeline reducer, review/approval surfaces, regression page. Sample app + seeded defects. Fine-tuning implementation: dataset build (seeds→gold→JSONL, validation gates), QLoRA configs, export pipeline. Branch-only extension: UI Scanner locator ladder (explicitly unmerged). Implementation limitations (HTML-only scanning, process-local event bus, generated-code defects that passed gates).
Evidence: file anchors per evidence register §3–§4; figures F2/F4/F5.

### Ch 6 — Experimental Design and Data Collection (≈1,100)
E1 Pre-trained comparison: 3 models (qwen2.5, qwen2.5-coder, deepseek-r1:8b), 6 benchmark items, 3 repetitions, temp 0.1, 13-metric rubric, judge qwen3.5:397b-cloud (designed; execution status per evidence), data in eval_results.sqlite + evaluation workbook. E2 Fine-tuning: synthetic corpus (24 train / 3 held-out features), QLoRA configs, training/eval procedure (`finetune/eval.py` held-out run + platform-based manual runs on sample-app features), before/after workbook. E3 System-level validation: generated UI/API/regression suites executed against the sample app (107 artefact dirs), preflight verification, CI pipeline design + (pending) run evidence; seeded-defect detection procedure (pending small experiment). Data-collection instruments and storage locations tabulated; provenance caveats stated.

### Ch 7 — Results and Analysis (≈1,600)
7.1 E1: latency, per-task metrics, aggregate scores; deepseek-r1 sparse-coverage caveat; reconciliation of workbook vs database figures. 7.2 E2: loss curves (planner convergence vs coder overfit at iter 43); held-out eval_report.json deltas (compiles 1/3→2/3, pytestmark 0/3→3/3, latency ×3); workbook before/after tables (where provenance holds); the operational contradiction (run-headed.sh reversion, hallucinated page-object methods) presented as a first-class finding. 7.3 E3: suite composition and execution outcomes; real failure exemplars (strict-mode violation junit.xml); gate efficacy including two gate-miss exemplars; regression comparison outputs. All measured results labelled measured; no significance claims.

### Ch 8 — Discussion and Evaluation (≈1,200)
Answers RQ1–RQ3 explicitly from evidence. Comparison with literature (e.g. executability rates vs TestPilot/Li et al.; governance vs SWE-agent autonomy). Why measurable metrics beat judgement alone (RQ2) — the fine-tune contradiction as the central exhibit. Threats to validity: internal (n=1 cells, judge absent, single-rater "satisfaction", metric-scale inconsistencies), external (single synthetic target app, 7B local models), construct (proxy metrics vs real defect detection), reliability/reproducibility (fixed seeds, deterministic dataset — strong; missing raw eval artefacts — weak). Ethical considerations.

### Ch 9 — Conclusion, Limitations and Future Work (≈700)
Contributions vs objectives; honest statement of incomplete strands (judge, SUS, CI runs, scanner unmerged); future work (best-checkpoint re-export, defect-detection experiment at scale, SPA-capable scanning, judge calibration, usability study).

## References (uncounted; Harvard; per reference_verification.md)

## Appendices (uncounted)
A Ethical approval form **[awaited]** · B Primary data (anonymised): sample junit.xml, eval_report.json, eval_results.sqlite exported tables, dataset JSONL records, training-log excerpts, evaluation workbook extracts · C CI workflow YAML (branch-qualified) + regression gate script · D Codegen system prompts (UI + API) · E Validation-gate rule tables + self-check · F Sample generated tests (one good UI, one good API, one defective + analysis) + provenance manifest · G Application screenshots (12-item list) · H SRS extract **[awaited]** · I Source-code extracts + repository reference · J Approved proposal CSC-40040 · K Fine-tuning configs + Modelfile · L Submission/AI-use declarations as required.

## Figures (numbered at draft time)
F1 container architecture; F2 pipeline with approval gates; F3 live telemetry path; F4 state machines; F5 validation-gate ordering; F6 marker algebra/CI suites; F7 planner+coder loss curves (graph); F8 E1 metric comparison chart (graph); F9 before/after fine-tune chart (graph); F10 screenshots (live timeline, automation review, regression page, approvals, report); F11 locator ladder (branch-qualified); F12 fine-tune pipeline (dataset→QLoRA→GGUF→Ollama).

## Tables
T1 role×permission matrix; T2 engine endpoints; T3 generated-suite composition; T4 fine-tune configuration; T5 E1 results; T6 E2 before/after results (+provenance column); T7 rubric weights; T8 seeded defects; T9 quantisation/deployment; T10 requirements summary; T11 threats to validity.

## Word-count governance
Counted body target 12,500 ± 500; reported at submission as (a) counted body and (b) total document. Budget enforced per chapter at drafting; any overrun rebalanced before Ch9 is finalised.
