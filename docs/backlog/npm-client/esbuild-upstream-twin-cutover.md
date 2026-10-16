---
area: npm-client
status: draft
title: In COI, an `esbuild@<range>` request installs and runs unmodified upstream `esbuild-wasm` of the resolved version through its own Node entry, proven by one version-agnostic differential suite
created: 2026-10-16
why: today `esbuild` is one exact recipe (0.28.0) over a generated, 13-patch browser-client runtime; every other version is refused and adding one means re-porting anchors, re-entering hashes and re-capturing a native oracle across 66 non-doc files
epic: esbuild-upstream-twin
blocked_by: [runtime-js/process-stdio-write-callback, runtime-js/child-process-ref-unref, runtime-js/fs-stdio-fds, runtime-js/fs-stats-node-fields, runtime-js/worker-threads-unsupported-workerdata-no-silent-hang]
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, ADR-0226, ADR-0371, ADR-0361, ADR-0316, ADR-0375, ADR-0384, docs/public/compat/esbuild-js-api.md]
code: [tools/shadow-registry/src/internal/catalog-source.ts, tools/shadow-registry/src/runtime/runtime-adapters.ts, tools/shadow-registry/src/runtime/vite-esbuild-runtime.ts, tools/shadow-registry/tools/generate-esbuild-runtime.ts, packages/npm-client/src/internal/shadow/admission.ts, tools/compat-matrix-generator/cli.js]
---

## Context

Finding (2026-10-16, evidence file). With the four Node-surface gaps
shimmed in-guest (layers f1-f5), unmodified `esbuild-wasm@0.28.0` gives
Node-identical transform, stdin-resolve build, `outfile` build and CLI
`--bundle` output under COI. Under no-COI the same-realm child refuses
`node_modules` (`child_process.same-realm.require`), so there the generated
client stays (goal I4). Cost of today's per-version route: evidence §Today's
cost.

Scope from the goal: I1 (install shape: upstream bytes, no generated client in
COI), I2 (async API, lifecycle, CLI with pipe/TTY/file stdout = esbuild-wasm
on Node 24 for the verified set: the latest 0.21.x, 0.25.x and 0.28.x at
pickup; `*Sync` loud on both routes; Vite 7.3.6 lanes), I4 (no-COI resolution
and client as on main, other versions loud naming the tier, declared
`platform-gap` row), I5 (version-agnostic suite; compat page verified /
"⚠️ not verified"), I6 (COI Vite gate removed; Vite 7.3.6/8.0.16 verified,
others "⚠️ not verified"). Keeps `honest-substitution-signals` I2 (facade
`types`) true for every installed version; the ADR-0226 D4
validation-before-gap loss for COI `*Sync` is named in the DEC-2 ADR (goal
§Decisions). The Vite 7.3.6 starter pin (`vite-project-policy.ts:11-12`)
stays; its esbuild-runtime reason and `vite-version.contract.test.ts` anchor
re-point here (map §Open questions).

## Question

Which install shape and tier split deliver I1/I4 with the fewest mechanisms
(map §Open questions: redirect vs thin facade vs Node's npm-alias identity —
`require('esbuild/package.json').name`; per-tier resolution), which current
contract rows map onto the esbuild-wasm-on-Node oracle (rows today emulating
native — `native-target-errno`, `native-validation-provenance` — change
expected output), what the older Node entries need (map §Open questions,
0.21.x), whether the Vite install patches and the 7.3.6-copied CLI grammar
hold for Vite 5/6 (map §Open questions, I6), and which surfaces the first
differential run shows as loud gaps?
Settled at PICKUP with the DEC-2 ADR named in the goal.
