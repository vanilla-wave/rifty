---
area: process-meta
status: active
title: Consumer Ready follow-up cutline
created: 2026-06-12
why: The current branch delivers a large adoption slice, but full Consumer Ready still has tracked future work across areas
user_story: As a maintainer planning post-branch work, I want one durable index of every remaining Consumer-Ready follow-up (`Sandbox.exec` streaming, snapshot/restore, `create-rifty` scaffold, `node:zlib` subset…), but today that list lives only in temporary Superpowers spec notes that vanish with the branch.
sources: [docs/ROADMAP.md, docs/backlog/distribution/README.md]
---

## Context

This item is the repo-owned index for what remains after the current Consumer
Ready branch ships. It replaces the temporary Superpowers decision/spec/plan
notes as the durable project record.

The current branch is intentionally delivered as a large but bounded slice:
production registry proxy source, storage persistence/export/import, `node:vm`,
TypeScript stack remapping, public compat matrices, and final review fixes. The
items below remain future work and must not be treated as closed merely because
they are no longer part of the current branch.

## Options or Next

Hard consumer contract follow-ups:

- `distribution/public-api-ai-agent-exec-preview` — `Sandbox.exec` streaming
  results and normalized preview URL.
- `distribution/public-api-ai-agent-contract-snapshot-restore` — public
  snapshot/restore/fork semantics.
- `distribution/workbench-controllers` — `@riftydev/workbench` headless
  controllers.
- `distribution/create-rifty-template` — one-command scaffold for host wiring.
- `npm-client/prod-npm-registry-deploy-smoke` — explicit deploy approval and
  production registry proxy smoke.

Runtime/project fidelity follow-ups:

- `runtime-js/zlib-web-compression-subset` — first honest `node:zlib` subset.
- `runtime-js/platform-arch-adoption-friction` — ADR-0026 reconsideration gate.
- `runtime-js/fs-promises-filehandle` — `fs.promises.open()` / FileHandle.
- `runtime-wasi/runwasi-kernel-dispatch-wiring` — heavy WASI guest dispatch.
- `kernel/server-shaped-worker-process-lifecycle` — long-running server worker
  process lifecycle.
- `kernel/host-operator-resource-enforcement` — host caps/watchdogs/resource
  policy.
- `vfs/fs-sync-fd-api-and-fsync-durability` — lower VFS fd/durability contract.
- `vfs/storage-pressure-and-eviction-ux` — browser quota/eviction recovery UX.
- `vfs/workspace-archive-scalability` — streaming/large-project archive path.
- `net/readable-fromweb-pipe-sink` — broader web-stream interop when a consumer
  needs it.
- `runtime-js/crypto-sync-subset-expansion` — sync crypto subset by verified
  consumer need.

Trust/release follow-ups:

- `distribution/dependency-license-audit` — generated transitive license audit
  or release gate.
- `service-worker/cross-browser-compat-matrix` — per-browser capability matrix
  after the first cross-browser sweep.

Open M11 tech debt (still M11-tagged, NOT part of this cutline — listed so the
index is complete):

- `net/cross-realm-http-loopback` — loopback `http.request` across Worker
  realms (port registry is realm-local).
- `shell/node-modules-bin-execution` — PATH-style `.bin` launcher execution by
  command name.
- `runtime-js/vm-sandbox-residual-gaps` — documented `node:vm` write-rewrite
  gaps (direct eval, top-level function hoisting, completion values).

Pull public API and new-package items only with ADRs. Pull outward deploy smoke
only after explicit approval.

## Reversibility

REVERSIBLE — index/process item only. The linked backlog files own the actual
technical decisions, gates, and ADR requirements.
