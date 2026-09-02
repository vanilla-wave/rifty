---
area: distribution
status: draft
title: no-COI build loop — sandbox composition for real Vite 7 + loud capability gate + no-COI CI lane
created: 2026-08-28
epic: no-coi-sandbox-tier
why: the real-Vite composition (esbuild-wasm adapter, bin execution, npm/shell wiring) exists only behind workbench COI gates; the sandbox tier needs the same loop composed in the single worker, a capability report making every gap loud, and a CI lane that serves NO COOP/COEP — today zero browser lanes do
user_story: As an agent platform, I want createSandbox → install → vite build → dist on a headerless page with a report naming what throws/degrades, but today the composition throws at the workbench gate and no lane proves any of it
sources: [ADR-0071, ADR-0131, ADR-0137, ADR-0174, ADR-0316, ADR-0375, docs/backlog/distribution/reference/no-coi-build-spike-record.md, docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, distribution/iframe-embed]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/vite-esbuild-runtime.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/os.ts]
---

## Context

The durable spike proved the loop, but its worker deep-imported Workbench
internals and installed globals by hand. Current source still has only the
generic `createSandbox` eval/fs protocol; the real install + adapter + bin
composition lives in Worker-only Workbench code. ADR-0375 selects the narrow
product seam: explicit `toolchain:{workerUrl}`, one Workbench-owned Worker, manifest install
and run-to-completion `.bin` execution. It deliberately does not absorb the
broader `sandbox.exec()` or the next child's dev/preview lifecycle.

Current-source evidence C148-BUILD, source/tree
`1519229f3a837abf0d285be40222aa6774149983` /
`3ef946662dddac42d24060d46c28c8f252412f81`:

```sh
node tools/perf/child-fs.mjs --runs 1 --port 5397 \
  --out /private/tmp/no-coi-build-loop-current-tree.json
# Chrome 148.0.7778.96, Playwright 1.60.0, Node 24.16.0, pnpm 11.5.2
# scenario 559e5e226348c484d542f197b442d3826e11d9e19c206d028c978d96a4595d4c
# deps de9e65b1ca98200f8be9b40080b3d5ac871c962786b33665d564b3da68d4b0bc
# product-coi: real npm install + .bin/vite, exit 0, 2180 modules
# in-realm: real npm install + .bin/vite, exit 0, 2180 modules
```

This re-verifies the real current carriers and spike premise. The lines use
different edit markers, so their hashed JS names differ; they are not claimed
as byte parity. The RED carrier uses one frozen project/marker in both live
products and compares the complete `dist/` path set, bytes and SHA-256.

## Discovered fork — 2026-09-01 re-cut

After Contract+RED PASS at `f0066d4d2`, merging current main replaced the
shadow-asset acquisition authority with ADR-0371's installed registry twin.
The ready contract then silently changed Parity 6 and the acquisition fault
row from shadow bytes plus the pinned 26-test carrier to registry-twin bytes
plus a 51-test carrier. The observable promise stays: exact admitted runtime
bytes, bounded reads, loud required-fetch/corruption failures and deduplicated
same-key acquisition. The carrier/authority fork must be recompiled and
re-reviewed; it cannot ride the old verdict.

Recompiled resolution: ADR-0375 grafts ADR-0371's installed registry-twin
authority; Evidence C148-NPM uses the 51-test registry-twin carrier. Acceptance
and user-observable parity remain unchanged and are strengthened below by the
three Final+GREEN blocker carriers.

## Discovered fork — 2026-09-01 packed-surface split

The second consecutive Contract+RED blocker in this lineage pinned a package
distribution obligation that is independently deliverable before browser
runtime behavior: real packed SDK/Workbench JavaScript plus strict public
declarations. User resolved the binding stop by splitting that obligation to
`distribution/no-coi-packed-toolchain-surface`; this item is demoted and blocked
on it. The observable goal is unchanged.

User scope also invalidates Vite-specific infrastructure: Vite 7 is only the
representative shared-memory-free browser oracle, and Vite 8 only the named
threaded-WASM boundary fixture. SDK/runtime/control-plane/package/distribution
infrastructure must install an exact manifest and run an arbitrary admitted
installed bin without Vite identity, version, callbacks, paths, types or
lifecycle.

### Pre-demotion Acceptance (verbatim, second re-cut)

1. A navigation response served by the dedicated no-COI Vite config has no
   COOP/COEP. Before sandbox boot, during install, during build and after build,
   the same document/time-origin reports `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'`; no bootstrap reload occurs.
2. The host is opened from an existing same-origin app. Its live
   `window.opener` message round-trip and a no-CORS/no-CORP image from a second
   headerless loopback origin work before/during/after exactly as at entry.
   Both complete while an install and a run-bin operation remain admitted at
   a held real network boundary; overlap proves admission, releasing the
   boundary completes the original operation.
3. `createSandbox` admits no-COI only through the explicit existing
   `requireCrossOriginIsolation:false`; default admission still throws
   `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
   before returning and exposes the ADR-0375 install/run-bin methods over the
   same `runtime`/`fs` Worker. A valid backend paired with any mismatched
   protocol rejects `NotImplementedError('sandbox.toolchain.worker')` and
   terminates that Worker; it is never ignored or later admitted. Real packed
   SDK and Workbench tarballs expose a buildable SDK root and
   `no-coi-toolchain-worker` graph; neither depends on an unpublished runtime
   subpath.
4. The immutable report contains exactly these no-COI feature outcomes:
   `fs`, `npm.install`, `node_modules.bin`, `child_process.spawn.stdio` working;
   `child_process.spawn`, `worker_threads.Worker`, `os.parallelism`
   degraded with explicit warnings (`os.parallelism.value=1`); and
   `child_process.execSync`, `toolchain.threaded-wasm`, `toolchain.dev-hmr`
   throwing with named `NotImplementedError` features. It is recursively
   frozen with `schemaVersion:1`, tier `shared-memory-free` and the listed row
   order; warning strings are the exact strings pinned by the RED carrier.
5. Two same-realm spawns warn exactly once, both children retain landed
   console→stdout/stderr pipe behavior, and both settle in order.
   `worker_threads.Worker` retains its own once-only same-realm warning.
   `os.cpus().length===availableParallelism()===1`. `execSync` throws
   `NotImplementedError` with `feature==='child_process.execSync'`.
6. From the frozen project manifest, the real npm-client installs every exact
   dependency version and the admitted `esbuild-wasm@0.28.0` runtime. The
   executed entry is exactly `/project/node_modules/.bin/vite`, args exactly
   `['build']`, exit exactly 0, with exactly one `2180 modules transformed`
   line and no curated/deep-import execution path.
7. The live no-COI and live COI products receive byte-identical project files
   and marker. Their complete normalized `dist/` relative-path sets are equal;
   every paired file has equal length, equal bytes and equal SHA-256. The JS
   contains the marker exactly twice, matching the frozen source's two sites;
   equality is not count-only or filename-only.
8. A real `vite@8.0.16` install followed by its installed `.bin/vite build` in
   the no-COI sandbox rejects before Rolldown pthread startup with
   `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, and a message
   naming Vite 8, Rolldown/WASI pthreads and COI/SharedArrayBuffer. It writes no
   successful `dist/` claim. Direct guest construction of shared
   `WebAssembly.Memory` rejects with the same feature, while non-shared memory
   still constructs. WebIDL-truthy `shared:1` and `shared:'yes'` reject beside
   own/inherited/accessor literal-true descriptors through REPL, CJS, ESM and
   an installed bin; non-shared native constructor/prototype identity stays.
