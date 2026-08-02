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
`ad6b9f6f3a8543d59d9f5fd2bd5d6ae58f357fc9be2be69f82988008272976ff`.
The complete artifact is
`tools/shadow-registry/src/fixtures/sass-1.100.0-constructor-liveness.json`,
SHA-256
`27b905ad4e1122e27ffdf364cab3d7a2bd067e305cc773f61a3b606377d236c8`.

Each package's CJS and ESM entry first passes a twice-run import-only control,
then runs `Compiler` and `AsyncCompiler` twice in isolated process groups. Pure
Sass throws the exact direct-construction error and exits 0 naturally. Exact
embedded publishes the corresponding exact
`Compiler caused error: ...` value, then remains refed for 1,500 ms measured
from a structured IPC outcome; a separate 5,000 ms startup bound cannot collide
with this lifetime window. All eight embedded constructor runs hit the
post-outcome bound; all eight pure constructor runs and all import controls
exit. Exact name/message/toString/stdout are frozen.

The artifact pins both package integrities, exact
`sass-embedded-darwin-arm64@1.100.0` integrity, and byte identities for its Dart
executable plus snapshot. Before timeout the probe reads PID/PPID/PGID state and
requires exactly the Node leader plus that platform Dart executable as its
child. It then sends `SIGKILL` to the group and verifies group disappearance.
Error-path/exit/SIGINT/SIGTERM cleanup covers failed and interrupted probes;
every completed attempt proves its group gone before the next attempt.

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
