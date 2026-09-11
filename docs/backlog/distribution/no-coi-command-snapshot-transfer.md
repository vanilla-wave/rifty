---
area: distribution
status: draft
title: Gate per-command recovery snapshots by VFS backend
created: 2026-09-11
why: Every settled no-COI command copies the whole Worker VFS to the host although OPFS recovery never reads those bytes
user_story: As an embedder driving an agent loop over a large installed project, I want command completion cost independent of node_modules size, but today each completion transfers and copies the full tree.
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/backlog/distribution/reference/pr-331-implementation-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/internal/toolchain-input.ts]
---

## Context

After each settled command the Worker walks the VFS, copies every file and posts
it as `activationState` (no-coi-toolchain-worker.ts `snapshotFiles`); the host
copies again in `validateActivationState` and retains one image. Measured
2026-09-11, Chromium headless, OPFS: empty tree ~1 ms per `project.run`;
installed Vite 7.3.6 (253 files, 22.5 MB) 10–13 ms; `project.fs.stat` 0 ms.
Cost is linear in tree bytes and the image stays resident in the page.
`restoreActivation` reads the bytes only for memory backend or backend
mismatch; on OPFS the transfer is unused.

## Options or Next

- Take the file image only when `runtimeBackend === 'memory'` (or mismatch is
  possible); OPFS keeps cwd/bindings/directories. Smallest honest change.
- Incremental image from the paths the command's policy view touched: a second
  mechanism; needs a forcing constraint (`fault-classes.md` §Class-kill).
- Trigger: a real consumer tree above ~100 MB, or a memory complaint. Until
  then this is a capture, not an obligation.

## Reversibility

REVERSIBLE — internal recovery carrier; public receipts and outcomes unchanged.