9. Toolchain input is validated once before mutation. A malformed cwd/bin/args
   rejects loudly; a second install/run overlapping one admitted operation
   rejects immediately as `SandboxToolchainBusyError` rather than racing or
   queuing. Dispose/Worker death rejects the admitted promise; none hangs.
10. `pnpm test:no-coi` is a committed Playwright Chromium lane with its own
    headerless server config/port and CI job. It runs the public SDK path and
    live COI oracle; it is never a route-intercept header simulation and never
    boots the Playground app no-COI.

### Pre-demotion Parity cases (verbatim, second re-cut)

1. Current COI product vs no-COI toolchain Worker: one project/dependency
   digest, exact installed versions, real `.bin/vite`, exit/module count, full
   `dist` paths+bytes+SHA. Artifact: C148-BUILD establishes both current
   compositions; `pnpm test:no-coi -g "build parity.*designed RED"` is the
   committed differential and current-tree RED.
2. Host document lifecycle: raw response headers + continuous page-realm
   sampling + stable time origin/opener/subresource, including round-trip and
   image reload while admitted install/run calls wait at held network
   boundaries. Artifact: `pnpm test:no-coi -g "host stays interactive while
   admitted install and run wait"` is a pre-fix green preservation carrier;
   the full build carrier repeats controls around each phase.
3. No-COI Node surfaces: spawn stdio/warn cardinality, worker_threads warning,
   CPU count and execSync feature. Artifact: Node v24.16.0 behavior is the
   external semantic baseline where applicable; the same real sandbox Worker
   carrier `pnpm test:no-coi -g "capability.*designed RED"` is the RED target.
4. Vite 8/Rolldown: exact installed `vite@8.0.16`, real `.bin` request, named
   pre-pthread rejection plus direct shared/non-shared `WebAssembly.Memory`
   boundary, including WebIDL-truthy number/string descriptors across all four
   guest entry forms. Artifact: current COI product proof is
   `tests/browser-unit/esbuild-vite-contract.spec.ts`; no-COI RED target is
   `pnpm test:no-coi -g "threaded-WASM guard covers real installed bin"`.
5. Default COI admission remains loud; generic createSandbox no-COI eval/fs
   keeps working when explicitly allowed; valid-backend protocol mismatch
   terminates through both public SDK and host-controller carriers. Real
   tarballs also build the SDK root and emitted Worker graph. Artifact:
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "valid backend but mismatched
   protocol|public admission rejects" --reporter=dot` and the no-COI
   preservation carrier; `pnpm test:packed-consumer` is the packed RED.
6. Network/admission inheritance: bounded registry reads, required fetch
   failures, corrupt registry-twin bytes and concurrent same-key acquisition stay
   loud/deduplicated. Artifact: focused npm-client fault command recorded in
   Evidence C148-NPM below; the SDK layer adds no cache/retry authority.

### Pre-demotion Acceptance (verbatim)

1. A navigation response served by the dedicated no-COI Vite config has no
   COOP/COEP. Before sandbox boot, during install, during build and after build,
   the same document/time-origin reports `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'`; no bootstrap reload occurs.
2. The host is opened from an existing same-origin app. Its live
   `window.opener` message round-trip and a no-CORS/no-CORP image from a second
   headerless loopback origin work before/during/after exactly as at entry.
3. `createSandbox` admits no-COI only through the explicit existing
   `requireCrossOriginIsolation:false`; default admission still throws
   `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
   before returning and exposes the ADR-0373 install/run-bin methods over the
   same `runtime`/`fs` Worker.
4. The immutable report contains exactly these no-COI feature outcomes:
   `fs`, `npm.install`, `node_modules.bin`, `child_process.spawn.stdio` working;
   `child_process.spawn`, `worker_threads.Worker`, `os.parallelism`
   degraded with explicit warnings (`os.parallelism.value=1`); and
   `child_process.execSync`, `toolchain.threaded-wasm`, `toolchain.dev-hmr`
   throwing with named `NotImplementedError` features. It is recursively
   frozen with `schemaVersion:1`, tier `shared-memory-free` and the listed row
   order; warning strings are the exact strings pinned by the RED carrier.
5. Two same-realm spawns warn exactly once, both children retain landed
   console→stdout/stderr pipe behavior, and both settle in order.
   `worker_threads.Worker` retains its own once-only same-realm warning.
   `os.cpus().length===availableParallelism()===1`. `execSync` throws
   `NotImplementedError` with `feature==='child_process.execSync'`.
6. From the frozen project manifest, the real npm-client installs every exact
   dependency version and the admitted `esbuild-wasm@0.28.0` runtime. The
   executed entry is exactly `/project/node_modules/.bin/vite`, args exactly
   `['build']`, exit exactly 0, with exactly one `2180 modules transformed`
   line and no curated/deep-import execution path.
7. The live no-COI and live COI products receive byte-identical project files
   and marker. Their complete normalized `dist/` relative-path sets are equal;
   every paired file has equal length, equal bytes and equal SHA-256. The JS
   contains the marker exactly twice, matching the frozen source's two sites;
   equality is not count-only or filename-only.
8. A real `vite@8.0.16` install followed by its installed `.bin/vite build` in
   the no-COI sandbox rejects before Rolldown pthread startup with
   `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, and a message
   naming Vite 8, Rolldown/WASI pthreads and COI/SharedArrayBuffer. It writes no
   successful `dist/` claim. Direct guest construction of shared
   `WebAssembly.Memory` rejects with the same feature, while non-shared memory
   still constructs.
