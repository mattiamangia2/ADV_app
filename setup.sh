#!/usr/bin/env sh
# macOS / Linux setup: run ./setup.sh in the ADV_app folder.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS from https://nodejs.org (or: brew install node), then run ./setup.sh again."
  exit 1
fi
exec node scripts/setup.mjs "$@"
