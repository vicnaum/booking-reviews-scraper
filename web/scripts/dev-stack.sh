#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKER_PID=""

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

docker compose up -d
npm run db:push

npm run worker > ./.worker-dev.log 2>&1 &
WORKER_PID=$!

echo "Worker started as PID $WORKER_PID"
echo "Worker log: $ROOT_DIR/.worker-dev.log"

npm run dev
