---
area: playground
status: draft
title: Install-stamp invalidation strategy
created: 2026-06-12
why: stamp trusts node_modules wholesale; a corrupted-but-stamped tree boots a broken dev server with no self-heal
user_story: As a playground dev with OPFS `node_modules` truncated by a crash mid-flush, want boot to re-install the corrupt-but-stamped tree, but `installStampSatisfied` skips `install()` on matching `.rifty-install-stamp.json` so dev server boots broken till I hand-run `npm install`.
sources: [docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/src/glue/install-stamp.ts]
---

## Context

ADR-0135: worker bootstrap skips `install()` when `<root>/node_modules/.rifty-install-stamp.json` matches package.json effective deps and `node_modules/` exists. Stamp = "this tree was fully installed for deps D"; nothing verifies the tree afterwards (partial OPFS flush on crash, manual deletions in explorer). Current escape hatch: terminal `npm install` ignores the stamp and re-installs.

Boot-side identity is a LOSSY flat map (review r5, 2026-07-11): `installStampSatisfied*` compares dependencies ∪ devDependencies ∪ optionalDependencies — a section move or an `overrides` edit changes the installer request with an identical flat map, so boot can reuse a tree resolved under stale inputs. The command-site stamp guard is already byte-exact (ADR-0216 r5 note); closing boot needs a stamp identity that covers sections + overrides (schema bump, one-time re-install).

## Options or Next

- Lockfile cross-check at skip time (cheap: lockfile exists + parses).
- Spot-check N package.json files under node_modules against the lockfile.
- Stamp a content hash of the lockfile; mismatch → fall through to install.
- Do nothing until a real corruption shows up (current choice).

## Reversibility

REVERSIBLE — provisional judgment recorded here; skip predicate is one function (`installStampSatisfied`).