9. Toolchain input is validated once before mutation. A malformed cwd/bin/args
   rejects loudly; a second install/run overlapping one admitted operation
   rejects immediately as `SandboxToolchainBusyError` rather than racing or
   queuing. Dispose/Worker death rejects the admitted promise; none hangs.
10. `pnpm test:no-coi` is a committed Playwright Chromium lane with its own
    headerless server config/port and CI job. It runs the public SDK path and
    live COI oracle; it is never a route-intercept header simulation and never
    boots the Playground app no-COI.

### Pre-demotion Parity cases (verbatim)

1. Current COI product vs no-COI toolchain Worker: one project/dependency
   digest, exact installed versions, real `.bin/vite`, exit/module count, full
   `dist` paths+bytes+SHA. Artifact: C148-BUILD establishes both current
   compositions; `pnpm test:no-coi -g "build parity.*designed RED"` is the
   committed differential and current-tree RED.
2. Host document lifecycle: raw response headers + continuous page-realm
   sampling + stable time origin/opener/subresource. Artifact:
   `pnpm test:no-coi -g preservation` is green before implementation; the full
   build carrier repeats the controls around each phase.
3. No-COI Node surfaces: spawn stdio/warn cardinality, worker_threads warning,
   CPU count and execSync feature. Artifact: Node v24.16.0 behavior is the
   external semantic baseline where applicable; the same real sandbox Worker
   carrier `pnpm test:no-coi -g "capability.*designed RED"` is the RED target.
4. Vite 8/Rolldown: exact installed `vite@8.0.16`, real `.bin` request, named
   pre-pthread rejection plus direct shared/non-shared `WebAssembly.Memory`
   boundary. Artifact: current COI product proof is
   `tests/browser-unit/esbuild-vite-contract.spec.ts`; no-COI RED target is
   `pnpm test:no-coi -g "threaded-WASM.*designed RED"`.
5. Default COI admission remains loud; generic createSandbox no-COI eval/fs
   keeps working when explicitly allowed. Artifact:
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   --reporter=dot` and the no-COI preservation carrier.
6. Network/admission inheritance: bounded registry reads, required fetch
   failures, corrupt registry-twin bytes and concurrent same-key acquisition stay
   loud/deduplicated. Artifact: focused npm-client fault command recorded in
   Evidence C148-NPM below; the SDK layer adds no cache/retry authority.

## Discovered fork — 2026-09-01 bounded-cause split

Final convergence stopped at 1→1: the callable WebIDL blocker closed, then a
fresh `observable-order` blocker proved the generic cause projection reads a
ninth `Error.cause` getter after its declared eight-link limit. User resolved
the binding valve by SPLIT, never a same-unit round N+1. The internal child
`runtime-js/bounded-not-implemented-cause-projection` owns only ADR-0375
Decision 5's package-generic, Vite-free projection at the existing toolchain
serialization seam. This build-loop was demoted and blocked for that child.
Final+GREEN landed at `40ded47585bd04c62b2407210d515ed4f1f65ae1`;
the completed child is deleted and build-loop stays draft but unblocked for its
next PICKUP. Its pre-demotion clauses remain exact; no user behavior weakens.

### Pre-demotion Acceptance (verbatim, bounded-cause split)

1. A navigation response served by the dedicated no-COI Vite config has no
   COOP/COEP. Before sandbox boot, during install, during build and after build,
   the same document/time-origin reports `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'`; no bootstrap reload occurs.
2. The host is opened from an existing same-origin app. Its live
   `window.opener` message round-trip and a no-CORS/no-CORP image from a second
   headerless loopback origin work before/during/after exactly as at entry.
   Both complete while an install and a run-bin operation remain admitted at
   a held real network boundary; overlap proves admission, releasing the
   boundary completes the original operation.
3. `createSandbox` admits no-COI only through the explicit existing
   `requireCrossOriginIsolation:false`; default admission still throws
   `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
   before returning and exposes the ADR-0375 install/run-bin methods over the
   same `runtime`/`fs` Worker. A valid backend paired with any mismatched
   protocol rejects `NotImplementedError('sandbox.toolchain.worker')` and
   terminates that Worker; it is never ignored or later admitted. The authority
   is generic: install the exact project manifest, then run any admitted
   installed `node_modules/.bin` path to completion. SDK/runtime/control-plane,
   package and distribution code never branches on Vite identity, version,
   callbacks, paths, types or lifecycle.
4. The immutable report contains exactly these no-COI feature outcomes:
   `fs`, `npm.install`, `node_modules.bin`, `child_process.spawn.stdio` working;
   `child_process.spawn`, `worker_threads.Worker`, `os.parallelism`
   degraded with explicit warnings (`os.parallelism.value=1`); and
   `child_process.execSync`, `toolchain.threaded-wasm`, `toolchain.dev-hmr`
   throwing with named `NotImplementedError` features. It is recursively
   frozen with `schemaVersion:1`, tier `shared-memory-free` and the listed row
   order; warning strings are the exact strings pinned by the RED carrier.
5. Two same-realm spawns warn exactly once, both children retain landed
   console→stdout/stderr pipe behavior, and both settle in order.
   `worker_threads.Worker` retains its own once-only same-realm warning.
   `os.cpus().length===availableParallelism()===1`. `execSync` throws
   `NotImplementedError` with `feature==='child_process.execSync'`.
6. From the frozen project manifest, the real npm-client installs every exact
   dependency version and the admitted `esbuild-wasm@0.28.0` runtime. The
   executed entry is exactly `/project/node_modules/.bin/vite`, args exactly
   `['build']`, exit exactly 0, with exactly one `2180 modules transformed`
   line and no curated/deep-import execution path.
7. The live no-COI and live COI products receive byte-identical project files
   and marker. Their complete normalized `dist/` relative-path sets are equal;
   every paired file has equal length, equal bytes and equal SHA-256. The JS
   contains the marker exactly twice, matching the frozen source's two sites;
   equality is not count-only or filename-only.
8. A real `vite@8.0.16` install followed by its installed `.bin/vite build` in
   the no-COI sandbox reaches the realm-local shared-memory boundary and rejects
   with `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, and a
   message naming shared WebAssembly memory, COI and SharedArrayBuffer. It writes
   no successful `dist/` claim. Vite/Rolldown identity is fixture provenance,
   never rejection policy: a Vite-8-named installed bin that makes no shared-
   memory request runs normally. Direct guest construction of shared
   `WebAssembly.Memory` rejects with the same feature, while non-shared memory
   still constructs. WebIDL-truthy `shared:1` and `shared:'yes'` reject beside
   own/inherited/accessor literal-true descriptors through REPL, CJS, ESM and
   an installed bin; non-shared native constructor/prototype identity stays.
