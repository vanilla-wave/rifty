#!/usr/bin/env bash
#
# One-time FIRST publish of the rifty packages with a token (15: the 14 libs +
# the @riftydev/eddy service). Pass --only <filter> to bootstrap a single new
# name later (e.g. --only @riftydev/eddy) without re-publishing the rest.
#
# Why a token (just this once): npm OIDC trusted publishing cannot create a
# package name that does not exist yet (npm/cli#8544). After this initial
# publish, add a GitHub Actions trusted publisher to each package on npmjs.com
# (see docs/PUBLISHING.md) and every subsequent release is TOKENLESS via
# .github/workflows/release.yml on a `v*` tag.
#
# The publish set: ./packages/* (11, incl. the umbrella `@riftydev/sdk`),
# @riftydev/shadow-registry, and the @riftydev/eddy service (services/eddy).
# apps/playground + test fixtures stay private and are never matched by the
# filter.
#
# Usage:
#   NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh
#   NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --dry-run
#   NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --only @riftydev/eddy
#
# The token needs publish rights to the @riftydev scope. Since these names don't
# exist yet, a granular token can't pre-select them — create it with
# "All packages" + Read and write + Bypass 2FA (npm removed classic/automation
# tokens in Nov 2025). It is read from $NPM_TOKEN and never written to disk: the
# throwaway npmrc holds the literal string `${NPM_TOKEN}`, which pnpm interpolates
# from the environment at read time. The temp file is removed on exit.

set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY="--dry-run"
      echo "▶ DRY RUN — packs, contacts no registry, publishes nothing." ;;
    --only)
      shift
      ONLY="${1:-}"
      [ -n "$ONLY" ] || { echo "✗ --only needs a package filter, e.g. --only @riftydev/eddy" >&2; exit 2; } ;;
    *)
      echo "✗ unknown argument: $1 (expected --dry-run and/or --only <filter>)" >&2; exit 2 ;;
  esac
  shift
done

echo "▶ building libraries (tsup → dist/)…"
pnpm build:libs

echo "▶ bundling LICENSE into each package…"
for d in packages/*/ tools/shadow-registry/ services/eddy/; do
  cp LICENSE "$d/LICENSE"
done

# Throwaway auth config. It contains the LITERAL `${NPM_TOKEN}` placeholder, not
# the secret — pnpm interpolates it from the environment when reading the file,
# so the token never lands on disk. Removed on any exit.
NPMRC="$(mktemp)"
# Clean up the temp auth file AND the LICENSE copies (they exist only to ride
# along in each tarball; the source of truth is the repo-root ./LICENSE).
trap 'rm -f "$NPMRC" packages/*/LICENSE tools/shadow-registry/LICENSE services/eddy/LICENSE' EXIT
{
  echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'
  echo '@riftydev:registry=https://registry.npmjs.org/'
} >"$NPMRC"

if [ -n "$ONLY" ]; then
  FILTERS=(--filter "$ONLY")
  echo "▶ publishing ONLY $ONLY (access public)…"
else
  FILTERS=(--filter "./packages/*" --filter "@riftydev/shadow-registry" --filter "@riftydev/eddy")
  echo "▶ publishing @riftydev/* (incl. the @riftydev/sdk umbrella + eddy, access public)…"
fi
NPM_CONFIG_USERCONFIG="$NPMRC" \
  pnpm -r "${FILTERS[@]}" \
  publish --access public --no-git-checks $DRY

if [ -n "$DRY" ]; then
  echo "✓ dry run complete — packed cleanly."
else
  echo "✓ published. Next: on npmjs.com add a GitHub Actions trusted publisher to"
  echo "  each published name (owner=vanilla-wave, repo=rifty, workflow=release.yml)."
  echo "  Then 'git tag vX.Y.Z && git push origin vX.Y.Z' publishes tokenlessly."
  echo "  Revoke this token once that is verified."
fi
