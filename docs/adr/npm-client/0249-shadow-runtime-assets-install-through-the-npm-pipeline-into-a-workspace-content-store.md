# ADR 0249: Shadow runtime assets install through the npm pipeline into a workspace content store

Status: Accepted
Date: 2026-07

> TL;DR: heavy runtime bytes that shadow substitutions execute (esbuild.wasm
> first) are declared as integrity-pinned asset entries on the shim, fetched at
> install time through the existing tarball pipeline, and stored in a
> workspace-local content-addressed store — never shipped as app-bundle assets,
> never trusted from any transport without the final sha256 gate.

## Context

Two delivery paths disagree today. Install pulls the `@esbuild/wasi-preview1`
alias (~20MB) whose bytes the delegate shim immediately shadows — npm-grade
provenance for bytes nobody executes. The bytes that DO execute
(`esbuild.wasm`, 13.3MB) ship inside the playground bundle
(`esbuild-wasm/esbuild.wasm?url`) and re-download on HTTP-cache eviction —
executed bytes with no npm provenance, no offline durability, and a bundle
that grows per admitted version. Scaling substitutions (sass-embedded,
@swc/core, sharp are the named next consumers) multiplies both problems.

## Decision

- Each `internalsShims` entry MAY declare `assets`: `{tarball {name, version,
  integrity(SRI)}, member, sha256}` pins. For esbuild the pin is GENERATED from
  `esbuild-runtime-policy.json` — one source of truth, covered by the existing
  drift gate.
- `ensureShadowAssets(pins)` in npm-client resolves each pin: store hit (zero
  network) or fetch via the `fetchAndUnpack` chokepoint (tarball-cache + SRI +
  bounded per ADR-0201), extract the member, verify member sha256 against the
  pin, temp-write + atomic rename into the store.
- Store = `/.rifty/shadow-assets/sha256/<hex>` in the workspace VFS — same
  persistence class as the tarball cache (ADR-0023), re-verified on every
  read; content addressing makes version skew unrepresentable. NOT a global
  cross-workspace store: that variant is blocked on the multi-tab story and
  recorded as a follow-up trigger, not built speculatively.
- Fill runs at install when a shim with assets applies (background; failure
  never gates the install stamp — the store is a foreign path per ADR-0241
  damage scoping) and lazily at consumption (miss → fetch). Consumers fail
  LOUD, naming the asset, when no fill path succeeds; no silent degradation.
- Transports are interchangeable behind the pin: the base path is the standard
  registry; eddy (opt-in, ADR-0182/0194) accelerates the same bytes as one
  batch asset-set closure. Neither transport is trusted — the member sha256
  gate is final in every path.
- The playground stops shipping wasm runtime assets in its bundle once the
  store serves them.

## Consequences

- Executed bytes gain npm-grade provenance + offline durability (OPFS survives
  HTTP-cache eviction); playground dist shrinks by ~13.3MB; admitted-set
  version growth stops costing bundle bytes.
- Unblocks retiring the dead ~20MB alias override (own backlog item; entry
  gate = the real-Vite e2e measurement).
- Asset pins join the install-artifact recipe (ADR-0241): any pin change flips
  identity and re-arrives stale trees — no bespoke migration code.
- New fault surface (torn write, corrupt object, quota, concurrent fill) —
  contracted as a Fault matrix in `npm-client/shadow-asset-store`, each row a
  fault-test target.
- Workspace-local means N-workspace duplication of heavy assets; acceptable
  now, escalation trigger recorded (global CAS blocked_by multi-tab).
