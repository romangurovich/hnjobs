#!/usr/bin/env bash
set -euo pipefail

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but not installed." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="hnj-dev"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists. Attaching..."
  exec tmux attach-session -t "$SESSION"
fi

tmux new-session -d -s "$SESSION" -c "$ROOT/packages/api" 'bun run dev'
tmux rename-window -t "$SESSION:0" 'api'

tmux new-window -t "$SESSION" -n 'admin-api' -c "$ROOT/packages/admin/api" 'bun run dev'
tmux new-window -t "$SESSION" -n 'admin-ui' -c "$ROOT/packages/admin/ui" 'bun run dev'
tmux new-window -t "$SESSION" -n 'ui' -c "$ROOT/packages/ui" 'bun run dev'
tmux new-window -t "$SESSION" -n 'worker' -c "$ROOT/packages/worker" 'bun run dev 2>&1 | tee -a worker.log'

tmux select-window -t "$SESSION:0"
tmux attach-session -t "$SESSION"

