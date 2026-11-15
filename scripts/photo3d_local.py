"""Furniche Photo to 3D on this computer, with PyTorch: free, offline once set up, no daily limits.

TripoSR (Stability AI and Tripo, MIT) builds the shape on the Mac's GPU (MPS), or CUDA, or the CPU.
The side of the piece the camera saw is painted with the photo itself, so it keeps every detail;
the rest takes TripoSR's own colours. The piece is cut out of the photo first with ISNet.

It serves the same small job API as scripts/photo3d_gpu.ipynb, so the app only needs
    PHOTO3D_GPU_URL=http://127.0.0.1:8765
Set up once with `bash scripts/photo3d_local_setup.sh`, then run
    .cache/photo3d-local/venv/bin/python scripts/photo3d_local.py
The live site can use it too, from this computer's browser: open http://127.0.0.1:8765/connect once.
"""

import argparse
import gc
import io
import math
import os
import queue
import sys
import threading
import time
import traceback
import types
import uuid
from pathlib import Path
from urllib.parse import quote

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")  # the few ops MPS lacks run on the CPU

import cv2
import numpy as np
import onnxruntime as ort
import torch
import trimesh
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from PIL import Image
from skimage.measure import marching_cubes as skimage_marching_cubes

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".cache" / "photo3d-local"
QUALITY = {"quick": 192, "detail": 256}  # marching-cubes grid: finer is slower
FOV_DEG = 40.0  # TripoSR's input camera


# TripoSR extracts its surface with torchmcubes, which needs compiling; scikit-image does the same job.
def _marching_cubes(volume: torch.Tensor, level: float):
    verts, faces, _, _ = skimage_marching_cubes(volume.detach().float().cpu().numpy(), level)
    return torch.from_numpy(verts[:, ::-1].copy()).float(), torch.from_numpy(faces.astype(np.int64))


sys.modules["torchmcubes"] = types.SimpleNamespace(marching_cubes=_marching_cubes)
# tsr.utils imports rembg for a background remover this script never calls (it cuts pieces out with ISNet).
sys.modules.setdefault("rembg", types.ModuleType("rembg"))
sys.path.insert(0, str(LOCAL / "TripoSR"))
from tsr.system import TSR  # noqa: E402
from tsr.utils import resize_foreground  # noqa: E402

DEVICE = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"


def env_token() -> str:
    """PHOTO3D_GPU_TOKEN from the environment or the app's .env.local, so both sides agree."""
    token = os.environ.get("PHOTO3D_GPU_TOKEN", "")
    env = ROOT / ".env.local"
    if not token and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("PHOTO3D_GPU_TOKEN="):
                token = line.split("=", 1)[1].strip()
    return token


