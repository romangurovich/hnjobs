#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/packages/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
TARGET_DIR="$ROOT_DIR/.local/d1-datagrip"
TARGET_BASENAME="hnjobs-local.sqlite"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: ./scripts/copy-local-d1.sh

Copies the local Wrangler D1 SQLite database into a stable, gitignored
repo-root directory for tools like DataGrip.

Target path:
  ./.local/d1-datagrip/hnjobs-local.sqlite

Notes:
  - Stop `wrangler dev` / `bun run dev` first for the cleanest copy.
  - Produces a standalone SQLite file for DataGrip without WAL/SHM sidecars.
EOF
  exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Local D1 state directory not found: $SOURCE_DIR" >&2
  echo "Start the API locally at least once or run a local D1 command first." >&2
  exit 1
fi

shopt -s nullglob
sqlite_files=("$SOURCE_DIR"/*.sqlite)
shopt -u nullglob

if [[ "${#sqlite_files[@]}" -eq 0 ]]; then
  echo "No local D1 SQLite database found in: $SOURCE_DIR" >&2
  exit 1
fi

if [[ "${#sqlite_files[@]}" -gt 1 ]]; then
  echo "Multiple local D1 SQLite files found. Refusing to guess:" >&2
  printf '  %s\n' "${sqlite_files[@]}" >&2
  exit 1
fi

SOURCE_SQLITE="${sqlite_files[0]}"
TARGET_SQLITE="$TARGET_DIR/$TARGET_BASENAME"
TEMP_SQLITE="$TARGET_DIR/.${TARGET_BASENAME}.tmp"

mkdir -p "$TARGET_DIR"
rm -f "$TARGET_SQLITE" "$TEMP_SQLITE" "${TARGET_SQLITE}-wal" "${TARGET_SQLITE}-shm"

if ! sqlite3 "$SOURCE_SQLITE" ".timeout 2000" ".backup '$TEMP_SQLITE'" >/dev/null; then
  echo "Failed to create a clean SQLite backup from the local D1 database." >&2
  echo "If the source database is busy, stop \`wrangler dev\` / \`bun run dev\` and try again." >&2
  rm -f "$TEMP_SQLITE"
  exit 1
fi

sqlite3 "$TEMP_SQLITE" "PRAGMA journal_mode=DELETE; VACUUM;" >/dev/null
mv "$TEMP_SQLITE" "$TARGET_SQLITE"

cat <<EOF
Copied local D1 database for DataGrip:
  $TARGET_SQLITE

Open this file in DataGrip as a SQLite data source.
EOF
