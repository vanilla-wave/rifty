---
area: npm-client
status: draft
title: External shadow catalogs and runtime adapters as construction-time public API
created: 2026-07-13
why: bakedOverrides/internalsShims are module-level exports; an embedder cannot add their own substitution without forking the repo
user_story: As an embedder shipping rifty in my product, I want to declare my own package substitution (trigger, overlay files, pinned assets) at API construction, but today the registry is compiled in
blocked_by: [distribution/workbench-runtime-asset-cutover]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/backlog/epics/embeddable-dev-loop.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/overrides.ts, src/index.ts]
---

## Context

The applier (`shadow-shims.ts`) is data-driven, but delivery data cannot express
an executable package's API/lifecycle adaptation. Do not overload npm's
`registry` term or one `registries` option. Public construction needs two
distinct values, with builtins as defaults:

- `ShadowCatalog`: declarative trigger/range, contained overlay files, exact
  version-to-asset descriptors, and an optional runtime-adapter reference;
- `ShadowRuntimeAdapterRegistry`: host code keyed by adapter id, with explicit
  start/read/teardown behavior and parity ownership.

Proposed construction exposes declarative `shadowCatalogs`; the
Worker-loadable runtime-adapter composition remains undecided. Passing
`shadowRuntimeAdapters: Record<string, function>` through `openWorkbench`
is rejected: owner boot accepts clone-safe data and ADR-0263 forbids a generic
runtime registry. Each catalog has a stable id, schema version, and
canonical digest. Builtin/custom and custom/custom id or trigger-range overlap
is a construction error; disabling a builtin requires an explicit builtin id,
never replacement by ordering. Overlay targets and archive members are
normalized and must remain in their declared roots. Unknown version mappings,
adapter bindings, lifecycle capabilities, or schema versions fail at
construction.
An asset source matching any composed trigger or baked override also fails
`ESHADOWASSETSOURCE`; declarative catalogs cannot request an implicit raw
resolver.

Applied asset descriptors ride the owner `ShadowAssetManager`; runtime bytes
never grant executable hooks to registry data. A local catalog may reference a
locally bundled/loaded adapter only after a later ADR chooses a Worker-reachable
mechanism and exact configuration identity. A remote catalog cannot activate
host code by id alone. Missing or mismatched exact
`(catalog id, catalog digest, adapter id)` binding throws
`ESHADOWADAPTERBINDING`. Overlay/substitution config joins install-artifact
identity; exact assets use the manager's separate required-set digest.

Remote catalogs provide declarative data only; runtime adapters are trusted host
code supplied locally and bound as above. Catalog data is not a sandbox:
installed overlay JS executes later as guest package code with project
capabilities. Canonical catalog digest and exact SRI/sha256/size pins prove its
bytes and provenance, not inertness. The public adapter lifecycle, cancellation,
teardown, and stable configuration identity need parity proof, not an
esbuild-shaped realm hook hidden in the data API.

Both public API surfaces → ADR required before `ready`. Consumed by epic
`embeddable-dev-loop`; refine ordering against that epic's chain
(workbench → react → example).
