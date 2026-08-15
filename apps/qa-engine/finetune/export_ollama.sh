#!/usr/bin/env bash
# Export a trained LoRA adapter as a quantized Ollama model.
#
#   finetune/export_ollama.sh planner   -> ollama model qwen2.5-qa:latest
#   finetune/export_ollama.sh coder     -> ollama model qwen2.5-coder-qa:7b
#
# Steps: fuse adapters onto the bf16 base (HF download on first run) ->
# convert to GGUF f16 (llama.cpp) -> quantize Q4_K_M -> `ollama create`
# with the stock model's chat template. Intermediates (~30 GB) are removed
# after the Ollama model is created; adapters are kept for re-export.
set -euo pipefail

ROLE="${1:?usage: export_ollama.sh planner|coder}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # apps/qa-engine

case "$ROLE" in
  planner)
    BF16_REPO="Qwen/Qwen2.5-7B-Instruct"
    OLLAMA_NAME="qwen2.5-qa:latest"
    BASE_OLLAMA="qwen2.5:latest"
    ;;
  coder)
    BF16_REPO="Qwen/Qwen2.5-Coder-7B-Instruct"
    OLLAMA_NAME="qwen2.5-coder-qa:7b"
    BASE_OLLAMA="qwen2.5-coder:7b"
    ;;
  *) echo "unknown role '$ROLE' (planner|coder)" >&2; exit 1 ;;
esac

WORK="finetune/work/$ROLE"
ADAPTERS="$WORK/adapters"
FUSED="$WORK/fused"
GGUF_F16="$WORK/model-f16.gguf"
GGUF_Q4="$WORK/model-q4_k_m.gguf"
MODELFILE="$WORK/Modelfile"

[ -f "$ADAPTERS/adapters.safetensors" ] || { echo "no trained adapters at $ADAPTERS" >&2; exit 1; }
command -v llama-quantize >/dev/null || { echo "llama-quantize not found (brew install llama.cpp)" >&2; exit 1; }
command -v ollama >/dev/null || { echo "ollama not found" >&2; exit 1; }

echo "[export:$ROLE] 1/4 fusing adapters onto $BF16_REPO (downloads bf16 weights on first run)…"
uv run mlx_lm.fuse --model "$BF16_REPO" --adapter-path "$ADAPTERS" --save-path "$FUSED"

echo "[export:$ROLE] 2/4 converting to GGUF f16…"
uv run python finetune/work/llama.cpp/convert_hf_to_gguf.py "$FUSED" \
  --outfile "$GGUF_F16" --outtype f16

echo "[export:$ROLE] 3/4 quantizing Q4_K_M…"
llama-quantize "$GGUF_F16" "$GGUF_Q4" Q4_K_M >/dev/null

echo "[export:$ROLE] 4/4 creating Ollama model ${OLLAMA_NAME}…"
# Keep the stock model's TEMPLATE/PARAMETER lines; swap in our quantized GGUF.
ollama show --modelfile "$BASE_OLLAMA" \
  | sed "s|^FROM .*|FROM $PWD/$GGUF_Q4|" > "$MODELFILE"
ollama create "$OLLAMA_NAME" -f "$MODELFILE"

echo "[export:$ROLE] cleaning intermediates…"
rm -f "$GGUF_F16"
rm -rf "$FUSED"

echo "[export:$ROLE] done — try: ollama run $OLLAMA_NAME"
