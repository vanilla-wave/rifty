---
area: npm-client
status: draft
title: Retire the @esbuild/wasi-preview1 alias override — synthesize the delegate, remove measured network bytes nobody reads
created: 2026-07-13
why: install pulls the full alias package whose bytes the delegate shim immediately shadows; with the Workbench runtime-asset path (ADR-0249) the executed bytes have their own honest path
user_story: As a developer installing a Vite project, I want cold install to stop downloading the measured alias response bytes that a tiny delegate overwrites and nobody reads, but today the override stays load-bearing because nothing measured whether dropping it breaks real-Vite e2e
epic: honest-shadow-substitutions
blocked_by: [distribution/workbench-runtime-asset-cutover]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/overrides.ts, packages/npm-client/src/installer-lockfile-reader.ts]
---

## Context

Subsumes `esbuild-substitution-strategy-reconciliation` (2026-06-13): the
vendored-wasm binding died with the wrapper (PR #141), and ADR-0249 gives
executed bytes an honest path. What remains is the dead alias download.
`bakedOverrides` redirects `esbuild` → `@esbuild/wasi-preview1@0.28.0`
and downloads a package containing a 20,174,983-byte WASM member, then
overwrites its entry points; nobody consumes that payload. The user-facing
network saving is the compressed packument/tarball response-body delta measured
by the entry gate, not the uncompressed member size.

Entry gate (the measurement the original item demanded, made user-visible):
capture a cold STD real-browser control with the current alias and the exact
alias packument/tarball response-body bytes. Repeat the same cache, origin,
transport, and end-to-end install/open boundary after synthesis. The result must
show the exact byte delta, no alias request, and parity-green Vite dev / build /
preview / optimize. Report a latency delta only when the boundary and regimes
match; do not relabel the narrower runtime-asset fill metric as total savings.

The GREEN path uses a SYNTHESIZED delegate package. It selects from the admitted
public `esbuild@<exact version>`, writes that package directly, emits the
applied-substitution record, and maps the version to its exact
`esbuild-wasm` asset descriptor. It must not depend on an installed alias
trigger.

- Green → ship: synthesized package with an explicit, honest lockfile
  provenance marker (never false shadow provenance — eddy r17 rule); eddy
  request/replay paths (`overrides` field, override-aware lockfile source)
  updated in lockstep. Synthesis/overlay recipe changes flip
  `installArtifactIdentity`; asset pins use the manager's separate required-set
  digest and do not force a tree relink.
- Red → keep the item and epic open. Record the observed alias-dependent
  behavior, then recut synthesis/provenance so the redundant payload is removed
  without changing Vite behavior. Never call a retained dead download epic
  success and never trade parity for the saving.

Path to ready: run the measurement, then refine with the outcome; the lockfile
provenance shape is public behavior → its ADR must exist before `ready`.
