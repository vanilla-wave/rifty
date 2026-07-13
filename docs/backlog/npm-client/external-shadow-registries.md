---
area: npm-client
status: draft
title: External shadow registries — substitutions as a public-API value for embedders
created: 2026-07-13
why: bakedOverrides/internalsShims are module-level exports; an embedder cannot add their own substitution without forking the repo
user_story: As an embedder shipping rifty in my product, I want to declare my own package substitution (trigger, overlay files, pinned assets) at API construction, but today the registry is compiled in
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-store]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/backlog/epics/embeddable-dev-loop.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/overrides.ts, src/index.ts]
---

## Context

The applier (`shadow-shims.ts`) is already fully data-driven; the only hard
binding is two module-level imports (`bakedOverrides`, `internalsShims`).
Direction: the registry becomes a value passed at public-API construction —
`registries: [builtin, ...custom]` — with the builtin as the default instance
of the same contract. Custom entries are pure data ({trigger, range, into?,
files, assets[]}) and ride the store, both transports, and
`installArtifactIdentity` for free (merged registry is hashed → different
embedder config = different identity, no cross-configuration snapshot/stamp
reuse).

Honest boundaries to contract at refine time: name collision with the builtin
= loud error (no silent override); SRI/sha256 pins mandatory (pinless entry
refused loud); realm-slot lifecycle hooks (esbuild's
`publishRuntimeEsbuild`-style publication) are NOT part of the data API —
generalize that seam only when a second real consumer needs it.

Public API surface → ADR required before `ready`. Consumed by epic
`embeddable-dev-loop`; refine ordering against that epic's chain
(workbench → react → example).
