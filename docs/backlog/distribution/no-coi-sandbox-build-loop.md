---
area: distribution
status: draft
title: no-COI installed-bin build parity through the generic sandbox authority
created: 2026-08-28
epic: no-coi-sandbox-tier
blocked_by: [distribution/no-coi-sandbox-package-install]
why: the generic public no-COI sandbox can run installed bins, but Final review did not prove request-identical Vite 7/8 decoys, exact installed Vite 8/nanoid fixture provenance, or the exact full Vite 7 module line before claiming byte-identical build output
user_story: As an agent platform, I want an arbitrary installed bin to build my project in a headerless sandbox and return the exact same dist bytes as the COI product, while a real shared-memory request fails by name and package identity never selects policy
sources: [ADR-0137, ADR-0174, ADR-0316, ADR-0376, docs/backlog/distribution/reference/no-coi-build-spike-record.md, distribution/no-coi-public-toolchain-admission, distribution/no-coi-sandbox-package-install]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts, tools/perf/child-fs/scenario.mjs]
---

## Context

The durable spike proved the loop, but its worker deep-imported Workbench
internals and installed globals by hand. Current source still has only the
generic `createSandbox` eval/fs protocol; the real install + adapter + bin
composition lives in Worker-only Workbench code. ADR-0376 selects the narrow
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

Recompiled resolution: ADR-0376 grafts ADR-0371's installed registry-twin
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

## Discovered fork — 2026-09-02 Final invariant decomposition

Final+GREEN adjudication left 15 HOLDS and fired convergence on counted rounds
`1→15`. Draft PR 294 already fixed the PR-body band row; binding stop
`e5347179f` therefore leaves 14 current HOLDS. User authorized an invariant-
closed re-cut, never another same-unit review round.

Five children are minimal: I1, I2, I3 and I9 are distinct frozen observable
invariants, while one necessary Worker operation-lifecycle invariant is shared
by I2/I3 and cannot be duplicated into either. This item remains the natural
lineage carrier and narrows to I3. Four sibling drafts take the other bands.

| current HOLD | child owner |
|---|---|
| any protocol mismatch and later-frame non-admission | `distribution/no-coi-public-toolchain-admission` (I1) |
| public Worker `vfs.backend` projection | `distribution/no-coi-public-toolchain-admission` (I1) |
| exactly one Worker/VFS/runtime | `distribution/no-coi-public-toolchain-admission` (I1) |
| literal-false-only generic admission | `distribution/no-coi-public-toolchain-admission` (I1) |
| frozen npm bounds/required-failure/same-key-concurrency evidence | `distribution/no-coi-sandbox-package-install` (I2) |
| overlap zero rejected-operation dispatch/effects | `distribution/no-coi-toolchain-operation-lifecycle` (shared I2/I3) |
| `runBin` peer-end settlement matrix | `distribution/no-coi-toolchain-operation-lifecycle` (shared I2/I3) |
| post-validation caller mutation snapshot | `distribution/no-coi-toolchain-operation-lifecycle` (shared I2/I3) |
| exact stdout/stderr order then one terminal result | `distribution/no-coi-toolchain-operation-lifecycle` (shared I2/I3) |
| current Class-kill sweep/forcing-constraint authority | `distribution/no-coi-toolchain-operation-lifecycle` (shared I2/I3) |
| request-identical Vite 7/8 fixture decoys | this item (I3) |
| exact installed Vite 8/nanoid fixture identities | this item (I3) |
| exact full `✓ 2180 modules transformed.` line | this item (I3) |
| no-CORS/no-CORP image request/response provenance | `distribution/no-coi-host-posture-preservation` (I9) |

I5 and I7 implementation already landed; the I1 child retains I7's report and
real-realm truth obligation. The committed lane remains shared proof, with
full I8 closing only after dev-HMR. Vite 7/8 are proof fixtures only; no
product or infrastructure authority may depend on Vite identity, version,
path, callback, type or lifecycle.

### Pre-demotion Acceptance (verbatim, Final invariant decomposition)

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

### Pre-demotion Parity cases (verbatim, Final invariant decomposition)

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
   no-COI in-unit integration is `pnpm test:no-coi -g "installed-bin admission
   ignores Vite identity|exact nanoid manifest|threaded-WASM: Vite 8 Rolldown
   fails at named boundary" --reporter=line` — Node 24.16.0, Playwright 1.60.0,
   Chrome 148.0.7778.96; lines 929/985/1557, 3/3 passed.
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