9. A separate real `nanoid@3.3.18` exact manifest installs and its arbitrary
   admitted `.bin/nanoid --size 7` exits 0 with one seven-character ID, independent
   of Vite. Toolchain input is validated once before mutation. A malformed cwd/bin/args
   rejects loudly; a second install/run overlapping one admitted operation
   rejects immediately as `SandboxToolchainBusyError` rather than racing or
   queuing. Dispose/Worker death rejects the admitted promise; none hangs.
10. `pnpm test:no-coi` is a committed Playwright Chromium lane with its own
    headerless server config/port and CI job. It runs the public SDK path and
    live COI oracle; it is never a route-intercept header simulation and never
    boots the Playground app no-COI.

### Pre-demotion Parity cases (verbatim, bounded-cause split)

1. Current COI product vs no-COI toolchain Worker: one project/dependency
   digest, exact installed versions, real `.bin/vite`, exit/module count, full
   `dist` paths+bytes+SHA. Artifact: C148-BUILD establishes both current
   compositions; `pnpm test:no-coi -g "build parity.*designed RED"` is the
   committed differential and current-tree RED.
2. Host document lifecycle: raw response headers + continuous page-realm
   sampling + stable time origin/opener/subresource, including round-trip and
   image reload while admitted install/run calls wait at held network
   boundaries. Artifact: `pnpm test:no-coi -g "host stays interactive while
   admitted install and run wait"` is a pre-fix green preservation carrier;
   the full build carrier repeats controls around each phase.
3. No-COI Node surfaces: spawn stdio/warn cardinality, worker_threads warning,
   CPU count and execSync feature. Artifact: Node v24.16.0 behavior is the
   external semantic baseline where applicable; the same real sandbox Worker
   carrier `pnpm test:no-coi -g "capability.*designed RED"` is the RED target.
4. Threaded-WASM boundary: exact installed `vite@8.0.16` reaches the generic
   realm-local shared-memory rejection; an identity-equivalent non-threaded bin
   and exact real `nanoid@3.3.18` bin run normally. Direct shared/non-shared
   `WebAssembly.Memory` includes WebIDL-truthy number/string descriptors across
   all four guest entry forms. Artifact: current COI product proof is
   `tests/browser-unit/esbuild-vite-contract.spec.ts`; no-COI RED target is
   `pnpm test:no-coi -g "threaded-WASM guard covers real installed bin"`.
5. Default COI admission remains loud; generic createSandbox no-COI eval/fs
   keeps working when explicitly allowed; valid-backend protocol mismatch
   terminates through both public SDK and host-controller carriers. Artifact:
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "valid backend but mismatched
   protocol|public admission rejects" --reporter=dot` and the no-COI
   preservation carrier.
6. Network/admission inheritance: bounded registry reads, required fetch
   failures, corrupt registry-twin bytes and concurrent same-key acquisition stay
   loud/deduplicated. Artifact: focused npm-client fault command recorded in
   Evidence C148-NPM below; the SDK layer adds no cache/retry authority.

## Discovered fork — 2026-09-02 descriptor-evaluation split

Final convergence stopped at 1→1: the prior callable-descriptor blocker was
closed before this continuation, then a fresh `observable-order` /
`false-fallback` blocker proved the realm guard evaluates caller-owned
`WebAssembly.Memory` descriptor properties differently from native Node and
Chrome. User resolved the binding valve by SPLIT, never a same-unit round N+1.

The internal child
`runtime-js/sandbox-toolchain-memory-descriptor-evaluation` owns only the
package-generic, Vite-free evaluation defect at the existing runtime-js realm
seam: native count/order, the stateful false→true outcome, and matching
REPL/CJS/ESM/installed-bin siblings. Final+GREEN PASS landed at `dce86792d` on
tree `b1e0244ad432b5813bd9c2ff3a9e98ccf2cc7153`; the completed child is deleted
and build-loop stays draft but unblocked for its next PICKUP. All Contract/Final
lineage and the exact 1→1 stop carry; the observable goal is unchanged.

### Pre-demotion Acceptance (verbatim, descriptor-evaluation split)

1. A navigation response served by the dedicated no-COI Vite config has no
   COOP/COEP. Before sandbox boot, during install, during build and after build,
   the same document/time-origin reports `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'`; no bootstrap reload occurs.
2. The host is opened from an existing same-origin app. Its live
   `window.opener` message round-trip and a no-CORS/no-CORP image from a second
   headerless loopback origin work before/during/after exactly as at entry.
   Both complete while an install and a run-bin operation remain admitted at
   a held real network boundary; overlap proves admission, releasing the
   boundary completes the original operation.
3. `createSandbox` admits no-COI only through the explicit existing
   `requireCrossOriginIsolation:false`; default admission still throws
   `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
   before returning and exposes the ADR-0375 install/run-bin methods over the
   same `runtime`/`fs` Worker. A valid backend paired with any mismatched
   protocol rejects `NotImplementedError('sandbox.toolchain.worker')` and
   terminates that Worker; it is never ignored or later admitted. The authority
   is generic: install the exact project manifest, then run any admitted
   installed `node_modules/.bin` path to completion. SDK/runtime/control-plane,
   package and distribution code never branches on Vite identity, version,
   callbacks, paths, types or lifecycle.
4. The immutable report contains exactly these no-COI feature outcomes:
   `fs`, `npm.install`, `node_modules.bin`, `child_process.spawn.stdio` working;
   `child_process.spawn`, `worker_threads.Worker`, `os.parallelism`
   degraded with explicit warnings (`os.parallelism.value=1`); and
   `child_process.execSync`, `toolchain.threaded-wasm`, `toolchain.dev-hmr`
   throwing with named `NotImplementedError` features. It is recursively
   frozen with `schemaVersion:1`, tier `shared-memory-free` and the listed row
   order; warning strings are the exact strings pinned by the RED carrier.
5. Two same-realm spawns warn exactly once, both children retain landed
   console→stdout/stderr pipe behavior, and both settle in order.
   `worker_threads.Worker` retains its own once-only same-realm warning.
   `os.cpus().length===availableParallelism()===1`. `execSync` throws
   `NotImplementedError` with `feature==='child_process.execSync'`.
6. From the frozen project manifest, the real npm-client installs every exact
   dependency version and the admitted `esbuild-wasm@0.28.0` runtime. The
   executed entry is exactly `/project/node_modules/.bin/vite`, args exactly
   `['build']`, exit exactly 0, with exactly one `2180 modules transformed`
   line and no curated/deep-import execution path.
7. The live no-COI and live COI products receive byte-identical project files
   and marker. Their complete normalized `dist/` relative-path sets are equal;
   every paired file has equal length, equal bytes and equal SHA-256. The JS
   contains the marker exactly twice, matching the frozen source's two sites;
   equality is not count-only or filename-only.
8. A real `vite@8.0.16` install followed by its installed `.bin/vite build` in
   the no-COI sandbox reaches the realm-local shared-memory boundary and rejects
   with `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, and a
   message naming shared WebAssembly memory, COI and SharedArrayBuffer. It writes
   no successful `dist/` claim. Vite/Rolldown identity is fixture provenance,
   never rejection policy: a Vite-8-named installed bin that makes no shared-
   memory request runs normally. Direct guest construction of shared
   `WebAssembly.Memory` rejects with the same feature, while non-shared memory
   still constructs. WebIDL-truthy `shared:1` and `shared:'yes'` reject beside
   own/inherited/accessor literal-true descriptors through REPL, CJS, ESM and
   an installed bin; non-shared native constructor/prototype identity stays.
