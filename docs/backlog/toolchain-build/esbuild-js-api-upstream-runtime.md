---
area: toolchain-build
status: ready
title: Vite 7 esbuild config and optimizer runtime over guest VFS
created: 2026-07-11
why: Vite config graphs and dependency optimization need esbuild's real plugin/context contract; the current shim loud-throws and an API facade repeatedly drifted
user_story: As a developer running Vite 7 with a local-importing vite.config.ts and an ordinary CJS dependency, I want optimize and build to use esbuild like Node, but today config bundling and non-empty contexts loud-throw.
blocked_by: []
sources: [ADR-0226, ADR-0047, ADR-0015, PR-125-esbuild-facade-forensics]
code: [tools/shadow-registry/src/index.ts, apps/playground/src/workers/vite-cli-prep.ts, packages/runtime-js/src/internal/worker-globals.ts, packages/runtime-js/src/module-loader/interop.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Vite 7.3.6 uses async `transform`/`formatMessages`, config `build({write:false})`, scan `context({write:false})`, and default-write prebundle context. Its dev/build/preview/optimize chunks all import `config.js` → top-level `esbuild`. The current shim has transform, one virtual module, and an empty context. PR #125's esbuild-facade production slice copied upstream behavior and repeatedly drifted; its other slices are independent.

## User scenario

A Vite 7.3.6 project has `vite.config.ts` importing `./config-helper.ts`; the app imports real CJS `picocolors`. `vite optimize --force` creates a usable prebundle, then `vite build` applies the helper marker to `dist`.

## Acceptance

- Native `esbuild@0.28.0` and Chromium guest match every parity row after normalizing only temp-root paths and stacks.
- The runtime is generated from hash-pinned upstream browser CJS; only ADR-0226 environment/capability anchors differ. No API facade, `Proxy`, cloned plugin/options, injected writer, result normalizer, or second API object exists.
- `prepareViteCli` action modes `dev|build|preview|optimize` await one startup branch, then publish the exact CJS outer through the typed realm slot before Vite import; failed startup publishes nothing. `info` (CAC no-action: help always; version only without a named command) never starts or publishes. Named command + version remains its action mode. The overlay has one CJS body/id; the legacy transform bridge is absent.
- Common CJS interop returns the outer as ESM default and caches one stable namespace per loaded CJS module; all native outer/default/named/`PluginBuild.esbuild` relations hold.
- Invalid plugin shape rejects before `setup`; supported calls preserve caller option/plugin identity.
- Context prebundle JS + parseable map exist in guest VFS before user `onEnd`; a file-as-outdir path matches native rejection and creates no output marker.
- Every named gap validates first, then throws only for an otherwise-valid unsupported success path.
- Required Chromium proof uses exact Vite 7.3.6, real wasm, Vite Worker, and owner-backed VFS: optimize writes `picocolors`; build writes the config-helper marker.
- Proof: `tools/shadow-registry/src/esbuild-contract-*.test.ts`, `packages/runtime-js/src/module-loader/cjs-interop.test.ts`, `apps/playground/src/workers/vite-cli-prep.test.ts`, `tests/browser-unit/esbuild-vite-contract-red.spec.ts`.

## Reference contract

- Oracle: Node package `esbuild@0.28.0`; consumer: `vite@7.3.6`.
- Mechanism: exact upstream browser CJS channel/plugin/context client; generated environment and named gates only, per ADR-0226.

## Parity cases

| ID | Exact failing-first target |
|---|---|
| `runtime-publication` | four fresh `dev|build|preview|optimize` children publish through one awaited branch before first import with no legacy bridge; one fresh `info` child reaches its launcher with neither slot nor bridge; injected failure leaves the slot absent; CAC help/version edges match exact Vite 7.3.6 |
| `module` | outer !== `.default`; `.default.default` self; ESM default === outer; repeated ESM loads return one namespace; named method refs match; `PluginBuild.esbuild === outer.default` |
| `plugin-validation` | unknown enumerable plugin key rejects before `setup`; valid plugin sees caller options/plugins by reference |
| `transform` | TS input, loader/format/sourcemap/legal-comments options, result descriptors and bytes match |
| `transform-large` | one 1,048,577-byte ASCII TS input crosses upstream's 1 MiB FS path, completes, and preserves a tail marker in output |
| `default-wd` | omit `absWorkingDir`; relative entry/outfile resolve under guest cwd, never host `/` |
| `format-messages` | warning location, notes, color false, width 80, and rendered text match byte-for-byte after root normalization |
| `config-build` | relative TS config imports local helper, leaves bare `vite` external, `write:false`, reports both metafile inputs, writes no disk output |
| `dep-scan` | Vite-shaped stdin context with `write:false`; async resolve/load; rebuild contains dependency; cancel then dispose; no disk output |
| `dep-prebundle` | Vite-shaped default-write context; resolve/load/onEnd; JS + map exist before onEnd; usable metafile; dispose |
| `dep-prebundle-write-failure` | same rebuild into a file-as-outdir matches native diagnostics; no invented `code` or output marker; dispose settles |
| `gap-lifecycle` | invalid `initialize({bogus:true})` gets native validation; valid `initialize({worker:false})` then `esbuild.initialize`; `stop()` → `esbuild.stop` |
| `gap-sync` | each sync method rejects `{bogus:true}` with its native validation, then valid input with its matching named gap |
| `gap-analyze` | explicit `undefined` gets native validation; upstream-supported malformed `'{'` and a valid empty metafile → `esbuild.analyzeMetafile`; sync twin follows the same ordering |
| `gap-context` | invalid watch/serve option gets native validation; valid call → `esbuild.context.watch` / `.serve` |
| `gap-build-write` | invalid plugin and post-setup non-boolean write still reject first; effective boolean write true → `esbuild.build.write`; plugin flip to false remains supported |
| `browser-vite` | real Worker/VFS + exact Vite optimize and build; prebundle bytes and built config marker prove success |

## Fault matrix

| Axis × operation | Honest outcome |
|---|---|
| `sibling-drift` × options/plugins/module views | one generated upstream object graph; `module` + `plugin-validation` differential rows |
| `frozen-assumption` × source/Vite calls | exact source/WASM hashes + live exact-version oracle + baked Vite 7.3.6 action-import/CAC pins; generated-output anchors are owned by the pre-implementation provenance gate below |
| `lossy-aggregate` × returned/disk outputs | exact canonical metafile shape + normalized SHA-256 for JS, maps, and large transforms; byte counts and marker booleans are secondary evidence only |
| `observable-order` × capability gates | upstream validation/error priority precedes every named gap |
| `poisoned-cache` × CJS namespace | module-registry record owns one namespace; coherent invalidation evicts record + namespace together |
| `provenance-lie` × browser acceptance | only real `.vite/deps` and `dist` bytes close acceptance |

## Out of scope

All option-bearing gaps run upstream validation first; valid inputs then throw:

- one-shot `build` with post-plugin effective `write !== false` → `NotImplementedError('esbuild.build.write')` + compat ❌; contexts may write;
- `context.watch` / `context.serve` → `NotImplementedError('esbuild.context.watch'|'esbuild.context.serve')` + compat ❌;
- `buildSync` / `transformSync` / `formatMessagesSync` / `analyzeMetafileSync` → matching `NotImplementedError` + compat ❌;
- direct guest `initialize` / `stop` → `NotImplementedError('esbuild.initialize'|'esbuild.stop')` + compat ❌;
- async `analyzeMetafile` → `NotImplementedError('esbuild.analyzeMetafile')` + compat ❌;
- versions other than exact 0.28.0 reject at shadow substitution;
- Vite 8/Rolldown, CLI keepalive, networking, and non-esbuild PR #125 slices.

## Decisions

- ADR-0226 fixes exact upstream source + generated environment/gates; no facade fallback.
- Before generated-client production code, its provenance/compat slice lands mutation RED for missing/duplicate patch anchors, an emitted-diff allowlist, and request-version gates across fresh/replay + direct/transitive/user-override installs; the source pins here are the input gate, not that later proof.
- Generated client, startup/slot/overlay, and common CJS interop/cache are independent slices with separate RED proof; final Chromium acceptance joins them on one SHA.
- One Worker owns one upstream service; `prepareViteCli` solely publishes after init for four action modes; `info` stays outside startup; Worker termination owns teardown.
- Config + scan + prebundle stay one item because exact Vite acceptance needs all three; every excluded guest surface is a validation-before-gap contract.
