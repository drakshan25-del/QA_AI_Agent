"""Local fine-tuning pipeline for the QA agents' Ollama models.

Builds schema-validated training data from the real agent prompts
(``agents.test_plan_agent``, ``agents.test_case_agent``,
``agents.automation_agent``), LoRA-trains Qwen2.5 / Qwen2.5-Coder with MLX,
and exports the tuned models back into Ollama. See ``finetune/README.md``.
"""