9. A separate real `nanoid@3.3.18` exact manifest installs and its arbitrary
   admitted `.bin/nanoid --size 7` exits 0 with one seven-character ID, independent
   of Vite. Toolchain input is validated once before mutation. A malformed cwd/bin/args
   rejects loudly; a second install/run overlapping one admitted operation
   rejects immediately as `SandboxToolchainBusyError` rather than racing or
   queuing. Dispose/Worker death rejects the admitted promise; none hangs.
10. `pnpm test:no-coi` is a committed Playwright Chromium lane with its own
    headerless server config/port and CI job. It runs the public SDK path and
    live COI oracle; it is never a route-intercept header simulation and never
    boots the Playground app no-COI.

### Pre-demotion Parity cases (verbatim, descriptor-evaluation split)

1. Current COI product vs no-COI toolchain Worker: one project/dependency
   digest, exact installed versions, real `.bin/vite`, exit/module count, full
   `dist` paths+bytes+SHA. Artifact: C148-BUILD establishes both current
   compositions; `pnpm test:no-coi -g "build parity.*designed RED"` is the
   committed differential and current-tree RED.
2. Host document lifecycle: raw response headers + continuous page-realm
   sampling + stable time origin/opener/subresource, including round-trip and
   image reload while admitted install/run calls wait at held network
   boundaries. Artifact: `pnpm test:no-coi -g "host stays interactive while
   admitted install and run wait"` is a pre-fix green preservation carrier;
   the full build carrier repeats controls around each phase.
3. No-COI Node surfaces: spawn stdio/warn cardinality, worker_threads warning,
   CPU count and execSync feature. Artifact: Node v24.16.0 behavior is the
   external semantic baseline where applicable; the same real sandbox Worker
   carrier `pnpm test:no-coi -g "capability.*designed RED"` is the RED target.
4. Threaded-WASM boundary: exact installed `vite@8.0.16` reaches the generic
   realm-local shared-memory rejection; an identity-equivalent non-threaded bin
   and exact real `nanoid@3.3.18` bin run normally. Direct shared/non-shared
   `WebAssembly.Memory` includes WebIDL-truthy number/string descriptors across
   all four guest entry forms. Artifact: current COI product proof is
   `tests/browser-unit/esbuild-vite-contract.spec.ts`; no-COI RED target is
   `pnpm test:no-coi -g "threaded-WASM guard covers real installed bin"`.
5. Default COI admission remains loud; generic createSandbox no-COI eval/fs
   keeps working when explicitly allowed; valid-backend protocol mismatch
   terminates through both public SDK and host-controller carriers. Artifact:
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "valid backend but mismatched
   protocol|public admission rejects" --reporter=dot` and the no-COI
   preservation carrier.
6. Network/admission inheritance: bounded registry reads, required fetch
   failures, corrupt registry-twin bytes and concurrent same-key acquisition stay
   loud/deduplicated. Artifact: focused npm-client fault command recorded in
   Evidence C148-NPM below; the SDK layer adds no cache/retry authority.

## Challenge

challenge: 2026-08-28 — 1 problem
- Cheaper-route question the epic itself recorded is unsettled before the biggest slice: map.md §Open questions says a coi-serviceworker header-faking shim probe (minimal static page + SAB probe, near-zero cost) could deliver full COI on GH-Pages-class hosting and 'collapse part of this tier's hosting value', yet build-loop — the composition + gate + report + CI lane centerpiece — carries no ordering requirement to run that probe first, so the epic's largest investment lands while the cheap experiment that sizes its value share stays unrun.

<!-- Post-challenge edit: the shim probe is now a hard PICKUP prerequisite of this slice
     (map item 4); a value-collapsing probe result is a re-fit trigger. -->

Disposition: closed before this PICKUP. The 2026-08-31 probe says the shim
works, but the user-owned discriminator is now frozen goal I9: it changes the
whole host document's policy and requires reload. `map.md` has empty fog and
records the route out of scope; no premise problem remains open here.

## User scenario

An existing app opens its ordinary same-origin SDK page from an opener. The
page response has no COOP/COEP. It explicitly calls
`createSandbox({requireCrossOriginIsolation:false,
toolchain:{workerUrl:toolchainWorkerUrl}})`,
writes the canonical react-class project, installs from the configured registry,
and runs `/project/node_modules/.bin/vite build`. It reads the complete `dist/`
tree through the same sandbox and gets the exact bytes the current COI product
emits for the identical project. The app document, opener and a cross-origin
image from a second loopback origin that needs no CORS/CORP keep their original
behavior throughout.

## Reference contract

- Browser/product oracle: C148-BUILD above plus the frozen live scenario from
  `tools/perf/child-fs/scenario.mjs`: exact Vite `7.3.6`, React `19.2.8`,
  React DOM `19.2.8`, Gravity UI `7.48.1`, Gravity icons `2.22.0`, date-fns
  `4.4.0` (Express remains the existing scenario's non-build preservation
  dependency). The Contract+RED carrier runs both products with one marker.
- Vite/bin authority: ADR-0137/0174 — installed `node_modules/.bin/vite` and
  `runNodeEntry(..., bin:true)`, never a curated Vite callback.
- Esbuild authority: ADR-0316 — registry-attested `esbuild-wasm@0.28.0`; no
  preview1/vendored second provider.
