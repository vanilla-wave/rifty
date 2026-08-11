#!/usr/bin/env bash
#
# Phase 2 of docs/public/publishing.md: attach the GitHub Actions trusted
# publisher (owner=vanilla-wave, repo=rifty, workflow=release.yml, no
# environment) to EVERY published @riftydev/* name, so `v*` tags publish
# tokenlessly via OIDC.
#
# AUTH: `npm trust` REJECTS tokens — granular tokens (even with Bypass 2FA)
# get 403, per npm docs. The ONLY working path is an interactive `npm login`
# session + web 2FA. On the FIRST browser prompt tick **"skip 2FA for the
# next 5 minutes"** — every remaining package then passes without re-auth.
# Run this in a real terminal (it prompts), NOT headless.
#
# Set: all non-private packages/* + shadow-registry + eddy. A name must already
# exist on the registry (Phase 1, first-publish.sh) — attaching trust to a missing
# name 404s; bootstrap it first, then re-run (or --only <name>).
#
# Idempotent: a package whose trust list already shows repo+workflow is
# skipped. Requires npm >= 11.15 (`npm trust`).
#
# Usage:
#   bash tools/publishing/setup-trusted-publishers.sh
#   bash tools/publishing/setup-trusted-publishers.sh --dry-run
#   bash tools/publishing/setup-trusted-publishers.sh --only @riftydev/sdk

set -euo pipefail
cd "$(dirname "$0")/../.."

REPO="vanilla-wave/rifty"
WORKFLOW="release.yml"
REGISTRY="https://registry.npmjs.org"

DRY=""
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY="--dry-run"
      echo "▶ DRY RUN — no trust config is written." ;;
    --only)
      shift
      ONLY="${1:-}"
      [ -n "$ONLY" ] || { echo "✗ --only needs a package name, e.g. --only @riftydev/sdk" >&2; exit 2; } ;;
    *)
      echo "✗ unknown argument: $1 (expected --dry-run and/or --only <name>)" >&2; exit 2 ;;
  esac
  shift
done

WHO="$(npm whoami --registry="$REGISTRY" 2>/dev/null)" || {
  echo "✗ not logged in to npmjs — run: npm login --registry=$REGISTRY" >&2
  echo "  (tokens don't work for trust ops; a login session is required)" >&2
  exit 1
}
echo "▶ npm session: $WHO"

NPM_VERSION="$(npm --version)"
node -e '
  const [major, minor] = process.argv[1].split(".").map(Number)
  process.exit(major > 11 || (major === 11 && minor >= 15) ? 0 : 1)
' "$NPM_VERSION" || {
  echo "✗ npm >= 11.15.0 is required for trusted publishing (found $NPM_VERSION)" >&2
  echo "  npm install -g npm@latest" >&2
  exit 1
}

# Registry requires a permissions field in the trust config.
npm trust github --help 2>&1 | grep -q -- --allow-publish || {
  echo "✗ this npm lacks 'npm trust github --allow-publish' — upgrade first:" >&2
  echo "  npm install -g npm@latest" >&2
  exit 1
}

if [ -n "$ONLY" ]; then
  PKGS=("$ONLY")
else
  PKGS=()
  for f in packages/*/package.json tools/shadow-registry/package.json services/eddy/package.json; do
    name="$(node -e 'const p=require(require("path").resolve(process.argv[1])); if (!p.private) console.log(p.name)' "$f")"
    [ -n "$name" ] && PKGS+=("$name")
  done
fi
echo "▶ target: ${#PKGS[@]} package(s), publisher = $REPO / $WORKFLOW"
echo "▶ on the FIRST browser 2FA prompt tick 'skip 2FA for 5 minutes'"

FAIL=0
for pkg in "${PKGS[@]}"; do
  echo "== $pkg"
  # skip names not on the registry — trust POST would 404
  if ! npm view "$pkg" version --registry="$REGISTRY" >/dev/null 2>&1; then
    echo "  ✗ not on the registry — bootstrap first: first-publish.sh --only $pkg"
    FAIL=1
    continue
  fi
  # Skip only the exact publish-capable config used by release.yml. A staged-only
  # publisher or an npm Environment binding cannot authenticate this workflow.
  current="$(npm trust list "$pkg" --json --registry="$REGISTRY" 2>&1)" || current=""
  if TRUST_JSON="$current" node -e '
    let config
    try {
      config = JSON.parse(process.env.TRUST_JSON)
    } catch {
      process.exit(1)
    }
    const [repository, file] = process.argv.slice(1)
    const configs = Array.isArray(config) ? config : [config]
    const matches = configs.some(entry =>
      entry.type === "github" &&
      entry.repository === repository &&
      entry.file === file &&
      !Object.hasOwn(entry, "environment") &&
      Array.isArray(entry.permissions) &&
      entry.permissions.includes("createPackage")
    )
    process.exit(matches ? 0 : 1)
  ' "$REPO" "$WORKFLOW"; then
    echo "  ✓ already trusted ($REPO / $WORKFLOW) — skip"
    continue
  fi
  if npm trust github "$pkg" --repo "$REPO" --file "$WORKFLOW" --allow-publish -y $DRY --registry="$REGISTRY"; then
    if [ -n "$DRY" ]; then
      echo "  ✓ would add trusted publisher"
    else
      echo "  ✓ trusted publisher added"
    fi
  else
    echo "  ✗ npm trust github failed"
    FAIL=1
  fi
done

echo
if [ "$FAIL" -ne 0 ]; then
  echo "✗ some packages failed — fix and re-run (idempotent). Fallback: npmjs.com"
  echo "  → package → Settings → Trusted Publisher → GitHub Actions."
  exit 1
fi
if [ -n "$DRY" ]; then
  echo "✓ dry run complete; no trust config was written."
else
  echo "✓ all trusted publishers in place. Then a 'v*' tag publishes tokenlessly."
fi