challenge: 2026-09-02 — 2 problems
- Project direction: Acceptance/Parity compare only no-COI with the sibling COI product; without a real Node Vite 7 oracle, equal logs/artifacts can preserve shared drift and do not prove Node-faithful build behavior.
- User impact remains unsized: the goal narrows value to existing own-origin apps unwilling to change headers and excludes greenfield sites served by cheaper SW isolation, but provides no evidence for the size or frequency of that residual audience relative to this slice’s multi-fixture proof cost.

Disposition:

- P1 answered by adding a pinned real Node Vite 7 proof run for the same
  project/dependency/marker input. The live Node artifact is the external
  oracle; COI/no-COI equality alone cannot claim Node fidelity. Vite remains a
  test fixture and contributes no product/infrastructure policy.
- P2 retained as the frozen goal's user-accepted premise risk (2026-08-31):
  adopter share remains unsized, but the existing-app posture is the explicit
  chosen audience and cannot be amended during RECHART.

## User scenario

After admission, lifecycle and exact-manifest install are certified, an agent
runs an arbitrary admitted installed bin against project bytes in the same
Worker VFS. The representative Vite 7 fixture builds successfully; the agent
reads the complete `dist/` tree and gets the exact bytes the live COI product
emits for the identical project. Identity-equivalent fixture bins prove that
Vite name/version/path/argv cannot select behavior. A real Vite 8 fixture
reaches the already-certified generic shared-memory boundary by what its bytes
do, not by what package it is.

## Reference contract

- Browser/product proof fixture: C148-BUILD above plus the frozen live scenario from
  `tools/perf/child-fs/scenario.mjs`: exact Vite `7.3.6`, React `19.2.8`,
  React DOM `19.2.8`, Gravity UI `7.48.1`, Gravity icons `2.22.0`, date-fns
  `4.4.0` (Express remains the existing scenario's non-build preservation
  dependency). The differential runs both products with one marker. None of
  these identities is product or infrastructure authority.
- External oracle prerequisite: the same frozen files, manifest, lock/input
  digest and marker run under pinned real Node 24.16.0 with Vite 7.3.6. Its
  normalized output and complete `dist` bytes are captured before this draft
  compiles; shared COI/no-COI drift cannot define success.
- Installed-bin authority: ADR-0137/0174 — the caller's admitted installed
  `node_modules/.bin/*` launcher and `runNodeEntry(..., bin:true)`, never a
  curated package callback.
- Esbuild authority: ADR-0316 — registry-attested `esbuild-wasm@0.28.0`; no
  preview1/vendored second provider.
- Certified prerequisites: public admission/one Worker, shared operation
  lifecycle and exact-manifest install are owned by the three `blocked_by`
  chain entries and consumed here without reopening them.
- Platform boundary: headerless Chrome exposes no SharedArrayBuffer. Vite 8's
  installed Rolldown WASI binding needs pthread shared memory; the no-COI
  outcome is the already-certified generic `toolchain.threaded-wasm` error,
  not a wasm crash or identity rule.

## Acceptance

1. Using the certified exact installed tree, the public no-COI sandbox invokes
   the caller-selected `/project/node_modules/.bin/vite` with args exactly
   `['build']`. The Vite 7 proof fixture exits 0 through the generic installed-
   bin path, with no curated callback/deep import. Its normalized output
   contains the exact full line `✓ 2180 modules transformed.` once; prefixed
   counts such as `12180` and substring-only matches fail.
2. Pinned real Node 24.16.0/Vite 7.3.6, the live no-COI product and the live
   COI product receive one byte-identical frozen project/dependency digest and
   marker. Their complete normalized `dist/` relative-path sets are equal;
   every triplet has equal length, bytes and SHA-256. The JS contains the
   marker exactly twice, matching the frozen source's two sites; sibling
   product equality alone is insufficient.
3. Request-identical Vite 7 and Vite 8 decoy fixtures use the same public
   install/run request fields, package name/version, installed bin path and
   `['build']` argv as their real counterparts; only registry-served fixture
   bytes differ. A non-threaded decoy runs normally and its own output/artifact
   wins. No product/infrastructure branch may select preparation, rejection or
   output by Vite identity, version, path, callback, type or lifecycle.
