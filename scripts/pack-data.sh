#!/usr/bin/env bash
# Packs the git-ignored data/ folder into furniche-data.tar.gz and prints its sha256.
# Upload the archive somewhere private, then set DATA_ARCHIVE_URL (and DATA_ARCHIVE_SHA256) on Vercel.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f data/listings.json ] && [ -d data/geometry ] || { echo "data/ is missing listings.json or geometry/" >&2; exit 1; }
out="${1:-furniche-data.tar.gz}"
COPYFILE_DISABLE=1 tar -czf "$out" data
echo "wrote $out ($(du -h "$out" | cut -f1))"
if command -v shasum >/dev/null; then shasum -a 256 "$out"; else sha256sum "$out"; fi