- Public composition: ADR-0071/0131/0375 — explicit host Worker URL, one Worker
  VFS authority, narrow install/run-bin control plane.
- Platform boundary: headerless Chrome exposes no SharedArrayBuffer. Vite 8's
  installed Rolldown WASI binding needs pthread shared memory; the no-COI
  outcome is the named `toolchain.threaded-wasm` error, not a wasm crash.

## Acceptance

1. A navigation response served by the dedicated no-COI Vite config has no
   COOP/COEP. Before sandbox boot, during install, during build and after build,
   the same document/time-origin reports `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'`; no bootstrap reload occurs.
2. The host is opened from an existing same-origin app. Its live
   `window.opener` message round-trip and a no-CORS/no-CORP image from a second
   headerless loopback origin work before/during/after exactly as at entry.
   Both complete while an install and a run-bin operation remain admitted at
   a held real network boundary; overlap proves admission, releasing the
   boundary completes the original operation.
3. `createSandbox` admits no-COI only through the explicit existing
   `requireCrossOriginIsolation:false`; default admission still throws
   `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
   before returning and exposes the ADR-0375 install/run-bin methods over the
   same `runtime`/`fs` Worker. A valid backend paired with any mismatched
   protocol rejects `NotImplementedError('sandbox.toolchain.worker')` and
   terminates that Worker; it is never ignored or later admitted. The authority
   is generic: install the exact project manifest, then run any admitted
   installed `node_modules/.bin` path to completion. SDK/runtime/control-plane,
   package and distribution code never branches on Vite identity, version,
   callbacks, paths, types or lifecycle.
4. The immutable report contains exactly these no-COI feature outcomes:
   `fs`, `npm.install`, `node_modules.bin`, `child_process.spawn.stdio` working;
   `child_process.spawn`, `worker_threads.Worker`, `os.parallelism`
   degraded with explicit warnings (`os.parallelism.value=1`); and
   `child_process.execSync`, `toolchain.threaded-wasm`, `toolchain.dev-hmr`
   throwing with named `NotImplementedError` features. It is recursively
   frozen with `schemaVersion:1`, tier `shared-memory-free` and the listed row
   order; warning strings are the exact strings pinned by the RED carrier.
5. Two same-realm spawns warn exactly once, both children retain landed
   console→stdout/stderr pipe behavior, and both settle in order.
   `worker_threads.Worker` retains its own once-only same-realm warning.
   `os.cpus().length===availableParallelism()===1`. `execSync` throws
   `NotImplementedError` with `feature==='child_process.execSync'`.
6. From the frozen project manifest, the real npm-client installs every exact
   dependency version and the admitted `esbuild-wasm@0.28.0` runtime. The
   executed entry is exactly `/project/node_modules/.bin/vite`, args exactly
   `['build']`, exit exactly 0, with exactly one `2180 modules transformed`
   line and no curated/deep-import execution path.
7. The live no-COI and live COI products receive byte-identical project files
   and marker. Their complete normalized `dist/` relative-path sets are equal;
   every paired file has equal length, equal bytes and equal SHA-256. The JS
   contains the marker exactly twice, matching the frozen source's two sites;
   equality is not count-only or filename-only.
8. A real `vite@8.0.16` install followed by its installed `.bin/vite build` in
   the no-COI sandbox reaches the realm-local shared-memory boundary and rejects
   with `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, and a
   message naming shared WebAssembly memory, COI and SharedArrayBuffer. It writes
   no successful `dist/` claim. Vite/Rolldown identity is fixture provenance,
   never rejection policy: a Vite-8-named installed bin that makes no shared-
   memory request runs normally. Direct guest construction of shared
   `WebAssembly.Memory` rejects with the same feature, while non-shared memory
   still constructs and retains native constructor/prototype identity. The
   certified runtime-js child proves native descriptor count/order, the stateful
   false→true outcome and package-generic REPL/CJS/ESM/installed-bin siblings;
   this item consumes that proof for the live public-SDK Vite 8 boundary.
9. A separate real `nanoid@3.3.18` exact manifest installs and its arbitrary
   admitted `.bin/nanoid --size 7` exits 0 with one seven-character ID, independent
   of Vite. Toolchain input is validated once before mutation. A malformed cwd/bin/args
   rejects loudly; a second install/run overlapping one admitted operation
   rejects immediately as `SandboxToolchainBusyError` rather than racing or
   queuing. Dispose/Worker death rejects the admitted promise; none hangs.
10. `pnpm test:no-coi` is a committed Playwright Chromium lane with its own
    headerless server config/port and CI job. It runs the public SDK path and
    live COI oracle; it is never a route-intercept header simulation and never
    boots the Playground app no-COI.

## Parity cases

1. Current COI product vs no-COI toolchain Worker: one project/dependency
   digest, exact installed versions, real `.bin/vite`, exit/module count, full
   `dist` paths+bytes+SHA. Artifact: C148-BUILD establishes both current
   compositions; `pnpm test:no-coi -g "build parity.*designed RED"` is the
   committed differential and current-tree RED.
2. Host document lifecycle: raw response headers + continuous page-realm
   sampling + stable time origin/opener/subresource, including round-trip and
   image reload while admitted install/run calls wait at held network
   boundaries. Artifact: `pnpm test:no-coi -g "host stays interactive while
   admitted install and run wait"` is a pre-fix green preservation carrier;
   the full build carrier repeats controls around each phase.
3. No-COI Node surfaces: spawn stdio/warn cardinality, worker_threads warning,
   CPU count and execSync feature. Artifact: Node v24.16.0 behavior is the
   external semantic baseline where applicable; the same real sandbox Worker
   carrier `pnpm test:no-coi -g "capability.*designed RED"` is the RED target.
4. Threaded-WASM boundary: exact installed `vite@8.0.16` reaches the generic
   realm-local shared-memory rejection; an identity-equivalent non-threaded bin
   and exact real `nanoid@3.3.18` bin run normally. The certified
   `runtime-js/sandbox-toolchain-memory-descriptor-evaluation` child proves the
   native count/order/stateful differential and all four package-generic guest
   entries. This item retains their live Vite 8 integration. Artifact: current
   COI product proof is `tests/browser-unit/esbuild-vite-contract.spec.ts`;
   no-COI integration target is `pnpm test:no-coi -g "threaded-WASM guard
   covers real installed bin"`.
5. Default COI admission remains loud; generic createSandbox no-COI eval/fs
   keeps working when explicitly allowed; valid-backend protocol mismatch
   terminates through both public SDK and host-controller carriers. Artifact:
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "valid backend but mismatched
   protocol|public admission rejects" --reporter=dot` and the no-COI
   preservation carrier.
