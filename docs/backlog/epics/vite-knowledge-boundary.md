---
kind: epic
status: draft
title: Keep Vite knowledge out of generic platform contracts
created: 2026-07-18
value: Vite projects work through faithful Node, filesystem, process, and storage behavior without turning Vite into a Rifty platform concept.
user_story: As a developer running Vite or another ordinary npm tool, I want fixes to improve the real platform behavior the tool exercises, but today a Vite workaround can change generic runtime, Workbench, install, or persistence contracts.
items: [playground/vite-temp-install-claim-churn, playground/workbench-implicit-vite-module-scope]
---

## Outcome

Vite remains a forcing consumer and compatibility target, not a platform domain concept. Generic kernel, runtime, VFS, npm, shell, terminal, and Workbench production behavior is expressed in Node, filesystem, process, module, network, and storage semantics. Knowledge unique to Vite stays in an explicit concrete integration edge. The existing `projects.vite`, `VitePlaygroundPlan`, and Playground companion APIs are such edges under ADR-0263/0278; this draft does not supersede them.

Tests, parity evidence, compatibility docs, concrete templates, and explicit Vite integration APIs may name Vite. Generic platform-internal production control flow, cross-tool public contracts, worker wire shapes, and persisted owner/project identity do not depend on that name. A Vite failure either exposes a real platform gap that is fixed at its semantic owner, remains an honest compatibility gap, or is handled inside the concrete integration; it does not create a Vite branch in a generic platform mechanism.

## User scenario

A user opens a Vite project and runs `npm install && npm run dev`; the installed CLI owns its real behavior. If config loading creates transient files or exercises module-loader edge cases, Rifty handles them through generic filesystem, process, module, and storage contracts. The user then opens an Express project in a newly started environment; its acquisition, trust, and runtime path is unchanged by Vite policy.

## Items

- `playground/vite-temp-install-claim-churn` (draft) — classify real Vite config-loader temp mutations without weakening whole-tree install trust or adding a Vite carrier to generic owners.
- `playground/workbench-implicit-vite-module-scope` (draft) — resolve the public `projects.vite()` package-scope behavior recorded by the Workbench split.

Further refinement starts with an inventory of package-specific production dependencies, then cuts children by the real semantic owner that can remove each leak.

## Draft gates

- Map allowed concrete integration locations, including the ADR-0263/0278 public factory/plan/companion APIs, and forbidden generic platform-internal surfaces: cross-tool contracts, worker wire schema, persisted owner/project identity, and production control flow.
- Classify existing Vite mentions: compatibility evidence and concrete templates may be valid; generic behavior or data dependencies are leaks.
- Derive each replacement from the actual Node, filesystem, process, module, network, or storage contract.
- Add mechanical boundary checks for dependencies and contracts, not a repository-wide ban on the word `vite`.
- Do not use consumer count or adapter count as a design proxy; this epic must not encourage dummy adapters or parallel workarounds to justify an interface.
- Require a superseding ADR before refinement removes or reshapes any recorded public Vite integration contract.
- Keep user-visible de-gluing in `preset-deglue`; this epic owns knowledge direction and contract cleanup.
- Interim guard until refinement: do not grow the leak surface. No new Vite fields, branches, or data dependencies in generic platform internals (cross-tool contracts, worker wire, persisted owner/project identity, production control flow); new Vite needs land at the ADR-0263/0278 integration edges or wait for this epic. Existing mentions await classification, not expansion.
