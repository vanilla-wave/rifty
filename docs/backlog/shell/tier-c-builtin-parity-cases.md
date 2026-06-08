---
area: shell
status: active
title: Tier-c builtin node-parity cases tracked for the DoD closer
created: 2026-06-08
why: ADR-0093(c) mandates a node-parity case per tier-c builtin; landed builtins ship vitest units but no parity cases yet
sources: [Q-2026-06-07-410, adr/shell/0093-shell-command-parity-harness.md, adr/vfs/0090-vfs-copy-rename-sync-primitives.md]
---

## Context

Path-math builtins (basename/dirname/realpath) are string-only → a node:fs parity case would be engine-identical (the force-fit anti-pattern ADR-0093 warns against); their honest parity rides on rifty's node:path parity (existing `cases/path`).

## Options or Next

Genuinely non-redundant cases to add before the milestone-DoD closer: ADR-0090 fs primitives (renameSync mtime / cpSync recursive) routed through runtime-js `node:fs`, plus read/count/slice cases for wc/head/tail/cat.

## Reversibility

REVERSIBLE — test infra (CHANGELOG-only).
