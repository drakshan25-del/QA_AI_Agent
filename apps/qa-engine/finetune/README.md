# Fine-tuning the QA agents' local models

This directory fine-tunes the two Ollama models the engine uses, on-device
(Apple silicon, MLX QLoRA):

| Role    | Base model            | Fine-tuned Ollama model | Used by |
|---------|-----------------------|-------------------------|---------|
| planner | `qwen2.5:latest`      | `qwen2.5-qa:latest`     | Test plan + test case generation (per-project `llmModel`) |
| coder   | `qwen2.5-coder:7b`    | `qwen2.5-coder-qa:7b`   | Automation script generation (`QA_LLM_CODER_MODEL`) |

## Why this works

The agents call Ollama through LangChain structured output, so the JSON
*shape* is already constrained at inference time. What fine-tuning improves is
the *content*: full §8.5 field coverage, category diversity (positive /
negative / boundary / validation / role_based / error_handling / security),
justified test types in plans, and automation code that follows every
framework rule (accessibility-first locators through `BasePage` helpers,
web-first `expect`, fixtures instead of literals, `# TC:` traceability,
page-object emission when a module is missing).

Training examples use the **real production prompts** imported from
`agents/test_plan_agent.py`, `agents/test_case_agent.py` and
`agents/automation_agent.py`, so training traffic == production traffic.

## Data

`seeds.py` defines 27 features across 8 fictional apps as compact specs;
`gold.py` expands each spec into requirement text, analysis, 8–13 test cases,
a test plan, a page object and a pytest file — all describing the same
behaviour, so labels are correct by construction. `build_dataset.py` renders
chat-format JSONL and **fails the build** if any label does not validate
against the real Pydantic schemas, does not compile, or breaks a framework
rule. The `Beacon Helpdesk` app is fully held out for evaluation.

```
uv run python -m finetune.build_dataset        # writes finetune/data/*
```

## Train (≈1–2 h per model on an M-series Mac, run sequentially — 16 GB RAM)

```
uv run mlx_lm.lora -c finetune/configs/planner.yaml   # logs: finetune/work/planner_train.log
uv run mlx_lm.lora -c finetune/configs/coder.yaml
```

## Export to Ollama

```
finetune/export_ollama.sh planner    # -> qwen2.5-qa:latest
finetune/export_ollama.sh coder     # -> qwen2.5-coder-qa:7b
```

Fuses adapters onto the bf16 base (first run downloads ~15 GB per model),
converts with llama.cpp `convert_hf_to_gguf.py`, quantizes to Q4_K_M
(~4.7 GB, same size class as the stock models) and registers the model in
Ollama reusing the stock model's chat template. Intermediates are deleted.

## Wire into the project

* Planner: set the project's **Settings → LLM model** to `qwen2.5-qa:latest`
  (or update `projects.llm_model` in the DB).
* Coder: `QA_LLM_CODER_MODEL=qwen2.5-coder-qa:7b` (already defaulted in
  `run-headed.sh` and `docker-compose.yml`). The engine automatically falls
  back to the project model while that Ollama model does not exist yet.

## Evaluate (held-out app, real agents end to end)

```
uv run python -m finetune.eval \
    --planner-models qwen2.5:latest,qwen2.5-qa:latest \
    --coder-models qwen2.5-coder:7b,qwen2.5-coder-qa:7b
```

Writes `finetune/work/eval_report.json` with per-feature scores: structured
output success, case counts/categories, plan section coverage, and for
automation: compiles / no forbidden patterns / imports resolve / pytestmark /
TC comments.
