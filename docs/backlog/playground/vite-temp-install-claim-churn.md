---
area: playground
status: draft
title: Classify Vite config-loader temp writes without weakening install trust
created: 2026-07-16
why: live Vite writes node_modules/.vite-temp after npm install, correctly revoking the whole-tree claim, marking an untouched Scratch dirty, and forcing reacquisition on reopen
user_story: As a playground user, I want an untouched Vite project to stay visibly clean and reopen offline, without teaching generic Workbench or storage contracts about Vite or trusting a mutated dependency tree.
epic: vite-knowledge-boundary
sources: [M11, PR-136-recut, PR-153-review, ADR-0261, ADR-0278, Vite-v8.0.16]
code: [apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/workbench-project-vfs.ts]
---

## Context

Vite v8.0.16's bundle config loader creates, imports, and removes `node_modules/.vite-temp/vite.config.*.timestamp-*.mjs`. Treating those writes as dependency-tree mutations is correct: ADR-0261 permits neither a path whitelist nor continued trust in a tree changed after promotion. The resulting revoke also marks a fresh Scratch dirty; switching away and reopening then safely but unnecessarily reacquires the dependency tree.

The first proposed repair prepared the installed Vite bundle and redirected generated modules through an owner-private cache/capability. It was removed while recutting PR #153 because the contract prescribed Vite-specific data and control flow inside generic Workbench/runtime ownership before the semantic boundary was established. That `exactEsmModuleBinding`/private-cache design is rejected evidence, not a ready implementation contract to restore.

## Refinement path

- Reproduce unmodified Vite v8 on current Workbench through package-bin, direct-Node, and programmatic entry paths. Prove the user-visible baseline: no user edit, claim revoke, dirty Scratch, reacquisition, and offline reopen failure.
- Inventory the actual semantic owners: Node/module behavior, filesystem mutation provenance, install-tree trust, storage/cache ownership, and the explicit Vite integration allowed by ADR-0263/0278. Classify the gap at one of those boundaries before choosing a carrier.
- Preserve ADR-0261 controls: an ordinary guest write to `.vite-temp` or any other `node_modules` path still revokes the whole-tree claim; no filename whitelist, partial attestation, or post-hoc “harmless” label.
- Candidate acceptance must prove an untouched real Vite project stays clean and reopens offline with zero reacquisition, while ordinary dependency mutations still revoke and every real Vite entry path/config form remains Node-parity faithful.
- Generic Workbench, VFS, runtime, worker wire, persisted identity, and cross-tool public contracts cannot carry Vite-specific fields or branches. If the behavior is irreducibly Vite-specific, keep it at an explicit concrete integration edge and record any public-contract change by ADR.