6. Network/admission inheritance: bounded registry reads, required fetch
   failures, corrupt registry-twin bytes and concurrent same-key acquisition stay
   loud/deduplicated. Artifact: focused npm-client fault command recorded in
   Evidence C148-NPM below; the SDK layer adds no cache/retry authority.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` + `provenance-lie` × no-COI/toolchain admission and report | explicit opt-in + exact report; default remains COI throw; valid-backend protocol mismatch named + Worker terminated | Acceptance 3-4; Evidence R5-HANDSHAKE; no-COI preservation + capability RED |
| `corrupt-input` + `observable-order` × install/run-bin request | exact fields validated before VFS/process mutation; arbitrary admitted bin identity does not change policy; ordered output precedes one terminal result | Acceptance 3, 5-6, 9; capability/build/generic-bin carriers |
| `unbounded-read` + `poisoned-cache` + `provenance-lie` × registry-twin acquisition | inherited bounded fetch + exact integrity/admission; failure rejects, no adapter success | Evidence C148-NPM; Acceptance 6, 9 |
| `concurrent-same-key` × realm-global install/run | one admitted operation; overlap loud `SandboxToolchainBusyError`; no hidden FIFO/lock | ADR-0375; `toolchain overlap` designed RED |
| Worker peer death × admitted toolchain request | every pending request rejects `WorkerTerminated`/crash signal; never hangs or claims applied | `toolchain disposal` designed RED; MessagePort failure model |
| `false-fallback` × threaded WASM | real Vite 8 reaches the generic named boundary; an identity-equivalent bin without a shared-memory request runs; the certified child proves native-order descriptor conversion and no stateful shared-memory success | Acceptance/Parity 8/4; descriptor-evaluation child + R6-IDENTITY; live Vite 8 integration target |
| `sibling-drift` + `frozen-assumption` + `lossy-aggregate` × COI/no-COI build | live twin products, one frozen scenario/marker, exact path+byte+SHA equality | Acceptance/Parity 6-7/1; build differential RED |
| `observable-order` × host lifecycle | opener round-trip + image reload complete while install/run stay admitted at held network boundaries, then release completes them; stable time origin proves no reload | Acceptance/Parity 1-2/2; Evidence R5-ORDER; preservation control |

Evidence C148-NPM (Node 24.16.0, Vitest 2.1.9):

```sh
pnpm exec vitest run --project unit \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts \
  packages/workbench/src/workers/owner-package-runtime-bindings.contract.test.ts \
  packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts --reporter=dot
# 3 files passed; 51 tests passed
```

Evidence R5-HANDSHAKE (product `6ba50d605`, Node 24.16.0, Vitest 2.1.9):

```sh
pnpm exec vitest run --project unit \
  packages/rifty/src/sandbox.test.ts packages/runtime-js/src/host.test.ts \
  -t "valid backend but mismatched protocol|public admission rejects" --reporter=dot
# 2 files passed; 2 tests passed; both reject sandbox.toolchain.worker + terminate
```

Evidence R5-REALM (product `6ba50d605`, Chrome 148.0.7778.96, Playwright 1.60.0):

```sh
pnpm test:no-coi -g \
  "threaded-WASM guard covers real installed bin, CJS, ESM and REPL descriptors"
# RED: 1 failed; shared:1 and shared:'yes' returned native TypeError, not
# NotImplementedError(toolchain.threaded-wasm), in REPL/CJS/ESM/installed-bin
```

Evidence R5-ORDER (product `6ba50d605`, Chrome 148.0.7778.96, Playwright 1.60.0):

```sh
pnpm test:no-coi -g \
  "host stays interactive while admitted install and run wait at network boundaries"
