---
area: distribution
status: draft
title: Gate per-command recovery snapshots by VFS backend
created: 2026-09-11
why: Every settled no-COI command copies the whole Worker VFS to the host although OPFS recovery never reads those bytes; measured ~1 s per command on a 79 MB installed tree
user_story: As an embedder driving an agent loop over a large installed project, I want command completion cost independent of node_modules size, but today each completion transfers and copies the full tree.
sources: [docs/adr/distribution/0377-no-coi-resident-tool-and-restart-lifecycle.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/backlog/distribution/reference/pr-331-implementation-evidence.md, docs/backlog/distribution/reference/pr-384-no-coi-resource-prototype-evidence.md, docs/backlog/runtime-js/reference/no-coi-recovery-copy-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-owner.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/host-fs-recovery.ts, packages/runtime-js/src/internal/toolchain-input.ts, packages/rifty/src/sandbox.ts]
---

## Context

After each settled command the Worker walks the VFS, copies every file and posts
it as `activationState` (no-coi-toolchain-owner.ts `snapshotFiles`); the host
copies again in `validateActivationState` and retains one image; acknowledged
`fs`/`projectFs` mutations patch it (`host-fs-recovery.ts`). `restoreActivation`
reads the bytes only for memory backend or backend mismatch; same-OPFS restart
sends `files: []` and reopens the durable tree (ADR-0377 D2).

Measured 2026-09-11, Chromium headless, OPFS: empty tree ~1 ms per
`project.run`; installed Vite 7.3.6 (253 files, 22.5 MB) 10–13 ms.

Measured 2026-10-22 (PR 384 prototype, `reference/pr-384-no-coi-resource-prototype-evidence.md`),
real React/Vite/Gravity tree 16,836 files / 79 MB, Chromium 148: `echo`
completion 968 ms → 0.8 ms without the OPFS image; repeat `vite build` via SDK
2.896 → 1.839 s with Vite's own phase unchanged; backing storage after build
+ GC 179 → 103 MiB; after dispose with retained handle 83 → 7 MiB (both
mechanisms measured together; `echo` isolates this one). The former trigger
(tree >100 MB or memory complaint) is reconsidered on this evidence: ~1 s per
agent tool call on a 79 MB tree is user-visible.

## Options or Next

- Take the file image only when `runtimeBackend === 'memory'`; OPFS sends
  cwd/directories without bytes; host skips `applyRecoveryFsOperation` for an
  OPFS state; dispose releases `activation`/`residentRequest`. Smallest honest
  change; prototype shape in PR 384 (minus its Symbol switch and optional
  wrapper methods).
- Incremental image from the paths the command's policy view touched: a second
  mechanism; needs a forcing constraint (`fault-classes.md` §Class-kill).
- Memory backend keeps today's per-command image and cost (no persistence to
  reopen; restart still needs the bytes): not better, not worse.
- Pickup: ADR-0377 D2 clause "backend flip restores those files" is overturned
  by the decision below → contradicts an active ADR (`DEC-1`(3)): critic +
  superseding ADR naming the clause, 0377 stays with a dated §Corrections
  pointer (`DEC-2`/`DEC-5`) in the implementing unit;
  `tests/no-coi/no-coi-dev-hmr.spec.ts` "successive OPFS-memory-OPFS restarts
  restore the latest acknowledged bytes" re-targets to the loud failure.
  Entry points reaching the failure (all via `replaceWorker` →
  `restoreToolchainState`): `restart()`, `stopResident()`, project command
  Stop/`requiresTermination` fallback (`sandbox-project.ts` → `replace`).
  Reach: `storage.persistence:'preferred'` only (`'required'` throws at boot,
  `'ephemeral'` is always memory). `packages/rifty/README.md` "OPFS init
  failure falls back to in-memory" narrows for restart — doc row at pickup.
  Related: `no-coi-activation-bindings-shrink` (unused `bindings` field).

## Decisions

- 2026-09-11 — capture; trigger: tree >100 MB or memory complaint.
- 2026-10-26 — user: OPFS→memory flip on Worker restart (OPFS failed to reopen
  → memory fallback) after the image is gone = loud failure, restart rejects
  "recovery requires OPFS; re-install", visible to the SDK; no silent
  degradation, no page-side bytes kept for that branch. Alternative (keep the
  image for flip recovery) rejected: forfeits the whole gain.
- 2026-10-26 — direction: build as its own unit, before `perf/fs-rpc-chunk-perf`;
  PR 384 numbers are the baseline reference, re-measured at pickup.

## Reversibility

Carrier REVERSIBLE — internal recovery image; public receipts and outcomes
unchanged. The flip-restore drop contradicts ADR-0377 D2 → IRREVERSIBLE route
(`DEC-1`(3), superseding ADR at pickup).
