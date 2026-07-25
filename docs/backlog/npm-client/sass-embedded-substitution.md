---
area: npm-client
status: ready
title: sass-embedded@1.100.0 via synthesized facade — second substitution, seam proof
created: 2026-07-23
why: real Vite SCSS projects pin sass-embedded, whose dart platform binary cannot run in the browser; ADR-0310's spike proved the exact pure-JS sass twin matches every surface Vite and direct consumers touch, so Sass ships as the registry's second substitution and proves the seam is package-generic
epic: honest-shadow-substitutions
sources: [ADR-0308, ADR-0310]
---

## Context

Slice `sass-scale-proof` (see epic §Budget). Carrier decided by ADR-0310
(Pattern 1: immutable synthesized `sass-embedded@1.100.0` facade over the
exact upstream pure-JS `sass@1.100.0` twin; finite adapted divergence list;
no runtime assets/MessagePort/adapter). The PR is deliberately constrained to
package-specific files so review can see whether the seam is real.

## Acceptance

- Fresh/replay/snapshot and applicable general-Eddy materialization retain the
  exact substitution marker and acquisition provenance.
- Zero `sass-embedded` platform binary/optional packages fetched; the exact
  `sass@1.100.0` twin and its dependencies are recorded; no runtime-asset
  capability is created and zero manager/store operations run.
- Direct guest CJS `require('sass-embedded')` and ESM
  `import('sass-embedded')` probes match the finite Node oracle from the
  ADR-0310 differential suite, including lifecycle
  (initCompiler/initAsyncCompiler, two compilations, dispose, post-dispose
  error texts), sync+async importers, logger warn/deprecation, sourceMap
  bytes, error `sassMessage`/span/message shape, synthesized `info`.
- Real Vite 7.3.6 SCSS project: nested partial and Vite-resolved `@use`,
  custom importer, a warning, source map; dev renders exact normalized CSS,
  an edit HMRs, build emits matching CSS/map/dependency facts.
- The named divergence (sync compile + async importer: loud throw where real
  sass-embedded deadlocks) is a compat ⚠ note with a differential test
  pinning BOTH behaviors.
- Unsupported versions, CLI/bin, and every unproven legacy/API surface are
  explicit compat ❌ with named `NotImplementedError('sass-embedded.<gap>')`
  throws.
- Budget carries a measured cold-install delta row (bytes + wall time for the
  twin) through the perf harness, committed as matched evidence like the
  esbuild rows; the gate is honest recording, not a threshold.
- Seam gate: a repository check lists generic files this slice is forbidden to
  modify (generic planner, manager/store, MessagePort, package-tree authority,
  owner/VFS/bootstrap/kernel path, runtime-js, esbuild adapter). Needing any
  of them means the seam failed — return to decision review, do not patch.

## Parity cases

Oracle: real Node v24.16.0 `sass-embedded@1.100.0`. Enumerated from the
ADR-0310 spike; each is a differential test:

1. CJS/ESM export shape (cleaned namespace; no dart2js dead keys).
2. `compileString`/`compileStringAsync` css + `loadedUrls` + absent sourceMap.
3. `sourceMap: true` + `sourceMapIncludeSources: true` byte-identical map.
4. Compiler lifecycle: two compiles, dispose, post-dispose sync/async error
   texts (`Compiler caused error: Sync|Async compiler has already been
   disposed.`).
5. Modern importer sync + async incl. `containingUrl`; `loadedUrls` content.
6. Logger: `@warn` call shape; `slash-div` deprecation id + span.
7. Errors: `expected "}".` and missing-@use — `Error: `-prefixed message,
   sassMessage, span start/end/text, `span.url: undefined`.
8. `info === "sass-embedded\t1.100.0"`.
9. Legacy `renderSync` output + stats keys + legacy-js-api deprecation.

## Out of scope

- `sass-embedded` versions other than 1.100.0 and any version range —
  `NotImplementedError('sass-embedded.version')` + compat ❌.
- The `sass` CLI/bin — `NotImplementedError('sass-embedded.cli')` + compat ❌.
- Watch mode / `@parcel/watcher` surface.
- A Sass runtime-asset adapter or any no-op Workbench adapter to fake N=2 on
  the runtime-asset seam (forbidden by ADR-0310).

## Decisions

- ADR-0310 owns the carrier and the adapted-divergence list.
- ADR-0308 owns the recipe/materialization model this slice instantiates.
- Delete-on-done with the sass-scale-proof PR; epic closure requires this
  slice (not optional downstream).
