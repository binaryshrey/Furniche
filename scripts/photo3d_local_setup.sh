#!/usr/bin/env bash
# Sets up Photo to 3D on this computer (scripts/photo3d_local.py): TripoSR on PyTorch, about 2 GB of
# downloads into .cache/photo3d-local (git-ignored). Reuses the PyTorch you already have.
set -euo pipefail
cd "$(dirname "$0")/.."
L=.cache/photo3d-local
mkdir -p "$L/models"
python3 -c "import torch" 2>/dev/null || { echo "Install PyTorch first: https://pytorch.org/get-started/locally/"; exit 1; }
[ -d "$L/venv" ] || python3 -m venv --system-site-packages "$L/venv"
"$L/venv/bin/pip" install -q --disable-pip-version-check "omegaconf==2.3.0" "transformers==4.46.3" "trimesh==4.5.3" \
  "huggingface_hub<1" scikit-image einops onnxruntime opencv-python-headless fastapi uvicorn pillow
if [ ! -d "$L/TripoSR" ]; then
  git clone -q https://github.com/VAST-AI-Research/TripoSR.git "$L/TripoSR"
  git -C "$L/TripoSR" checkout -q 107cefdc244c39106fa830359024f6a2f1c78871
fi
[ -f "$L/models/isnet-general-use.onnx" ] ||
  curl -sSL -o "$L/models/isnet-general-use.onnx" https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
"$L/venv/bin/python" -c "
from huggingface_hub import hf_hub_download
for f in ('config.yaml', 'model.ckpt'):
    hf_hub_download('stabilityai/TripoSR', f, local_dir='$L/models/TripoSR')
"
"$L/venv/bin/pip" cache purge >/dev/null 2>&1 || true
echo "Ready. Start it with: $L/venv/bin/python scripts/photo3d_local.py"
echo "Then set PHOTO3D_GPU_URL=http://127.0.0.1:8765 in .env.local and restart npm run dev."