TOKEN = env_token()
options = ort.SessionOptions()
options.enable_cpu_mem_arena = False  # hand ISNet's working memory (about a gigabyte) back after each cut-out
cutter = ort.InferenceSession(str(LOCAL / "models" / "isnet-general-use.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
model = TSR.from_pretrained(str(LOCAL / "models" / "TripoSR"), config_name="config.yaml", weight_name="model.ckpt")
model.renderer.set_chunk_size(8192)
model.to(DEVICE)


def cut_out(img: Image.Image) -> Image.Image:
    """The piece on a transparent background (ISNet, as rembg runs it). A cut-out stays as it is."""
    img = img.convert("RGBA")
    if img.getchannel("A").getextrema()[0] < 255:
        return img
    rgb = img.convert("RGB")
    x = np.asarray(rgb.resize((1024, 1024), Image.LANCZOS), np.float32)
    x = (x / max(float(x.max()), 1e-6) - 0.5).transpose(2, 0, 1)[None]
    pred = cutter.run(None, {cutter.get_inputs()[0].name: x})[0][0, 0]
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    out = rgb.copy()
    out.putalpha(Image.fromarray((pred * 255).astype(np.uint8)).resize(rgb.size, Image.LANCZOS))
    return out


def project(points: np.ndarray, distance: float) -> np.ndarray:
    """Points (TripoSR frame: Z up, camera on +X looking at the origin) to image coordinates in 0..1."""
    f = 0.5 / math.tan(math.radians(FOV_DEG) / 2)
    depth = np.maximum(distance - points[:, 0], 1e-3)
    return np.stack([0.5 + f * points[:, 1] / depth, 0.5 - f * points[:, 2] / depth], axis=1)


def photo_uvs(vertices: np.ndarray, alpha: np.ndarray):
    """Where each vertex lands in the photo. The camera distance is the one whose silhouette box best
    matches the piece in the photo; a final stretch makes the boxes agree exactly."""
    ys, xs = np.nonzero(alpha)
    target = np.array([xs.min(), ys.min(), xs.max() + 1, ys.max() + 1], np.float64) / alpha.shape[0]

    def box(uv):
        return np.array([uv[:, 0].min(), uv[:, 1].min(), uv[:, 0].max(), uv[:, 1].max()])

    def iou(a, b):
        w = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
        h = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
        inter = w * h
        return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)

    distance = max(np.linspace(1.3, 3.0, 35), key=lambda d: iou(box(project(vertices, d)), target))
    uv = project(vertices, distance)
    b = box(uv)
    uv = (uv - b[:2]) / np.maximum(b[2:] - b[:2], 1e-6) * (target[2:] - target[:2]) + target[:2]
    return uv, distance


def build(cut: Image.Image, quality: str) -> bytes:
    resolution = QUALITY.get(quality, QUALITY["detail"])
    fg = resize_foreground(cut, 0.85)  # square, piece filling 85%, as TripoSR was trained
    arr = np.asarray(fg).astype(np.float32) / 255
    cond = Image.fromarray(((arr[..., :3] * arr[..., 3:4] + (1 - arr[..., 3:4]) * 0.5) * 255).astype(np.uint8))
    with torch.no_grad():
        codes = model([cond], device=DEVICE)
        mesh = model.extract_mesh(codes, True, resolution=resolution)[0]

    # Keep the main body, outward-facing.
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        mesh = max(parts, key=lambda m: len(m.faces))
    if mesh.volume < 0:
        mesh.invert()
    vertices, faces = mesh.vertices, mesh.faces
    colours = mesh.visual.vertex_colors[:, :3].astype(np.float32)
    normals = mesh.vertex_normals

    # Faces that look at the camera get the photo; the rest get TripoSR's colour, one flat patch each.
    alpha = np.asarray(fg)[..., 3] > 127
    uv_photo, distance = photo_uvs(vertices, alpha)
    centres = vertices[faces].mean(axis=1)
    towards = np.array([distance, 0.0, 0.0]) - centres
    towards /= np.linalg.norm(towards, axis=1, keepdims=True)
    facing = (mesh.face_normals * towards).sum(axis=1) > 0.15

    size = 1024  # texture: photo on the left half, colour patches on the right
    photo = np.asarray(fg.convert("RGB").resize((size, size), Image.LANCZOS)).copy()
    hole = (np.asarray(fg.getchannel("A").resize((size, size))) < 128).astype(np.uint8)
    photo = cv2.inpaint(photo, hole, 5, cv2.INPAINT_TELEA)  # bleed colours past the edge so seams don't go grey
    back = np.flatnonzero(~facing)
    per_row = max(1, math.ceil(math.sqrt(max(len(back), 1))))
    cell = max(1, size // per_row)
    patches = np.full((size, size, 3), 255, np.uint8)
    face_colour = colours[faces[back]].mean(axis=1).clip(0, 255).astype(np.uint8)
    rows, cols = np.divmod(np.arange(len(back)), per_row)
    for (r, c), colour in zip(zip(rows, cols), face_colour):
        patches[r * cell : (r + 1) * cell, c * cell : (c + 1) * cell] = colour
    atlas = Image.fromarray(np.concatenate([photo, patches], axis=1))

    # One vertex per face corner, so each face can use its own part of the texture.
    uv = np.zeros((len(faces), 3, 2))
    front = np.flatnonzero(facing)
    uv[front] = np.stack([uv_photo[faces[front]][..., 0] / 2, 1 - uv_photo[faces[front]][..., 1]], axis=-1)
    centre_u = 0.5 + (cols + 0.5) * cell / (2 * size)
    centre_v = 1 - (rows + 0.5) * cell / size
    uv[back] = np.stack([centre_u, centre_v], axis=-1)[:, None, :]

    # TripoSR's frame (Z up, camera on +X) to glTF's (Y up), with the photographed side facing +Z.
    turn = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], np.float64)
    out = trimesh.Trimesh(
        vertices=(vertices[faces].reshape(-1, 3)) @ turn.T,
        faces=np.arange(len(faces) * 3).reshape(-1, 3),
        visual=trimesh.visual.TextureVisuals(uv=uv.reshape(-1, 2), image=atlas),
        process=False,
    )
    out.vertex_normals = normals[faces].reshape(-1, 3) @ turn.T  # smooth shading across the split vertices
    return out.export(file_type="glb", include_normals=True)


