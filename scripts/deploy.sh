#!/usr/bin/env bash
# OpenHRV deploy — the ONLY supported deploy path.
#
# Why this exists: wrangler.toml carries GIT_SHA as a placeholder, and any
# bare `wrangler deploy` ships that placeholder to production (the served
# footer flipped to "build dev" on 2026-11-03 when a side path deployed
# unstamped). This script makes that impossible: it refuses a dirty or
# unpushed tree, runs the full check, and stamps GIT_SHA from the actual
# HEAD commit on every deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

SHA="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy aborted: working tree is dirty — commit first" >&2
  exit 1
fi
git fetch origin --quiet
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "HEAD" ]; then
  TIP="$(git rev-parse "origin/$BRANCH")"
  if [ "$SHA" != "$TIP" ]; then
    echo "deploy aborted: HEAD ($SHA) != origin/$BRANCH ($TIP) — push first" >&2
    exit 1
  fi
fi

npm run check
npx wrangler deploy --config wrangler.toml --var "GIT_SHA:$SHA"
echo "deployed GIT_SHA=$SHA"
