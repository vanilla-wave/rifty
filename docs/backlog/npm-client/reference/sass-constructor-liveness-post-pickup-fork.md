# Sass invalid-construction liveness — post-pickup fork

Recorded 2026-08-02 on Node v24.16.0, Darwin arm64, against exact public
`sass@1.100.0` and `sass-embedded@1.100.0`. The ready attempt was
`171f62f86fbb3fefff856a5a71cb4cda209a0e1c`; product head was
`9618ab31f0d758e5836a5c3c7525fe166b5a0df2`.

## Reproduce

```sh
oracle_root=$(mktemp -d)
cd "$oracle_root"
npm init -y
npm install --save-exact --ignore-scripts \
  --registry=https://registry.npmjs.org \
  sass@1.100.0 sass-embedded@1.100.0
cd -
node tools/shadow-registry/tools/sass-constructor-liveness-probe.mjs \
  --check "$oracle_root"
```

The process-group probe is
`tools/shadow-registry/tools/sass-constructor-liveness-probe.mjs`, SHA-256
`58a5bed9e362ef626db8c799dd26bce176d50b3ddc7720e1e2e7d8cf09e3665c`.
The complete artifact is
`tools/shadow-registry/src/fixtures/sass-1.100.0-constructor-liveness.json`,
SHA-256
`231137b72e29e4e7cbe20cf3b4ffa19bb7fd07734dfa16d63f221e284c603b5c`.

Each of CJS and ESM runs `Compiler` and `AsyncCompiler` twice in an isolated
process group. Pure Sass throws the documented direct-construction error and
exits 0 naturally. Exact embedded prints the corresponding
`Compiler caused error: ...` value, then remains refed past 1,500 ms; the probe
sends `SIGKILL` to the whole group. All eight embedded runs time out; all eight
pure runs exit. No child survives the probe.

The embedded constructors start their Dart child before the constructor body
rejects and expose no handle to dispose after the caught error. The synthesized
pure-Sass facade therefore matches error values but not post-catch process
liveness. A timer, MessagePort, or unrelated Worker would be an approximate
active resource, not the observed child. Carrying the actual Dart runtime
conflicts with the selected no-runtime-asset carrier.

Fault class: product `observable-order`; oracle `frozen-assumption` /
`lossy-aggregate`. Per `decision-workflow.md` §Backlog readiness 5, this
post-pickup observable fork demotes the item and requires manual refinement.

## Pre-demotion Acceptance — verbatim

- Fresh install, lockfile replay, durable reopen, and applicable general-Eddy
  materialization retain the exact substitution marker and acquisition
  provenance.
- Required-OPFS Chromium injects real Sass-tarball network loss, publishes no
  facade or lock, survives abrupt owner teardown, then retries exactly; a
  second abrupt offline reopen reuses the byte-identical tree and provenance.
- Before tarball work, the official `sass@1.100.0` manifest exactly matches the
  recipe's complete required, optional, peer, bundled, and omitted-optional
  projection. Drift in any map rejects with
  `NotImplementedError('sass-embedded.acquisition')` before cache, VFS, tree,
  lock, facade, or success effects.
- The exact non-bundled required dependencies enter the ordinary resolver and
  materialize their complete registry closure with exact range, version,
  integrity, tree, and lock facts. The omitted `@parcel/watcher` optional
  dependency causes zero registry/cache reads and no tree or materialized-child
  lock entry.
- Zero `sass-embedded` platform binary/optional packages fetched; the exact
  `sass@1.100.0` twin and its dependencies are recorded; no runtime-asset
  capability is created and zero manager/store operations run.
- Direct guest CJS `require('sass-embedded')` and ESM
  `import('sass-embedded')` probes match the finite Node oracle from the
  ADR-0344 differential suite, including lifecycle
  (direct construction errors; repeated path and string compilations;
  sync/async dispose return values; path/string post-dispose error texts),
  sync+async importers, logger warn/deprecation, sourceMap bytes, error
  `sassMessage`/span/message shape, synthesized `info`.
- Real Vite 7.3.6 SCSS project: nested partial and Vite-resolved `@use`,
  custom importer and a warning; dev renders exact normalized CSS, an edit
  HMRs, and build emits the exact Node-oracle CSS/dependency facts. Node emits
  no external CSS map for this configuration, so rifty must not invent one.
- The named divergence (sync compile + async importer: loud throw where real
  sass-embedded deadlocks) is a compat ⚠ note with a differential test
  pinning BOTH behaviors.
- Unsupported versions, CLI/bin, watch mode, and missing TypeScript
  declarations are explicit compat ❌. Reachable runtime gaps throw their
  exact named `NotImplementedError('sass-embedded.<gap>')`; the facade claims
  only the finite differential rows rather than inventing a catch-all API gap.
- Budget carries a measured cold-install delta row (bytes + wall time for the
  twin) through the perf harness, committed as matched evidence like the
  esbuild rows; the gate is honest recording, not a threshold.
- Seam gate: a repository check rejects Sass-name recognition in generic
  catalog consumers, registry resolution, installer/planner/provenance, VFS,
  Workbench, kernel/runtime, manager/store, MessagePort, or the esbuild adapter.
  Generic edits are limited to data-driven catalog redirect derivation,
  dependency-projection execution, and exact lock/replay validation. No second
  resolver, cache, lock, scheduler, facade publisher, or package-tree owner.

## Pre-demotion Parity cases — verbatim

Oracle: real Node v24.16.0 `sass-embedded@1.100.0`. Enumerated from the
ADR-0344 evidence; each is a differential test:

1. CJS/ESM export shape (cleaned namespace; no dart2js dead keys).
2. `compileString`/`compileStringAsync` css + `loadedUrls` + absent sourceMap.
3. `sourceMap: true` + `sourceMapIncludeSources: true` byte-identical map.
4. Compiler lifecycle: direct construction errors; repeated `compile` /
   `compileString` and `compileAsync` / `compileStringAsync`; dispose return
   values; exact post-dispose path/string errors (`Compiler caused error:
   Sync|Async compiler has already been disposed.`).
5. Modern importer sync + async incl. `containingUrl`; `loadedUrls` content.
6. Logger: `@warn` call shape; `slash-div` deprecation id + span.
7. Errors: `expected "}".` and missing-@use — `Error: `-prefixed message,
   sassMessage, span start/end/text, `span.url: undefined`.
8. `info === "sass-embedded\t1.100.0"`.
9. Legacy `renderSync` output + stats keys + legacy-js-api deprecation.
