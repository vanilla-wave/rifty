---
area: npm-client
status: draft
title: Retire the @esbuild/wasi-preview1 alias override — synthesize the delegate, stop downloading ~20MB nobody reads
created: 2026-07-13
why: install pulls the full alias package whose bytes the delegate shim immediately shadows; with the Workbench runtime-asset path (ADR-0249) the executed bytes have their own honest path
user_story: As a developer installing a vite project, I want cold install to not download ~20MB of alias bytes that are overwritten by a 175-byte delegate and read by nobody, but today the override stays load-bearing because nothing measured whether dropping it breaks real-Vite e2e
epic: honest-shadow-substitutions
blocked_by: [distribution/workbench-runtime-assets]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/overrides.ts, packages/npm-client/src/installer-lockfile-reader.ts]
---

## Context

Subsumes `esbuild-substitution-strategy-reconciliation` (2026-06-13): the
vendored-wasm binding died with the wrapper (PR #141), and ADR-0249 gives
executed bytes an honest path. What remains is the dead alias download.
`bakedOverrides` redirects `esbuild` → `@esbuild/wasi-preview1@0.28.0`
(~20MB), then overwrites its entry points; nobody consumes the alias payload.

Entry gate (the measurement the original item demanded, unchanged): real-Vite
e2e (dev / build / preview / optimize) after the asset manager lands, with a
SYNTHESIZED delegate package and no alias tarball fetch. Selection keys from the
admitted public `esbuild@<exact version>`, writes that package directly, emits
the applied-substitution record, and maps the version to its exact
`esbuild-wasm` asset descriptor. It must not depend on an installed alias trigger.

- Green → ship: synthesized package with an explicit, honest lockfile
  provenance marker (never false shadow provenance — eddy r17 rule); eddy
  request/replay paths (`overrides` field, override-aware lockfile source)
  updated in lockstep. Synthesis/overlay recipe changes flip
  `installArtifactIdentity`; asset pins use the manager's separate required-set
  digest and do not force a tree relink.
- Red → record WHY the alias stays (compat note + ADR-0188 correction), keep
  the pin couple (`SHIM_ESBUILD_VERSION` == override pin, already enforced),
  delete this item.

Path to ready: run the measurement, then refine with the outcome; the lockfile
provenance shape is public behavior → its ADR must exist before `ready`.
