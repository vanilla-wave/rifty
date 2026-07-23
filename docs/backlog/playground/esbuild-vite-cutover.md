---
area: playground
status: ready
title: Esbuild/Vite cutover to registry adapter dispatch; host-asset and alias retirement
created: 2026-07-23
why: direct guest require('esbuild')/import('esbuild') must run the proven transform surface without Vite, and Vite must consume the same adapter through its concrete integration edge; the three overlapping legacy esbuild paths (full-package alias override, file-overlay shim, vendored wasm) collapse into the one registry path
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-tree-authority]
sources: [ADR-0308, ADR-0300-quarry, docs/adr/npm-client/0051-native-dependency-install-policy.md]
---

## Context

Slice `esbuild-vite-cutover` (see epic §Budget). Real executable-adapter
dispatch (ADR-0308): activation from the installed/admitted substitution, so
direct esbuild and Vite share one path. Retires the host-asset path and the
`@esbuild/wasi-preview1` alias (measured ~5.06 MB alias transfer per cold
install on the quarry). Absorbs
`npm-client/esbuild-substitution-strategy-reconciliation` (folded 2026-07-23):
its three-path inventory — (1) bakedOverrides alias to
`@esbuild/wasi-preview1@0.28.0`, (2) `esbuildShimFiles` overlay passthrough,
(3) build-time-vendored `esbuild.wasm` via the ADR-0047 binding, plus the
`SHIM_ESBUILD_VERSION='0.21.5'` vs 0.28.0 contradiction — is the exact legacy
surface this cutover deletes; its "measure whether dropping the override
breaks real-Vite e2e" step is subsumed by this slice's matched browser proof.

## Acceptance

- A normal Workbench project installs exact `esbuild@0.28.0`; direct guest
  CJS `require('esbuild')` and ESM `import('esbuild')` run the differentially
  proven surface — `transform`/`transformSync`-equivalent async surface and
  `version` at minimum — with no Vite installed, recognized, or configured.
- Activation is registry dispatch by the recipe's declared `adapterId`
  (ADR-0308): generic owner/admission/bootstrap never tests package name,
  import target, Vite version, or Vite entry kind. Enforced mechanically: a
  repository check lists the generic modules forbidden to carry
  esbuild/Vite-specific branches; Vite recognition survives only in named
  concrete integration-edge modules.
- Vite 7.3.6 dev/build/preview/optimize consume the SAME adapter and
  npm-proven bytes; the Vite journeys stay parity-green. Default Vite 8.0.16
  stays on the canonical empty plan: observable proof of zero esbuild
  fetch/capability.
- Host-asset retirement with matched before/after real-browser network proof:
  `esbuild.wasm` leaves deployment config/app bundle; no
  `@esbuild/wasi-preview1` alias tarball request; removed response bytes
  recorded. Any latency claim uses same-boundary matched runs only.
- All three legacy paths deleted (bakedOverrides alias, `esbuildShimFiles`
  overlay, vendored-wasm ADR-0047 binding); the 0.21.5/0.28.0 version
  contradiction is gone with them.
- Offline: after a cold fill, project reopen with acquisition network disabled
  still runs dev/build per the storage-qualified readiness class; readiness
  classes surface honestly, never fabricated.
- Kernel unchanged: the adapter consumes capabilities via the existing
  one-shot entry-port mechanism; the Contract confirms no new kernel concept
  (quarry ADR-0300 confirmed by ADR-0308).
- CLI: `esbuild` bin → named `NotImplementedError('esbuild.cli')` + compat ❌ —
  no silent `command not found`.

## Parity cases

Oracle: real Node esbuild@0.28.0 (native oracle, as on the quarry) + real Vite
7.3.6; each case a failing-test-first target:

1. `transform` of JS and TS: output code + sourcemap + `version` string match
   the Node oracle.
2. Transform error shape: message, location (file/line/column), partial
   `errors`/`warnings` arrays match the oracle.
3. ESM namespace vs CJS export shape of the delegate matches real esbuild's
   published surface for the proven APIs.
4. Vite 7.3.6 journeys (dev render, HMR edit, build output, preview,
   optimizeDeps) — same-project differential against the quarry's proven
   green baseline.
5. Vite 8.0.16 default: zero esbuild network requests, zero shadow capability,
   dev/build/preview green (observable network assertions, not source greps).
6. Unsupported esbuild version spec (e.g. `^0.27`) →
   `NotImplementedError('shadow-registry.esbuild@<v>')` at install, tree
   unchanged.
7. `require('esbuild')` when esbuild is not in the tree → real Node
   `MODULE_NOT_FOUND` shape, no adapter activation.

## Fault matrix

Tier `production`:

| Boundary × fault | Honest outcome |
|---|---|
| Asset fetch truncated/corrupt (SRI mismatch) | loud typed failure, retryable; never host bytes, never approximate output |
| Cold start fully offline (no cache, no network) | loud actionable error naming the missing asset; no hang, no silent degradation |
| Storage evicted between sessions | readiness honestly absent → visible re-acquire on next run |
| Crash mid-fill | no ready receipt → re-acquire; no partial trust |
| Adapter dispatch with substitution absent from tree | `MODULE_NOT_FOUND` parity — no capability minted |
| Child crash before capability consume | one-shot ports closed by kernel finalization; owner reservation settles on confirmed exit |

## Out of scope

- `esbuild` APIs beyond the differentially proven surface — named
  `NotImplementedError('esbuild.<api>')` + compat ❌ per API (`build` beyond
  Vite-internal usage, `context`, `serve`, `watch`, `analyzeMetafile`,
  `initialize` options beyond the adapter's) — never a partial stub.
- `esbuild` versions other than 0.28.0 —
  `NotImplementedError('shadow-registry.esbuild@<v>')` + compat ❌.
- The `esbuild` CLI/bin — `NotImplementedError('esbuild.cli')` + compat ❌.
- A second Pattern-2 runtime-asset adapter (generalization stays withdrawn,
  ADR-0308 hook: sharp/libvips-wasm).
- Any public adapter/plugin SPI (ADR-0308: construction-time trust decision).

## Decisions

- ADR-0308 owns dispatch-by-adapterId, the no-consumer-branches rule, and the
  quarry disposition (0296/0298 not adopted, 0300 confirmed).
- ADR-0307 owns why no temp-cache/tree machinery participates here.
- ADR-0051 owns the native-dependency install policy the alias retirement
  finishes honoring.
- The proven direct surface is defined by the differential suite (floor:
  transform + version); widening it is test-first, never assumption-first.
- Delete-on-done together with the absorbed
  `esbuild-substitution-strategy-reconciliation` scope.