# The job API: builds run one at a time; the app submits a job and polls it.
app = FastAPI()
SITE = "https://furniche-ai.vercel.app"  # where /connect sends the browser (--site)
PORT = 8765
# The live site (and its previews) call it from the browser (lib/photoDirect.ts), as does the app on this computer.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://furniche[a-z0-9-]*\.vercel\.app|http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network(req: Request, call_next):
    """Chrome checks before a public site reaches this computer; the origins above still apply."""
    res = await call_next(req)
    if req.headers.get("access-control-request-private-network") == "true":
        res.headers["Access-Control-Allow-Private-Network"] = "true"
    return res


jobs: dict = {}
pending: "queue.Queue" = queue.Queue()


def authorised(req: Request):
    if TOKEN and req.headers.get("authorization") != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="bad token")


def free_memory() -> str:
    """Give a build's working memory back, so the browser and the app don't run short between builds."""
    gc.collect()
    if DEVICE == "mps":
        torch.mps.empty_cache()
        return f", {torch.mps.driver_allocated_memory() / 2**30:.1f} GB kept on the GPU"
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
        return f", {torch.cuda.memory_reserved() / 2**30:.1f} GB kept on the GPU"
    return ""


def worker():
    while True:
        job_id, img, quality = pending.get()
        job = jobs.get(job_id)
        if job is None:
            continue
        job["state"] = "running"
        started = time.time()
        try:
            job["glb"] = build(img, quality)
            job["state"] = "done"
        except Exception as e:  # tell the app instead of dying
            traceback.print_exc()
            job["error"] = f"{type(e).__name__}: {e}"[:300]
            job["state"] = "failed"
        finally:
            job["seconds"] = round(time.time() - started, 1)
            print(f"job {job_id[:8]} {quality}: {job['state']} in {job['seconds']} s{free_memory()}", flush=True)


threading.Thread(target=worker, daemon=True).start()


@app.get("/connect")
def connect():
    """Opened once in the browser: the site's Photo to 3D then builds here. The #fragment stays in the browser."""
    return RedirectResponse(f"{SITE}/connect-gpu#url={quote(f'http://127.0.0.1:{PORT}', safe='')}&token={quote(TOKEN, safe='')}")


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "queued": pending.qsize()}


@app.post("/cutout")
async def cutout(req: Request):
    authorised(req)
    img = await run_in_threadpool(cut_out, Image.open(io.BytesIO(await req.body())))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.post("/jobs")
async def submit(req: Request, quality: str = "detail"):
    authorised(req)
    img = await run_in_threadpool(cut_out, Image.open(io.BytesIO(await req.body())))
    for old in [k for k, j in list(jobs.items()) if time.time() - j["at"] > 3600]:
        jobs.pop(old, None)  # forget results nobody collected within an hour
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"state": "queued", "at": time.time()}
    pending.put((job_id, img, quality if quality in QUALITY else "detail"))
    return {"id": job_id}


@app.get("/jobs/{job_id}")
def status(job_id: str, req: Request):
    authorised(req)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job")
    if job["state"] == "done":
        return Response(job["glb"], media_type="model/gltf-binary", headers={"X-Build-Seconds": str(job["seconds"])})
    if job["state"] == "failed":
        return JSONResponse({"state": "failed", "error": job["error"]}, status_code=500)
    ahead = sum(1 for j in list(jobs.values()) if j["state"] == "queued" and j["at"] < job["at"])
    return JSONResponse({"state": job["state"], "ahead": ahead}, status_code=202)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--site", default=SITE, help="the site /connect opens, e.g. http://localhost:3000")
    args = parser.parse_args()
    PORT, SITE = args.port, args.site.rstrip("/")
    print(f"Photo to 3D on {DEVICE} at http://127.0.0.1:{PORT}", flush=True)
    print(f"To use it from {SITE}, open http://127.0.0.1:{PORT}/connect once in that browser.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