4. Before execution, the carrier reads exact installed `vite@8.0.16` and
   `nanoid@3.3.18` package manifests and declared bin targets from the Worker
   VFS. The real nanoid installed bin exits 0 with one seven-character id.
   These exact identities are fixture provenance only, never authority.
5. The real installed Vite 8 fixture reaches the certified realm-local shared-
   memory boundary and rejects with
   `NotImplementedError('toolchain.threaded-wasm')` before successful `dist/`.
   The identity-equivalent non-threaded decoy in Acceptance 3 proves the
   rejection follows actual shared-memory behavior. Descriptor/cause semantics
   remain certified predecessor scope.
6. The generic lifecycle predecessor supplies immutable requests, exact
   stream→single-terminal order and terminal settlement. This child consumes
   those facts and adds no Worker, VFS, protocol, busy, queue or lifecycle
   mechanism. The committed Chromium lane is a proof carrier only.

## Parity cases

1. Pinned real Node vs current live COI product vs public no-COI sandbox: one
   project/dependency digest, exact Vite 7 installed-bin request, exact
   normalized module line, exit 0 and complete `dist` paths+bytes+SHA with the
   two-site marker.
2. Request-identity discrimination: real and alternate-byte Vite 7 fixtures
   receive the same install/build request; real and non-threaded Vite 8
   fixtures receive the same install/build request. Fixture bytes alone decide
   output vs shared-memory boundary.
3. Installed provenance: exact Vite 8 and nanoid manifest versions plus bin
   targets are observed before execution; nanoid provides the arbitrary
   non-Vite installed-bin control.
4. Threaded-WASM integration: real Vite 8 reaches the already-certified
   generic boundary, while the request-identical non-threaded decoy runs. The
   certified descriptor and bounded-cause children remain outside this review
   boundary.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` × package/build policy | request-identical Vite 7/8 decoys follow installed bytes, never package identity | Acceptance/Parity 3/2; same-request alternate-byte fixtures |
| `frozen-assumption` × installed-bin fixture identity | exact Vite 8/nanoid manifest version and bin target observed before use | Acceptance/Parity 4/3; Worker-VFS manifest/bin reads |
| `lossy-aggregate` × module output | exact full normalized line once; `12180` and substring mutants fail | Acceptance/Parity 1/1; exact-line carrier |
| `sibling-drift` + `frozen-assumption` + `lossy-aggregate` × Node/COI/no-COI build | pinned live Node plus twin products, one frozen scenario/marker, exact path+byte+SHA equality | Acceptance/Parity 1-2/1; three-way build differential |
| `false-fallback` × threaded WASM | real Vite 8 reaches the generic named boundary; request-identical non-threaded bytes run | Acceptance/Parity 3,5/2,4; certified realm seam + live fixtures |

## Out of scope

- Public admission/report/protocol/one-Worker proof, exact-manifest install,
  request lifecycle/busy/stream settlement and host posture remain their
  named predecessor/sibling contracts; this item consumes without reopening.
- Native `WebAssembly.Memory` descriptor evaluation and bounded cause
  projection remain certified predecessor scope.
- Vite 7/8 identity, version, path, callback, type and lifecycle are fixture
  provenance only. No product/infrastructure authority may depend on them.
- No resident dev/HMR, SW preview binding, restart/death event or pending-write
  marker; `distribution/no-coi-dev-hmr-restore` stays blocked.
- No `sandbox.exec()`, shell grammar, stdin, cancellation, preview URL,
  spawnSync/execSync implementation or threaded-WASM emulation.
- No heartbeat, journal, automatic reconnect/retry, exactly-once recovery,
  hidden retry, queue or crash durability.

## Decisions

ready-verdict: 2026-09-02 — Contract+RED @ 15dbca164

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
- Post-descriptor PICKUP revalidation: Final+GREEN PASS at `dce86792d`, tree
  `b1e0244ad432b5813bd9c2ff3a9e98ccf2cc7153`, is certified and outside this
  review boundary. Acceptance 8, Parity 4 and the threaded-WASM fault row
  consume its package-generic proof; live Vite 8 installed-bin integration
  remains this unit. Only dependency-state wording changed at RECHART; active
  behavior, tests and product code stay exact.
- Current active-section proof at post-RECHART `3b97a484a`, tree
  `852e03966b56cb7355b67e1a5c179af5d38d3e6e`: Acceptance 4874 UTF-8 bytes,
  `6091352eea186fbc67c664f6a82f0cc3e65d17c87d459aa8c117a133517f7c0e`;
  Parity 2530 bytes,
  `a24d7f8f8bcbad3c4405bd84a7d75f105f7f50b8305fc959a0d4473bcd64e095`;
  full Fault 4172 bytes,
  `07ebdcdc1a574209b73ea414c0bc22cdb6e721c496598c27d515ab28d5a6721c`.
  Raw UTF-8 is measured with `sed -n` ranges `536,604`, `605,642`, `643,710`
  piped to `wc -c` / `shasum -a 256`. Sections are unchanged by this PICKUP;
  frozen descriptor-split
  Acceptance/Parity remain verbatim and their stopped-head proof above binds.
- Post-descriptor recompile band: 0–0 new expected REDs. Original 5–6,
  post-packed 2–3 and post-bounded 0–0 bands plus all Contract/Final lineage
  carry. Review remains `checkpoints`; status recompiled `draft`→`ready` and a
  fresh external Contract+RED is required; its verdict is intentionally absent.
- `contract-red: 2026-09-02 — blocker @ 41d63c086`
- Contract+RED find: 1 finding blocker / 1 matching unit residual / 1 concern /
  0 nits; coverage 31 = 30 pass / 1 weak / 0 missing; 2 goal residuals. Fresh
  tail: 0 new blockers / concerns / nits; coverage 34/34 pass; 0 unit and 2 goal
  residuals. Independent adjudication: union 1 → 1 HOLDS / 0 STRETCH / 0 FALSE;
  calibrated `blockers.mjs` exit 1 with 1 blocker / 1 concern / 0 nits.
- HOLDS — Parity 4's declared command selected one synthetic `.bin/memory-probe`
  test and passed instead of running the in-unit real `vite@8.0.16` install +
  installed `.bin/vite` carrier. Executed on Node 24.16.0, Playwright 1.60.0,
  Chrome 148.0.7778.96: `pnpm test:no-coi -g "threaded-WASM guard covers real
  installed bin" --reporter=line` reported `Running 1 test`,
  `tests/no-coi/no-coi-sandbox-build-loop.spec.ts:1037`, `1 passed (7.2s)`;
  the real Vite 8 carrier is at line 1557. Fault `provenance-lie` /
  `sibling-drift`; identity-decoy and nanoid siblings stay pinned, descriptor
  siblings remain certified outside this boundary.
