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

# Production-truth smoke (added 2026-11-04): unit tests stub Workers AI,
# so they cannot catch production binding/error-surface failures - the
# smoke script is the mechanical gate that does. It prints its command
# always; it RUNS when an Access service token is in env (create one
# scoped to this app for the run, revoke it after).
echo "deploy.sh: post-deploy production smoke:  SMOKE_ACCESS_CLIENT_ID=... SMOKE_ACCESS_CLIENT_SECRET=... node scripts/smoke.mjs"
if [ -n "${SMOKE_ACCESS_CLIENT_ID:-}" ] && [ -n "${SMOKE_ACCESS_CLIENT_SECRET:-}" ]; then
  echo "deploy.sh: running production smoke..."
  node scripts/smoke.mjs || echo "deploy.sh: WARNING - smoke reported failures (deploy itself succeeded); investigate before calling this shipped"
fi
