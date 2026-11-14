"""Save every listing's Matterport floor plan (rooms, walls, floors, panos) to data/geometry/<sid>.json.

The app reads these instead of calling the Matterport Model API, so the editor and the
sky-to-house flight never wait on it. Like the rest of data/, the output is git-ignored but
deployed (see .vercelignore).

It asks the running dev server (`npm run dev`) for each model, so the files are exactly what
/api/models/<sid> returns. Re-running skips models already saved.

Usage (from the repo root, with the dev server up):
  python3 scripts/build_geometry.py [--base http://localhost:3000] [--workers 2]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = os.path.join("data", "geometry")


def fetch(base, sid):
    path = os.path.join(OUT, f"{sid}.json")
    if os.path.exists(path):
        return "cached"
    # The Model API rate-limits (HTTP 429, surfaced by the app as a 502): back off and retry.
    for attempt in range(6):
        try:
            with urllib.request.urlopen(f"{base}/api/models/{sid}", timeout=60) as res:
                body = json.load(res)
            break
        except urllib.error.HTTPError as e:
            if b"429" not in e.read() or attempt == 5:
                return f"error {e}"
            time.sleep(5 * 2**attempt)
        except Exception as e:  # noqa: BLE001 - keep going; a re-run retries
            return f"error {e}"
    if body.get("error") or not body.get("rooms"):
        return f"error {body.get('error', 'no rooms')}"
    with open(path, "w") as f:
        json.dump(body, f, separators=(",", ":"))
    return "saved"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    with open(os.path.join("data", "listings.json")) as f:
        data = json.load(f)
    sids = sorted({l["sid"] for k in ("homes", "apartments") for l in data[k] if l.get("sid")})
    os.makedirs(OUT, exist_ok=True)

    counts = {}
    with ThreadPoolExecutor(args.workers) as pool:
        for i, result in enumerate(pool.map(lambda s: fetch(args.base, s), sids), 1):
            key = result.split(" ")[0]
            counts[key] = counts.get(key, 0) + 1
            if i % 200 == 0 or i == len(sids):
                print(f"{i}/{len(sids)} {counts}", flush=True)
    sys.exit(0 if counts.get("error", 0) < len(sids) else 1)


if __name__ == "__main__":
    main()
