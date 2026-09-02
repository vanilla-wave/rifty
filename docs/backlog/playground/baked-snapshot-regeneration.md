---
area: playground
status: draft
title: Baked snapshot regeneration policy + git size pressure
created: 2026-06-13
why: the committed snapshot (now 14.3 MB gz) can drift from current install behavior while still passing its freshness gate, and every re-bake permanently grows git history
user_story: As a developer picking an instant playground template, I want its baked tree and lock evidence to match the current installer, but today some drift either loses instant boot or restores stale evidence unannounced.
sources: [docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code:
  - apps/playground/tools/bake-dep-snapshots.ts
  - tools/shadow-registry/tools/generate-install-artifact-identity.ts
  - tools/shadow-registry/src/snapshot-artifact-check.ts
  - packages/workbench/src/glue/dep-snapshot.ts
---

## Context

ADR-0135 item 6: instant templates ship a committed gzipped node_modules snapshot (`apps/playground/public/snapshots/`), regenerated manually via `pnpm snapshots:bake`. Drift is SAFE (the worker's deps-equality gate falls back to a real install) but silently loses the instant-boot win until someone re-bakes. Each re-bake adds another multi-MB blob to history.

Update 2026-06-20 (ADR-0162 / Vite 8): the re-baked `vite@8.0.16` snapshot is
**14.3 MB gz, up from ~9 MB** — `@rolldown/binding-wasm32-wasi` adds ~5 MB.
**Decision: defer** the Git-LFS / deploy-time-bake move. The +5 MB is intrinsic to
shipping the Vite 8 instant template, and moving the asset out of git is a
separate infra change (LFS or a deploy-time bake pipeline) outside this Vite 8
support pass. Tracked here; revisit when re-bakes become frequent or another
instant template pushes the committed total materially higher.

Update 2026-07-12 (superseded by ADR-0261): CI now proves exact package input, install-artifact
identity, and embedded shadow bytes for every committed snapshot. Silent policy
drift is closed; range-resolution cadence and Git storage remain open here.

Update 2026-08-01 (protocol-v2 Contract+RED): linker-only lock serialization
drift is not covered by the install-artifact identity. After the canonical
shadow `bin` spelling shipped, all three committed snapshots still carried the
old spelling and protocol v1; `check-dep-snapshot-artifacts.ts` nevertheless
reported them current. Instant restore then wrote those embedded lock bytes
verbatim. The protocol-v2 slice must honestly re-bake the shipped artifacts;
the residual class is making freshness identity change whenever installer lock
serialization changes, without making routine install behavior depend on a
manually bumped version.

## Options or Next

- Range-resolution drift (same ranges, newer published versions) — decide whether periodic re-bakes are wanted at all; the lockfile inside the snapshot keeps installs deterministic either way.
  Happened 2026-07-25 (PR #175): an identity-refresh rebake silently absorbed `postcss` 8.5.22 → 8.5.23 via vite's floating `^8.5.6` in all three presets; declared post-hoc in the playground CHANGELOG. Bake resolves against live npmjs (`bake-dep-snapshots.ts:38`) — pin bake inputs to the committed lockfile to kill the class.
- Freshness identity — derive or bind it to the current canonical lock writer so
  linker-only serialization changes make committed snapshots loudly stale.
- Git size: Git LFS, or move the asset out of the repo (deploy-time bake) if re-bakes become frequent.

## Reversibility

REVERSIBLE — provisional judgment recorded here; the asset, the bake script, and the restore path can each be swapped independently.

Update 2026-09-01 (embedder asset on a newer build): the tracker-plugin
snapshot baked against `@riftydev/workbench` 0.4.0 is unrestorable on main —
`snapshot-rejected:install-artifact-identity-mismatch`, then
`snapshot-rejected:snapshot-restore-plan-failed: EBROKENLOCK: applied shadow
substitution catalog identity drifted` (`planShadowSubstitutionsFromLockfile`).
Acquisition falls to `install`; with the embedder's unreachable registry
`openProject` returns in 295 ms with NO `node_modules`. The drift class is the
one this item owns (freshness identity vs catalog drift); the embedder-side
consequence — a session that opens fast and is not the project — needs its
own loud surface at pickup. Evidence:
`docs/backlog/vfs/reference/tracker-snapshot-open-split-2026-09-01.md` §Blocker.