# 1 passed; BusyError proved admission, opener/image completed before release,
# then both original operations completed
```

Evidence R6-IDENTITY (current-tree expected RED, Chrome 148.0.7778.96,
Playwright 1.60.0):

```sh
pnpm test:no-coi -g "installed-bin admission ignores Vite identity"
# RED before implementation: plain Vite-8-named fixture bin rejects as
# toolchain.threaded-wasm despite making no shared-memory request.
```

Evidence R5-PACKED (product `2f1063608`, Node 24.16.0, Vite 5.4.21):

```sh
pnpm test:packed-consumer
# RED: real @riftydev/sdk + @riftydev/workbench dependency-closure tarballs,
# offline npm install and typecheck passed; fixture Vite build failed:
# Missing "./internal" specifier in "@riftydev/runtime-js" package
```

## Out of scope

- Native-order `WebAssembly.Memory` descriptor evaluation, stateful getter
  safety and the REPL/CJS/ESM/installed-bin sibling sweep remain the certified
  predecessor's scope, outside this build-loop review boundary.
- Vite dev/HMR, SW preview binding, restart/death event and pending-write boot
  marker remain `distribution/no-coi-dev-hmr-restore`, blocked by this unit.
  The report says `toolchain.dev-hmr` throwing until that child lands.
- `sandbox.exec()` streaming, shell grammar, stdin, cancellation and normalized
  preview URL remain `distribution/public-api-ai-agent-exec-preview`.
- `spawnSync`/execSync implementation, kernel ring-less spawn, real parallel
  worker_threads and arbitrary threaded-WASM emulation remain out. Gaps stay
  report-visible or named throws.
- No Playground app no-COI mode, no SW-delivered COI, no page reload, no header
  mutation, no third-party iframe tier.
- No SDK/runtime/control-plane/package/distribution coupling to Vite identity,
  version, callbacks, paths, types or lifecycle. Vite 7 remains only the live
  representative oracle; Vite 8 only the named threaded-WASM fixture.
- No dev/HMR acceptance, restart, forced-kill durability or workspace journal
  is smuggled into this build-only unit.

## Decisions

ready-verdict: 2026-09-01 — Contract+RED @ ead27000f

ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2

review: checkpoints — runtime/network/parity public SDK slice.

- No user-owned fork/fog remains: frozen I1/I2/I3/I7/I8/I9 and the recorded
  user decisions fix the tier, warning shape, CPU value, host posture and loud
  boundaries. API/protocol placement was agent-owned and is settled by
  ADR-0375.
- Challenge blocker closed: the SW-COI probe ran and the frozen user decision
  rejects it by I9; the stale draft comment is superseded by the disposition
  above.
- Expected RED batch: capability/degradation; real build differential;
  threaded-WASM boundary; overlap; disposal settlement. Host/default-admission
  and live COI oracle are green preservation controls.
- No production implementation has started. Committed RED imports public SDK
  code and drives real Chromium, Workers, npm tarballs, installed bins and the
  current COI product; only network stall/image endpoints are external-boundary
  fixtures.
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- Re-cut expected batch: WebIDL-truthy shared descriptors are RED across four
  real guest entries; public/host protocol mismatch and admitted-operation
  host interactivity are discriminating pre-fix GREEN preservation carriers.
- No re-cut production edit started. The only observed product failure is the
  realm-scoped truthy shared-memory guard; protocol admission already rejects
  and terminates, and host lifecycle already remains interactive.
- Split resolution: packed-only obligation moved to
  the packed-surface predecessor, now landed at `0a2e64422`; this item is
  unblocked and stays draft until its user-scope recompile. Checkpoint attempt
  lineage remains here and was copied to the split successor.
- Recompile after packed predecessor: user authority is exact-manifest install
  plus arbitrary admitted installed-bin execution. Vite 7 only represents the
  class; Vite 8 only exercises the actual threaded-WASM boundary. Expected RED:
  identity-decoy bin and WebIDL-truthy shared descriptors. Real nanoid bin,
  protocol mismatch and host interactivity are GREEN preservation controls.
- No post-packed production edit started before this Contract+RED recompile.
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- Final review convergence: find 1 blocker, fresh tail 0 new blockers,
  adjudication HOLDS. Callable WebIDL object descriptors bypassed the realm
  guard; one in-place fix/proof batch follows.
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Final verify: prior callable blocker closed; 1 new blocker, concerns 0.
  Convergence valve 1→1 stops this unit. Bounded cause projection reads a
  ninth `Error.cause` after its declared eight-link limit; actual getter probe
  threw `ninth cause read`. Fault class `observable-order`; missing RED is a
  depth-eight boundary with zero reads of the next getter. No fix started.
- Split resolution: user-authorized `runtime-js/bounded-not-implemented-cause-projection`
  succeeds this unit only for ADR-0375 Decision 5's generic bounded projection.
  All checkpoint lineage carries to it; this item's pre-demotion Acceptance
  and Parity remain verbatim above. The child landed Final+GREEN at
  `40ded47585bd04c62b2407210d515ed4f1f65ae1`; build-loop is draft and
  unblocked. No same-unit round N+1 and no weakened user behavior.
- Post-split PICKUP revalidation: the child is certified and outside this
  review boundary. Against pre-demotion tree `99325ca4e`, frozen/current
  Acceptance are byte-identical (4781 bytes,
  `fecc6058ea588189c6363c879408925c5a871d65d5d55e62c5927aff7dec4991`),
  Parity byte-identical (2405 bytes,
  `c8e93b122e008d05e3db726afcc5847eb9d4a8a7848ad08d0b536164168b2ab5`),
  and Fault behavior byte-identical (830 bytes,
  `080e19d6bfa2d09f622773a2a3bb98a897d36d61a4e5b3339e3f9c901c2d909d`).
  No clause, carrier, test or product code changed; Vite remains fixture-only
  and product code remains Vite-free.
- Post-split recompile band: 0–0 new expected REDs. Original 5–6 and
  post-packed 2–3 bands, all predecessor Contract/Final lineage and certified
  child carry. Status recompiled `draft`→`ready`; a fresh external
  Contract+RED checkpoint is required before implementation resumes. Existing
  `ready-verdict:` lines are predecessor lineage, not that fresh verdict.

ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d

- Fresh revalidation: 38/38 coverage; 0 blockers; unit residuals empty.
  Original bands/RED lineage carry; the certified child is outside scope;
  Final continuation not started.
- Comparison artifact correction: the earlier 4781/830 labels called JavaScript
  `String.length` body-slice counts bytes, and the 830 slice stopped before the
  Fault evidence. They are non-authoritative transcript. Authority is exact
  equality of each full anchored section from its `##` heading to the next
  `##` heading in pre-split `99325ca4e` and current: Acceptance 4795 characters,
  4797 UTF-8 bytes,
  `e9dc28528f17733a984fcd5d9ae631b3041708daa571a836d2908496f8e09780`;
  Parity 2421 characters/UTF-8 bytes,
  `6783596ad9483a2ebb781d44758df9f6105f5b743ec61d83e26908d386142caf`;
  full Fault 4135 characters, 4144 UTF-8 bytes,
  `63746dfb9507ca39fe5bf06c17e489adcaa9269d1f00d991aec6778f06a5f2cc`.
  All three historical/current comparisons are exact; the separately headed
  frozen bounded-split Acceptance/Parity bodies remain exact too.
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Final continuation: `pnpm pr:check` PASS; no-COI Chromium 14/14 PASS;
  34/38 coverage pass and four weak rows all map to B1; one unit residual.
  Native Node v24.16.0 and Chrome 148 read descriptor
  initial→maximum→shared once. The real headerless public-SDK Worker reads
  shared→initial→maximum→shared; a stateful false→true `shared` getter
  creates SharedArrayBuffer while non-COI instead of native non-shared/named
  guard. Fault `observable-order`/`false-fallback`; missing RED is a same-realm
  differential for count/order/stateful getter, with sibling sweep across
  REPL/CJS/ESM/installed-bin.
- Convergence valve 1→1; no fix, RED, next review round, dev-HMR or rechart
  started.
- Split resolution: user-authorized
  `runtime-js/sandbox-toolchain-memory-descriptor-evaluation` succeeds this
  unit only for the package-generic native count/order/stateful descriptor
  defect at the existing runtime-js realm seam. All Contract/Final lineage and
  the exact 1→1 stop carry to it. The child landed Final+GREEN PASS at
  `dce86792d` on tree `b1e0244ad432b5813bd9c2ff3a9e98ccf2cc7153`; this item
  stays draft but unblocked. No same-unit round N+1 and no weakened goal behavior.
- The pre-demotion Acceptance and Parity are copied verbatim above. Active
  Acceptance 8, Parity 4 and the threaded-WASM fault row delegate only that
  internal predecessor; live Vite 8 integration remains here.
- Body proof against stopped HEAD `7a1e95231`: Acceptance
  `fecc6058ea588189c6363c879408925c5a871d65d5d55e62c5927aff7dec4991`;
  Parity `c8e93b122e008d05e3db726afcc5847eb9d4a8a7848ad08d0b536164168b2ab5`.
- No production edit, RED, implementation checkpoint or dev-HMR work started
  during this RECHART.
