#!/usr/bin/env bash
#
# One-time FIRST publish of all 12 rifty packages with a token.
#
# Why a token (just this once): npm OIDC trusted publishing cannot create a
# package name that does not exist yet (npm/cli#8544). After this initial
# publish, add a GitHub Actions trusted publisher to each package on npmjs.com
# (see docs/PUBLISHING.md) and every subsequent release is TOKENLESS via
# .github/workflows/release.yml on a `v*` tag.
#
# The publish set: ./packages/* (11, incl. the unscoped umbrella `rifty`) plus
# @riftydev/shadow-registry. apps/playground + test fixtures stay private and are
# never matched by the filter.
#
# Usage:
#   NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh
#   NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --dry-run
#
# The token needs publish rights to BOTH the @riftydev scope AND the unscoped
# `rifty` name. It is read from $NPM_TOKEN and never written to disk: the
# throwaway npmrc holds the literal string `${NPM_TOKEN}`, which pnpm interpolates
# from the environment at read time. The temp file is removed on exit.

set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY="--dry-run"
  echo "▶ DRY RUN — packs every package, contacts no registry, publishes nothing."
fi

echo "▶ building libraries (tsup → dist/)…"
pnpm build:libs

echo "▶ bundling LICENSE into each package…"
for d in packages/*/ tools/shadow-registry/; do
  cp LICENSE "$d/LICENSE"
done

# Throwaway auth config. It contains the LITERAL `${NPM_TOKEN}` placeholder, not
# the secret — pnpm interpolates it from the environment when reading the file,
# so the token never lands on disk. Removed on any exit.
NPMRC="$(mktemp)"
# Clean up the temp auth file AND the LICENSE copies (they exist only to ride
# along in each tarball; the source of truth is the repo-root ./LICENSE).
trap 'rm -f "$NPMRC" packages/*/LICENSE tools/shadow-registry/LICENSE' EXIT
{
  echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'
  echo '@riftydev:registry=https://registry.npmjs.org/'
} >"$NPMRC"

echo "▶ publishing @riftydev/* + unscoped rifty (access public)…"
NPM_CONFIG_USERCONFIG="$NPMRC" \
  pnpm -r --filter "./packages/*" --filter "@riftydev/shadow-registry" \
  publish --access public --no-git-checks $DRY

if [ -n "$DRY" ]; then
  echo "✓ dry run complete — all 12 packages packed cleanly."
else
  echo "✓ published. Next: on npmjs.com add a GitHub Actions trusted publisher to"
  echo "  each of the 12 packages (owner=vanilla-wave, repo=rifty,"
  echo "  workflow=release.yml). Then 'git tag vX.Y.Z && git push origin vX.Y.Z'"
  echo "  publishes tokenlessly. Revoke this token once that is verified."
fi
