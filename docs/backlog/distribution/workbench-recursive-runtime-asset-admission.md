---
area: distribution
status: draft
title: Owner-brokered runtime-asset admission for recursive Node children
created: 2026-07-17
why: a directly supervised child receives a fresh exact-plan runtime-asset capability, but a recursive Worker that needs the same substituted tool cannot inherit or mint one safely
user_story: As a developer running a Node tool that spawns a nested Worker using esbuild, I want the nested process to receive the same attested runtime bytes, but today it loud-fails because only direct Workbench children are owner-admitted
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0300-one-shot-consumption-of-opaque-worker-entry-capabilities.md, docs/adr/runtime-js/0267-entry-scoped-host-bootstrap-metadata-for-recursive-node-workers.md]
code: [packages/workbench/src, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/ipc/recursive-runner.ts]
---

## Context

ADR-0249 admission gives each direct owner-supervised URL child a fresh
`rifty.shadow-assets.v1` session scoped to its attested plan. ADR-0267 propagates
host bootstrap metadata to recursive Node Workers, but ADR-0300 capability
ports are intentionally not inherited. An unadmitted recursive Vite 7 consumer
therefore loud-throws `NotImplementedError('vite.esbuild.shadowAssets')`.

The missing mechanism is owner-brokered admission, not port cloning or ambient
inheritance. A recursive spawn must ask the Workbench owner to reserve the
current exact package-tree epoch, create a fresh least-authority session, bind
its lifetime to the new child, and settle the reservation on every spawn/exit/
close failure. Guest code cannot name a different plan, read the store, reuse a
parent endpoint, or bypass the package FIFO.

Path to ready: pin one real recursive package journey, decide the authenticated
owner request path and error ordering in an ADR, then specify RED races for
tree mutation, parent/child teardown, broker failure, and nested spawn. No host
URL/env/network fallback is permitted.