- Valve audit: latest prior exact current-unit Contract verdict is PASS at
  `df3cc811d`; current blocker-round counts `[1]`. No second consecutive
  Contract blocker, no Contract escalation; no two consecutive blocker rounds,
  no convergence valve. No fix, RED, contract/product/test edit or next review
  round started.
- Contract+RED blocker batch on clean `99030e8f8`: `pnpm test:no-coi -g
  "installed-bin admission ignores Vite identity|exact nanoid manifest|threaded-WASM:
  Vite 8 Rolldown fails at named boundary" --reporter=line` reported `Running 3
  tests`; lines 929, 985 and 1557 all ran, `3 passed (16.2s)`. Version probes:
  `node --version` → `v24.16.0`; `pnpm exec playwright --version` → `Version
  1.60.0`; Playwright Chromium `browser.version()` → `148.0.7778.96`.
- The batch corrects only Parity 4 artifact selection. Acceptance/Parity/Fault
  behavior, REDs, product/tests and the certified descriptor carriers remain
  unchanged; the recorded HOLDS is addressed, external verify pending.
- Contract+RED VERIFY PASS on clean `15dbca164`, tree
  `2dafc1593c96f9deb6109075b5fa00a1276cfa6f`: 34/34 coverage pass; 0 blockers /
  0 concerns / 0 nits; unit residuals empty; 2 goal residuals;
  `blockers.mjs` exit 0. Fresh Node 24.16.0 / Playwright 1.60.0 / Chrome
  148.0.7778.96 artifact selected identity-decoy, exact nanoid and real Vite 8
  installed-bin lines 929/985/1557, 3/3 passed. Prior Parity 4 HOLDS closed;
  descriptor carrier remains certified outside scope; Final+GREEN next.
- `final-green: 2026-09-02 — blocker @ c2b13d0f3`
- Final+GREEN reviewed clean tree
  `935862567bf8743e8c559deba01eaf1bf533704a` against certified descriptor BASE
  `dce86792d` / tree `b1e0244ad432b5813bd9c2ff3a9e98ccf2cc7153`.
  Descriptor seam/tests stayed outside coverage; build-loop carriers stayed in
  by role. Fresh `pnpm pr:check` rerun outside the sandbox passed 24/24
  (`test:run` 179.8s, parity 69.3s); the first run failed only sandbox
  TSX/loopback `listen EPERM`.
