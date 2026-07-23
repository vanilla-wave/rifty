# ADR 0310: Sass ships as a synthesized sass-embedded facade over the exact pure-JS sass twin

Status: Accepted
Date: 2026-07

> TL;DR: `sass-embedded@1.100.0` substitutes as Pattern 1 — an immutable
> synthesized facade over the exact upstream pure-JS `sass@1.100.0` twin,
> adapting the finite spike-measured divergence list (info string, exception
> message shape, dispose texts) — with no runtime assets, no MessagePort, no
> Workbench adapter; it is never counted as a second runtime-asset consumer.

## Context

Sass is committed scope of the shadow-substitution series (ADR-0308); the
spike chose the honest carrier, not whether Sass ships. Differential spike
(2026-07-23, Node v24.16.0, exact pins `sass@1.100.0` / `sass-embedded@1.100.0`,
one parameterized probe script):

- MATCH byte-for-byte: full functional export surface (compile/compileString/
  compileStringAsync, initCompiler/initAsyncCompiler + Compiler/AsyncCompiler
  lifecycle, legacy render/renderSync, Value types, deprecations), output css,
  loadedUrls, sourceMap object (identical mappings/sources/sourcesContent),
  sync+async modern importers incl. `containingUrl`, logger warn/deprecation
  calls (`slash-div` id, spans), sassMessage + span coordinates on errors.
- DIFF (finite, enumerable): `info` string (`dart-sass…[Dart]\ndart2js…` vs
  `sass-embedded\t1.100.0`); embedded prefixes `Error: ` into
  `Exception.message`/toString; `span.url` `undefined` vs `null`; dispose
  error texts (`Compiler has already been disposed.` vs `Compiler caused
  error: Sync|Async compiler has already been disposed.`); dart2js dead export
  keys (`cli_pkg_main_0_`, `load`, `loadParserExports_`, ESM `parser_`) vs
  embedded's type-only `CalculationOperator`; a `sass` bin under both names.
- Behavioral footgun: sync `compileString` with an async importer — pure sass
  throws a clean Exception; sass-embedded DEADLOCKS the event loop permanently
  (reproduced twice, lingering dart child).
- Vite 7.3.6 consumes only `initAsyncCompiler` → `compileStringAsync` →
  `dispose`, prefers the `sass-embedded` name, passes no logger, never reads
  `info`, and already falls back to pure `sass` through the same code path —
  every surface it touches is in the MATCH set.
- Payload: sass-embedded = 1.2 MB host + 10 MB per-platform dart binary from
  18 platform optionalDependencies; pure sass = 5.7 MB, no platform packages
  (its optional `@parcel/watcher` native dep serves watch mode only and is not
  fetched for the substitution).

## Decision

- Pattern 1: the registry materializes an immutable synthesized
  `sass-embedded@1.100.0` facade whose implementation is the exact upstream
  pure-JS `sass@1.100.0` twin, recorded with materialization/acquisition
  provenance per ADR-0308. No `sass-embedded` platform binary or optional
  package is fetched.
- The facade synthesizes the measured embedded-observable surface instead of
  leaking the twin's: exact `info` string `sass-embedded\t1.100.0`, the
  `Error: ` message/toString prefix, embedded dispose error texts,
  `span.url: undefined`, and a cleaned export namespace without dart2js dead
  keys. The spike's differential suite is the finite oracle; each adapted
  surface is pinned by a differential test against real Node `sass-embedded`.
- Named divergence (compat note, deliberate): sync compile with an async
  importer throws the pure-sass Exception where real sass-embedded deadlocks
  forever. A permanent event-loop deadlock is not reproducible honestly; the
  loud throw is recorded as ⚠ divergence, never presented as parity.
- No runtime assets, no MessagePort server, no Workbench adapter, zero
  manager/store operations: the substitution's runtime binding is absent and
  its asset plan is empty. Sass is NOT counted as a second derived-runtime
  adapter; the runtime-asset seam stays N=1 (ADR-0308 hook records the real
  Pattern-2 candidate).
- Unsupported: other `sass-embedded` versions, the `sass` CLI/bin, and every
  unproven legacy/API surface → named `NotImplementedError` + compat ❌.

## Consequences

- (+) Sass proves the registry/materialization seam with an install-only
  substitution; the Sass slice's generic-file no-change gate is meaningful.
- (+) ~10 MB platform binary never fetched; cold-install delta (bytes + wall
  time for the twin) is measured and committed as matched evidence in the Sass
  slice's Budget.
- (−) Version-exact: the facade is proven only for the 1.100.0/1.100.0 pair;
  a version bump re-runs the differential suite before widening.
- Follow-up: `npm-client/sass-embedded-substitution` carries the acceptance
  (direct CJS/ESM lifecycle parity + real Vite 7.3.6 SCSS dev/HMR/build).
