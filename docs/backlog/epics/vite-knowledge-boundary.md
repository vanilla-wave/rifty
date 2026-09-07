---
kind: epic
status: draft
title: Consolidate existing guest-package adaptations under shadow registry
created: 2026-07-18
value: Existing supported programs retain their behavior while guest-package adaptations have one registry owner instead of changing platform contracts.
user_story: As a developer running Vite or another ordinary npm tool, I want package compatibility to follow installed dependencies, but today package-specific preparation also lives in Workbench and runtime-js.
sources: [ADR-0263, ADR-0278, ADR-0226, ADR-0371, ADR-0375, PR-167-review]
---

## Outcome

Consolidate all existing guest-package adaptations under shadow registry, including Vite, esbuild and `@emnapi/core`. Inventory the remaining packages at pickup; this is a finite cleanup of existing support, not a promise to support new packages.

Registry owns package-specific versions, integrity policy, patches, runtime adaptation and consumer compatibility preparation. Generic kernel, runtime, VFS, npm, shell, terminal and Workbench supply Node, filesystem, process, module, network and storage behavior. Renaming a package-specific branch to an edge module, or moving only its constants, does not close this outcome.

An adaptation update may require a rebuilt SDK. Independent registry-to-existing-SDK delivery is not required; ownership does not prescribe byte delivery or a public extension system. General platform changes remain legitimate when a package exposes a missing general capability.

Existing `projects.vite`, `VitePlaygroundPlan` and Playground companion calls remain compatible, optional conveniences over the general platform. Their explicit project intent may name Vite; package compatibility must not depend on using them. Tests, parity oracles, compat docs and templates may name packages. Host build tooling is outside this cleanup.

## User scenario

A user installs the currently supported Vite dependencies and runs build/dev, edits a source file for HMR, then restores/restarts the project. Preserve existing supported behavior in both COI and no-COI paths, including existing loud gaps; package adaptation follows installed dependencies without requiring a Vite helper. Existing applications using the public helpers continue to work.

The user then opens an Express project. Its acquisition, execution, persistence and diagnostics do not inherit Vite policy. A user-owned `.vite/notes.txt` is not hidden merely because of its directory name. Existing supported consumers of other adapted packages retain their supported results as each adaptation moves to registry ownership.

## Invariants

Each target is false on the inspected main baseline `1e91c3df5`; source witnesses below are not behavioral acceptance proof.

1. I1 — Every existing guest-package adaptation has registry ownership; platform production modules contain no independently maintained package versions, integrity constants, patches or startup policy. Current witnesses: Workbench esbuild adapter, Vite preparation and emnapi finalizer.
2. I2 — Generic runtime contracts and realm identity storage have no guest-package-specific API or key. Current witness: runtime-js `RuntimeEsbuildCjsOuter`, `publishRuntimeEsbuild`, `readRuntimeEsbuild` and the `esbuild` slot.
3. I3 — Generic project-file visibility and package diagnostics do not infer Vite ownership from a name. Current witnesses: `.vite` exclusions and `[real-vite/worker]` logs in the captured inventory.

## Items

Not split yet. FIT inventories the existing scope, chooses the route and cuts children by the semantic owner. Preserve the current draft path for incoming links; convert this legacy epic to a goal directory at FIT.

## Captured inventory

PR #167 findings retained; source sites rechecked on 2026-09-07. Their behavioral repros have not been rerun in this refinement:

- `packages/workbench/src/glue/vfs-snapshot-port.ts:27` and
  `packages/workbench/src/workbench/project-files.ts:15` hard-code `.vite` into
  generic project-tree exclusion policy. Repro: put user-owned
  `.vite/notes.txt` in a non-Vite project and open its Workbench file snapshot;
  the directory is omitted.
- `packages/workbench/src/glue/project-deps.ts` prefixes reuse,
  snapshot, and stamp-promotion diagnostics with `[real-vite/worker]`. Repro:
  restore/install dependencies for a non-Vite Workbench project and observe
  Vite provenance in its log.

Source-confirmed additions, 2026-09-07; not an exhaustive inventory:

- `packages/workbench/src/workers/workbench-runtime-adapters.ts`: esbuild adapter id, package suffix, WASM size/hash, startup and publication. Reached during installed-binding activation before guest execution, or no-COI install/restore.
- `packages/workbench/src/workers/vite-esbuild-runtime.ts`: exact Vite version gate and esbuild slot check. `vite-node-entry-edge.ts` selects preparation from the executed bin/argv; `node-entry-runtime-preparation.ts` imports that concrete planner.
- `packages/workbench/src/workers/package-install-finalizer.ts`: Vite acquisition preparation. `vite-cli-install-policy.ts` owns upstream CLI/watch patches outside registry.
- `packages/workbench/src/workers/package-install-generic-finalizer.ts`: recognizes `@emnapi/core` in the lockfile, selects package files and applies `emnapi-core-install-policy.ts` patches during install finalization.
- `packages/runtime-js/src/internal/worker-globals.ts`: package-named realm identity API used by activation and the installed esbuild facade.
- `packages/npm-client/src/internal/shadow/schema-one-identity.ts`: legacy substitution ids; classify as persistence compatibility data, preserve existing rejection semantics. A package mention alone is not an executable adaptation.

## Decisions

- 2026-09-07 — user: all existing cases, not only Vite → esbuild; no new-package support promise.
- 2026-09-07 — user: rebuilding the SDK for an adaptation update is acceptable; independent update delivery is not required.
- 2026-09-07 — user: preserve optional public Vite helpers; ordinary package execution must not require them.
- 2026-09-07 — dedup: expand this draft; `preset-deglue` retains its separate user-visible lifecycle/provenance work. No new duplicate epic. Declined concepts and traps checked; no matching rejection of this outcome.

## Open questions

- Which existing package-specific production sites remain beyond the captured inventory? — owner: agent — bounded inventory of production code and its actual consumers at FIT.
- How does registry-owned adaptation use general runtime capabilities while preserving startup order, object identity and existing installed-tree/offline behavior? — owner: agent — compare existing mechanisms and discriminating probes; record required ADR changes before implementation.
- Which reachable fault rows are required for the chosen route? — owner: agent — retain existing obligations, choose tier at FIT without silently adding recovery/durability promises.

## Draft gates

- Map registry-owned adaptations, optional ADR-0263/0278 helpers and generic platform surfaces. Do not preserve package compatibility inside Workbench merely by calling it a concrete edge.
- Classify package mentions by responsibility: compatibility evidence, historical persistence ids, templates and explicit helper intent may be valid; independently owned adaptation policy is a leak.
- Derive each replacement from the actual Node, filesystem, process, module, network, or storage contract.
- Add mechanical ownership/dependency checks; prove unchanged supported behavior with real packages, VFS and browser parity/e2e. Source scans alone cannot close acceptance.
- Do not use consumer count or adapter count as a design proxy; this epic must not encourage dummy adapters or parallel workarounds to justify an interface.
- Resolve ADR-0226/0371 clauses that currently place startup, typed realm slots and the generated client in platform modules. Preserve installed-tree byte authority; do not revive the declined CAS/port delivery path.
- Preserve public Vite helper compatibility under ADR-0263/0278 and no-COI generality under ADR-0375; this draft records intent, not a superseding implementation decision.
- Keep user-visible de-gluing in `preset-deglue`; absorb only work actually required by this outcome, without duplicating contracts.