- Final find: 14 finding blockers / 14 matching unit residuals / 1 concern /
  0 nits; coverage 47 = 13 pass / 29 weak / 5 missing; 1 goal residual. Fresh
  tail: 4 new finding blockers / 3 matching unit residuals / 0 concerns /
  0 nits; coverage 34 = 29 pass / 5 weak / 0 missing; 1 goal residual.
  Independent adjudication: union 18 → 15 HOLDS / 1 STRETCH / 2 FALSE.
  Calibrated union `blockers.mjs` exit 1: 15 blockers / 4 concerns / 0 nits;
  14 surviving residual entries cover the 15 HOLDS; dev-HMR is the sole goal
  residual. Five raw missing rows map to FALSE C12/C13 and remain transcript,
  not surviving blockers.
- HOLDS C1–C5: request-identical Vite 7/8 build identity decoys absent; exact
  installed Vite 8/nanoid identities unobserved; protocol mismatch proves only
  v0; no-CORS/no-CORP image provenance unasserted; public Worker VFS-backend
  projection unpinned.
- HOLDS C7–C11: frozen npm command omits bounds/concurrency carriers; BusyError
  does not prove zero rejected-operation dispatch; peer-end matrix omits
  `runBin`; post-validation input mutation passes; exact stdout/stderr order
  and one terminal frame are unpinned.
- HOLDS C14: ADR-0375 ports realm-global busy coordination without the required
  repo-wide mechanism sweep/forcing-constraint record. Tail HOLDS: module count
  accepts `12180`; successful SDK proof does not pin one Worker/VFS/runtime;
  PR body omits explicit carried build-loop 5–6, 2–3 and post-bounded 0–0 band
  rows; generic `createSandbox` truthiness admits `0`, `''` and `NaN` instead
  of only literal `false`.
- Demoted: C6 public registry-fault crossing is STRETCH; C12/C13 public-type
  demands are FALSE because their earlier landed role is outside this unit.
- Final valve audit: earlier carried blocker verdicts `07d370651`, `bcff49986`
  and `541c4cd6c` have no stored counts. Exact counted lineage is
  `1 @ a909a38a9 → 1 @ 6f86d2e7f` (convergence stop; user-authorized bounded-
  cause split → PASS `40ded4758`), then `1 @ 01465c6ae` (carried 1→1 stop;
  user-authorized descriptor split → PASS `dce86792d`), then
  `15 @ c2b13d0f3`. Latest pair `1→15` is not strictly falling: convergence
  valve fires. No blocker batch, fix, RED, next review, dev-HMR or rechart
  started.
- Final-stop resolution: user-authorized invariant decomposition at binding
  stop `e5347179f`; the already-fixed PR-body band row is removed from the
  current set. Fourteen HOLDS are exhaustively owned by four new siblings plus
  this re-cut; no STRETCH/FALSE demand was restored.
- Demoted `ready`→`draft`. Pre-demotion Acceptance and Parity are copied
  verbatim above from `e5347179f` (Acceptance body 4861 UTF-8 bytes,
  `650b13afa960ac79313177555b60456dc03fa0d9a79c3253b01e8f11cb3fbb99`;
  Parity body 2705 bytes,
  `14c79a94cf9815ede0586c4366dd7f6402017741b187e1684b8205c9b87289f1`).
  Every predecessor verdict and count line remains in this document and is
  copied to each split successor.
- Current ownership is I3 only: request-identical Vite 7/8 fixture decoys,
  exact installed Vite 8/nanoid fixture provenance and the exact full module
  line. Public admission, shared lifecycle, I2 install and I9 host posture are
  reverse-linked siblings; certified descriptor/cause work remains outside.
- Fresh challenge strengthened I3 with a pinned real Node Vite 7 proof; the
  audience-sizing problem remains the frozen goal's accepted premise risk.
- Remaining dependency: `distribution/no-coi-sandbox-package-install`;
  lifecycle landed under ADR-0376. No implementation, RED,
  Contract+RED, Final round, PICKUP or dev-HMR work starts in this RECHART.
- Vite 7/8 remain proof fixtures only. No product/infrastructure authority may
  depend on Vite identity, version, path, callback, type or lifecycle.
