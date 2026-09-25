# worker-threads-handle-keepalive — evidence (PICKUP + Contract+RED, 2026-09-24)

Unit: `docs/backlog/runtime-js/worker-threads-handle-keepalive.md`. Decision: ADR-0446.
BASE `8c899364986d6cde48b71bd4147cf29d8bd0faae`. Oracle host: Node v24.16.0, npm 11.17.0
(macOS arm64). Browser: Playwright 1.60.0 Chromium. Probe scripts are run as
`node <file>` from one directory, under a 10 s `perl -e 'alarm 10; exec @ARGV'`.
Each probe was run at least 3 times, and outputs were identical unless noted.

## Baseline (rifty, BASE)

The goal evidence (`vitest-run-in-browser-evidence.md` §I2/I3) shows that
`node t3.cjs` gives no output and exits 0 at 427 ms. Node prints `got hi true` /
`wexit 0` / `EXIT 0`. The RED run below reproduces this on BASE in real Chromium
and in the production build. Now that ADR-0445 has landed, only
`EXIT 0` prints (§RED).

Code on BASE:

- `worker_threads.ts:105-135`: the constructor takes no keepalive ref
  (`child_process.ts:161` does take one, `refEventLoop()`).
- `:330-336`: `ref()`/`unref()` return `this` and change nothing.
- `:565-566`: `parentPort.ref`/`unref` do nothing.
- `:195`: `serve: true`, marked `TODO(backlog: runtime-js/worker-threads-kernel-run-to-completion-exit)`.
- `node-entry-bootstrap.ts:191-195`: the worker-thread branch runs the entry, then
  calls `proc.exit(proc.exitCode)` only if `exitCode` is truthy. Otherwise the realm
  stays alive until `terminate()`.
- Natural exit calls the reassignable property: `node-entry-bootstrap.ts:189`
  `exit: (...code) => proc.exit(...code)` and `:201` `proc.exit()`.

## Node's Worker reference model (source + probes)

Node v24.16.0 internals, read with `node -e "process.binding('natives')['internal/worker']…"`:

- `internal/worker` line 498:
  `ref() { if (this[kHandle] === null) return; this[kHandle].ref(); this[kPublicPort].ref(); }`.
  `unref()` is the same.
- Line 353: `setupPortReferencing(this[kPublicPort], this, 'message')`.
- Line 444: `[kDispose]()` sets `this[kHandle] = null` and `this[kPublicPort] = null`.
- `internal/worker/io` line 211: `setupPortReferencing(port, eventEmitter, eventName)`
  starts by calling `port.unref()`. It then adds `'newListener'` / `'removeListener'`
  listeners and own `kNewListener` / `kRemoveListener` hooks. When the listener
  count goes 0→1 it calls `port.ref()` and `start`; when it drops to 0 it calls
  `port.unref()`.
- A live Worker has these own symbols: `Symbol(shapeMode), Symbol(kCapture), Symbol(kHandle),
  Symbol(kPort), Symbol(kParentSideStdio), Symbol(kPublicPort), Symbol(kNewListener),
  Symbol(kRemoveListener), Symbol(kLoopStartTime), Symbol(kIsOnline)`.
- `kHandle`'s prototype is `Worker` with `startThread, stopThread, hasRef, ref, unref,
  getResourceLimits, takeHeapSnapshot, loopIdleTime, loopStartTime, getHeapStatistics,
  cpuUsage, startCpuProfile, stopCpuProfile, startHeapProfile, stopHeapProfile`.

Parent probes. `w-late.cjs` is `setTimeout(() => parentPort.postMessage('late'), 700)`.
`p01` adds `on('message')` and `on('exit')`, then `w.unref()` and `process.on('exit')`. The
other probes vary that shape:

```text
p01 unref                               → P|EXIT 0                                   rc 0, 43 ms
p02 unref; ref                          → P|message late / P|wexit 0 / P|EXIT 0       rc 0, 743 ms
p03 unref; then on('message')           → P|message late / P|wexit 0 / P|EXIT 0       rc 0, 744 ms (8/8)
p04 no listeners at all                 → P|EXIT 0 wexit-listeners 0                  rc 0, 744 ms
p06 napi-rs neuter + once/unref/ref/on  → P|EXIT 0                                   rc 0, 32 ms
p07 ref; ref; unref                     → P|EXIT 0                                   rc 0, 32 ms
p08 on('message'); unref                → P|EXIT 0                                   rc 0, 33 ms
p09 neuter kHandle only; unref; on(msg) → P|message late / P|wexit 0 / P|EXIT 0       rc 0
p10 neuter kPublicPort only; unref; ref → P|wexit 0 / P|EXIT 0                        rc 0
p11 unref; once('message') (late1 500 ms, late2 1200 ms) → P|message late1 / P|EXIT 0  rc 0, 546 ms
p05 shape: symbols Symbol(kHandle),Symbol(kPublicPort); own descriptors enumerable/writable/configurable;
    kHandle ref/unref/hasRef functions; kPublicPort instanceof MessagePort, hasRef() false;
    Worker#hasRef undefined; ref/unref own on Worker.prototype, length 0, return undefined;
    inside 'exit': w[kHandle] null, w[kPublicPort] null, ref()/unref() → undefined,
    listenerCount('message') 0, listenerCount('exit') 1
p12 flags [kHandle.hasRef(), kPublicPort.hasRef()]: initial true,false; on(message) true,true;
    unref false,false; ref true,true; removeAllListeners('message') true,false; on again true,true
```

## Unref'd port hold — Node's 'exit' delivery depends on loop timing

The worker (`w-300.cjs`) posts once after 300 ms. The parent calls `unref()`, then
adds `on('message')` and `on('exit')`:

```text
p20 (no other statement)             → P|message late1 / P|wexit 0   (5/5)
p22 (+ top-level console.log start)  → P|start / P|message late1       (5/5; no wexit)
p23 (p20 + exit listener spawning)   → P|message late1 / P|wexit 0   (5/5)
```

When the public port is the only hold, a top-level `console.log` decides whether
the Worker's `'exit'` reaches the parent before it exits. So no carrier puts an
`'exit'` listener on a Worker in that state (`handle-listener-reference.case.ts`).
ADR-0446 §Explicit gaps records that rifty always delivers it.

## napi-rs / emnapi sources (the scenario tree)

The tree is the goal scenario install, copied from the message-port unit's oracle
tree. Versions: vitest 4.1.11, `@rolldown/binding-wasm32-wasi` 1.0.3,
`@emnapi/wasi-threads` 1.2.1, `@emnapi/core` 1.10.0.

- `rolldown-binding.wasi.cjs:62-91` (`onCreateWorker`): runs `new Worker(wasi-worker.mjs)`
  and sets `worker.onmessage` (an expando). It then replaces `ref` on
  `Object.getOwnPropertySymbols(worker).find(s => s.toString().includes("kPublicPort"))`
  and on the `"kHandle"` symbol, and calls `worker.unref()`.
- `wasi-threads.cjs.js:168-169`: `worker.once('message', () => { }); worker.unref();`
  (`preparePool`). `:183`: `worker.ref()` (`loadWasmModuleToAllWorkers`), then
  `:186`/`:190` call `unref`. `:287-297`: `worker.on('message' | 'error' | 'detachedExit')`.
  `:227`, `:264` and `:584` call `unref` too.
- `emnapi-core.cjs.js:409-425`: `_emnapi_worker_ref`/`_unref` call `worker.ref()` /
  `worker.unref()` when those exist.
- Pool Workers are never terminated while the parent runs. In Node, the neutered
  `ref` (p06) is what lets vite and vitest exit.

## Worker side — parentPort reference (probes)

`p14` / `p13` run one Worker per worker script and print `msg:` / `exit:` rows:

```text
w-port-shape: initial=false on=true unref=false ref=true off=false onmessage=true onmessage-null=false
              removeAll('message')=true once=true removeAllListeners()=true returns=undefined,undefined → exit:0
w-once   (once + parent posts a)              → msg:echo:a exit:0
w-unref-port (on + parentPort.unref())        → exit:0
w-remove (off inside the listener)            → msg:echo:a exit:0
w-echo   (on; parent terminate() at +300 ms)  → msg:echo:a exit:1 terminate:1
w-onmessage (onmessage =; terminate)          → msg:echo:a exit:1 terminate:1
w-port-ref-nolistener (ref(); terminate)      → msg:ref=true exit:1
w-port-listener-unref-ref (terminate)         → msg:held exit:1
w-teardown (on; removeAllListeners('message') after 'bye') → never exits: alarm at 10 s (rc 142)
w-exitcode (exitCode = 3; 100 ms timer)       → exit:3
w-exitcall (process.exit(5) in a timer)       → exit:5
w-throw  (top-level throw)                    → error:Error:boom exit:1
w-post-return (two posts, returns)            → msg:first msg:second exit:0
w-proc-exit (process.on('exit') in the worker)→ W|worker-exit-event 0 … exit:0
```

`removeAllListeners('message')` leaves the port referenced. Node's NodeEventTarget
skips its `kRemoveListener` hook there. vitest 4.1.11 relies on this:
`chunks/init-threads.6kl1khcL.js:9-11` has `on: parentPort.on("message", …)`,
`off: parentPort.off(…)` and `teardown: () => parentPort.removeAllListeners("message")`,
and `cli-api.CnMVyzaz.js:3241` (`ThreadsPoolWorker.stop`) does
`await this.thread.terminate()`.

## Natural exit ignores a reassigned `process.exit`

```text
p15 worker: process.on('exit', post) ; process.exit = () => { throw … } ; 50 ms tick
    → msg:tick msg:worker-exit-event:0 exit:0
p16 program: same three statements → P|tick / P|exit-event 0, rc 0
node -e "process.on('exit', (code) => console.log('exit-event', code)); process.exitCode = 4; process.exit = () => { throw new Error('patched process.exit called'); };"
    → exit-event 4, rc 4
```

vitest 4.1.11 `chunks/base.B6Opl8PE.js:108-110` replaces `process.exit` with a
throwing function in every pool worker. The threads pool never restores it; the
forks pool restores it (`init-forks.H5ZuobOQ.js:31`) and is stopped with
`fork.kill()` (`cli-api.CnMVyzaz.js:3179`).

Rifty on BASE (`node -e`, parity `node-cli-eval` harness = the Workbench eval
lifecycle): `tick`, then stderr `Error: patched process.exit called … at Object.exit
(node-entry-bootstrap.ts:189:29) at runNodeProgramLifecycle (node-program-lifecycle.ts:142:14)`,
status 1. The map's open question ("natural exit calls the user-reassignable
`process.exit` property", owner: agent, first exercised at item 8) is answered
by ADR-0446 §6. It applies to every node-entry owner: worker thread, `node <file>`,
`node -e` and the execSync child.

## Discoveries (not in this unit's promise)

- **`terminate()` before the worker starts.** Node gives `P|exit 0` / `P|terminate 0`
  (p17, 6/6). After `'online'` it gives `exit 1` / `terminate 1` (p18, 4/4). Rifty
  finishes with 1 before the deferred start and still spawns the kernel Worker in
  the queued `start()`, which is never observed afterwards (`worker_threads.ts:134`
  queues `start`, `:311-327` does not stop it). A same-boundary divergence
  that predates this unit; to be routed by the land step (REV-12).
- **The no-COI in-process project command's natural exit** calls the shared
  process's reassignable `exit()` (`no-coi-project-command.ts:145`). That is the
  same class as §Natural exit. The no-COI tier is an unclaimed lifecycle owner
  (ADR-0445 Consequences), so this is routed by the land step.

## Parity cases — Node rows

Each case's setup files and `code` (saved as `main.js`) are run with `node main.js`,
Node v24.16.0, twice, byte-identical apart from timing
(`/tmp`-local runner; the same sources run live in `pnpm test:parity`):

```text
## handle-keepalive          start / message late / exit 0
## handle-reference-api      symbols Symbol(kHandle) Symbol(kPublicPort) / descriptors true/true/true true/true/true /
                             methods function function undefined 0 0 / initial true,false / listener true,true /
                             unref undefined false,false / ref undefined true,true / double-ref-single-unref false,false /
                             second-listener false,false / remove-all false,false / relisten false,true / off false,false /
                             once false,true / removed-once false,false
## handle-listener-reference start / first message late / second message late1
## handle-napi-rs-unref      neutered false false true true
## worker-natural-exit       w-return.cjs message:first message:second exit:0 after-exit:null,null,undefined,undefined /
                             w-exit-code.cjs message:after-timer exit:3 / w-exit-call.cjs message:before-exit exit:5 /
                             w-patched-exit.cjs message:tick message:worker exit event 0 exit:0
## worker-port-reference     w-shape.cjs message:initial=false on=true unref=false ref=true off=false onmessage=true
                             onmessage-null=false remove-all=true once=true once-removed=false returns=undefined,undefined exit:0 /
                             w-once.cjs message:echo:a exit:0 / w-off.cjs message:echo:a exit:0 / w-unref.cjs message:ready exit:0
## worker-port-held          w-on.cjs message:echo:a exit:1 terminate:1 / w-onmessage.cjs message:echo:a exit:1 terminate:1 /
                             w-ref.cjs message:ready exit:1 terminate:1 / w-remove-all.cjs message:echo:a exit:1 terminate:1
## process/natural-exit-patched-process-exit (node -e)  patched-exit: stdout "tick\nexit-event 0\n", stderr "", code 0 /
                             patched-exit-code: stdout "exit-event 4\n", stderr "", code 4
```

All eight exit 0 with empty stderr (the `node -e` launches exit 0 and 4).

## Browser-unit programs — Node rows

Command (repo root): `npx tsx oracle-bu.mts`. The script imports `workerHandlePrograms`
and `workerRows` from `tests/browser-unit/fixtures/worker-handle-keepalive-cases.ts`
and `runNodeProgram` from `tests/browser-unit/fixtures/advanced-ipc-cases.ts`, runs
each program, and prints its `WT|` rows. Three runs were byte-identical (`cmp`). The
seven parity programs give the rows above with a `WT|` prefix, code 0, stderr "".
The other programs give:

```text
## i2-oracle              WT|got hi true / WT|wexit 0 / WT|EXIT 0          code=0 stderr=""
## unref-process-exit     WT|start / WT|EXIT 0                           code=0 stderr=""
## patched-exit-program   WT|tick / WT|exit-event 0                      code=0 stderr=""
## patched-exit-exec-sync WT|child tick / WT|child exit-event 0 / WT|exec-ok   code=0 stderr=""
```

## Prod programs

These are the four files `tests/e2e-prod/worker-threads-keepalive.spec.ts` writes with
`echo`, run with Node v24.16.0 (3 runs each):

```text
node keepalive.cjs → KA|got hi true / KA|wexit 0 / KA|EXIT 0     rc 0
node listener.cjs  → KA|echo ping / KA|echo-exit 1                rc 0
```

## RED (BASE code + this unit's carriers, 2026-09-24)

- `pnpm test:parity worker_threads/handle-` → 4 failed:
  - `handle-keepalive`: `- message late` `- exit 0` (rifty prints only `start`).
  - `handle-listener-reference`: `- first message late` `- second message late1`.
  - `handle-napi-rs-unref`: `- neutered false false true true` / `+ neutered false false false false`.
  - `handle-reference-api`: `+ symbols undefined undefined`, `+ unref [object Object] undefined,undefined`, and so on.
- `pnpm test:parity worker_threads/worker-` → 3 failed. Rifty stdout is empty for
  `worker-natural-exit`, `worker-port-reference` and `worker-port-held`, because the
  parent drains before any Worker reports.
- `pnpm test:parity natural-exit-patched` → 1 failed. `patched-exit`:
  `+ "stderr": "Error: patched process.exit called\n at process.exit ([eval]:1:93)\n at Object.exit
  (…/node-entry-bootstrap.ts:189:29)…"`, `+ "code": 1`. `patched-exit-code`:
  `+ "stdout": ""`, status 1 instead of `exit-event 4` / 4.
- `npx vitest run --project unit packages/runtime-js/src/builtins/worker_threads-keepalive.fault.test.ts`
  → 3 failed: `- "heldWhileAlive": true` / `+ "heldWhileAlive": false` (peer death;
  refused spawn), and `- "heldAfterConstruct": true` / `+ false` (the constructor-throw row
  holds 0, as asserted).
- `RIFTY_PLAYGROUND_PORT=5408 npx playwright test --config playwright.browser-unit.config.ts
  tests/browser-unit/worker-handle-keepalive.spec.ts` → 1 failed. Every program except
  `unref-process-exit` differs, for example `i2-oracle`: `- WT|got hi true`, `- WT|wexit 0`,
  with `WT|EXIT 0` kept. The patched-exit rows are listed in the contract.
- `RIFTY_PLAYGROUND_PORT=5408 npx playwright test --config playwright.prod.config.ts
  --project=chromium tests/e2e-prod/worker-threads-keepalive.spec.ts` → 1 failed:
  `- "KA|got hi true" - "KA|wexit 0"`, `"KA|EXIT 0"` kept, `- "KA|echo ping" - "KA|echo-exit 1"`.

## IMPLEMENT (2026-09-25)

Same host: Node v24.16.0, npm 11.17.0. Probes run `node <file>` under the 10 s
alarm, 3 runs each, identical output.

### Worker `removeAllListeners` (Parity 13)

`p-rmall2.cjs`: `w-late300.cjs` posts after 300 ms. `first`: `unref()`, two
`'message'` listeners, `removeAllListeners('message')`. `second`: one listener,
`removeAllListeners()`, `unref()`, a new listener. Flags `[kHandle, kPublicPort]`:

```text
first listeners false,true / first remove-all-message false,false /
second listener true,true / second remove-all true,false / second relisten false,false   rc 0, no message
```

Node's `EventEmitter#removeAllListeners` emits `'removeListener'` per dropped
listener (LIFO; no argument: own-key order, `'removeListener'` last), which the
Worker's referencing listener sees. `ee-remove-all.cjs` (plain emitter):

```text
rm:x:bound onceWrapper:2 / rm:x:b:1 / rm:x:a:0 / after-x:0,1,1 / rm:y:a:0 / rm:x:a:0 / after-all:0
```

`@riftydev/io`'s `removeAllListeners` emits nothing. Making it emit (tried) turned
`packages/workbench/src/workers/no-coi-project-watches.test.ts` "silently retires
FSWatcher abort and event callbacks" red (`old-remove: expected true to be false`):
ADR-0422's retirement (`fs-watch.ts`) and the kernel's `process-manager.ts` teardown
rely on the silent clear. So the Worker's `removeAllListeners` applies Node's effect
on `kPublicPort` itself (ADR-0446 §1); the emitter gap is a discovery.

Without that override (current tree, override removed) Parity 13 fails:
`+ first remove-all-message false,true`, `+ second remove-all true,true`,
`+ second message late late`.

### `parentPort` edges

- `p-close.cjs` + `w-close.cjs` (`on('message')`, post `hasRef()`, `close()`):
  `P|message before-close true` / `P|exit 0`. `close()` releases the port.
- `p-onm.cjs w-onm.cjs`: `null-first=true fn=true fn-fn-after-unref=false
  five=false:5 null=false dup-count=4 false off-g=3 false` then
  `after-remove-all=false`, `P|exit 0`. Node's first `onmessage` assignment
  registers its handler wrapper even for `null`, so `onmessage = null` first
  references the port; rifty does not (compat ⚠️ shape row). `fn → fn` changes
  nothing; a non-function reads back as assigned and references nothing.

### New carriers — Node rows

`npx tsx /tmp/vgoal/u8/nodecase/run-case.mts <abs case path>` (setup + `code` as
`main.js`), 3 runs each, code 0, stderr `""`:

```text
## handle-remove-all-listeners  first listeners false,true / first remove-all-message false,false /
                                second listener true,true / second remove-all true,false / second relisten false,false
## worker-port-esm              w-off.mjs message:echo:a exit:0 / w-teardown.mjs message:echo:a exit:1 terminate:1 /
                                w-exit.mjs message:tick exit:2 / w-close.mjs message:before-close exit:0
## exec-sync-encoding           utf8 string "héllo\n" / piped string "héllo\n" / hex 68c3a96c6c6f0a / buffer true / default true
```

### RED of the new carriers on the BASE product (harness at HEAD)

`worker_threads.ts`, `node-entry-bootstrap.ts`, `child_process-sync.ts` at
`09f929faa`: `handle-remove-all-listeners` → `TypeError: Cannot read properties of
undefined (reading 'hasRef')`; `worker-port-esm` → rifty stdout empty (4 rows
missing); `exec-sync-encoding` → `+ utf8 object {"type":"Buffer",…}`,
`+ piped object …`, `+ hex <Buffer 68 c3 a9 6c 6c 6f 0a>`.

### Parity 12's carrier needed two repairs

With the natural exit fixed, `patched-exit-exec-sync` still printed
`WT|exec-failed `: rifty's `execSync` ignored `encoding` and returned a Buffer, so
`out.split` threw (a scratch browser-unit run printed
`OUT {"type":"Buffer","data":[116,105,99,107,…]}` = `tick\nexit-event 0\n`).
Fixed per Node's `spawnSync` (`stdout.toString(encoding)` unless `'buffer'`);
Parity 15. Then the only diff was the oracle's `WT|child exit-event \x1b[33m0\x1b[39m`:
the Playwright worker's `FORCE_COLOR` reached the live-Node oracle, whose piped
execSync child colored the number. The oracle now runs without `FORCE_COLOR`
(the evidence's `oracle-bu.mts` run outside Playwright, and a user's terminal,
print `WT|child exit-event 0`).

### GREEN (tree of `efbf2c855` + fingerprint re-pin `3e4f5e3ac`)

- `pnpm test:parity worker_threads/` → 14/14 match (incl. `handle-*` ×5, `worker-*` ×4);
  `pnpm test:parity natural-exit-patched` and `child_process/` (23) match.
- `npx vitest run --project unit packages/runtime-js/src/builtins/worker_threads-keepalive.fault.test.ts` → 3/3.
- `RIFTY_PLAYGROUND_PORT=5408 pnpm exec playwright test --config playwright.browser-unit.config.ts
  tests/browser-unit/worker-handle-keepalive.spec.ts tests/browser-unit/advanced-ipc.spec.ts
  tests/browser-unit/message-port-ref-keepalive.spec.ts --workers=1` → 14 passed (the 13
  worker programs equal live Node; Acceptance 4's detached rolldown build unchanged).
- `RIFTY_PLAYGROUND_PORT=5408 pnpm test:e2e:prod` → 9 passed, incl.
  `worker-threads-keepalive.spec.ts` (Acceptance 3).
- vite regression: `--project=chromium-heavy tests/e2e/react-vite-build.spec.ts` 1 passed;
  `--project=chromium-light tests/e2e/vite7-build-preview.spec.ts tests/e2e/vite-command-honesty.spec.ts` 3 passed.
- `pnpm pr:check` → 24/25 then `check:esbuild-legacy-retirement` only (typescript-worker.js
  same 10 022 694 bytes, new sha256 `40dc0aee…`) → re-pinned in `3e4f5e3ac`.

## Final+GREEN reception (2026-09-25) — failed start without an `'error'` listener

Blocker (Final+GREEN r1, Bugs): a Worker whose start fails through rifty's own
`'error'` path (refused kernel spawn, `data:` URL `NotImplementedError`,
same-realm load failure) with no `'error'` listener threw before
`terminate(1)`: no `'exit'`, `kHandle` held forever, so a parent that survives
the throw (`process.on('uncaughtException')`) never exited. BASE exits 0 there.

### Node rows (the class: a start that fails, entry `./missing.cjs`)

`node <file>` in a dir without `missing.cjs`, v24.16.0, 5 sequential runs each
(unloaded; under load the `wexit` row moves — corrected in §Final+GREEN r2 reception):

```text
uncaught.cjs  (uncaughtException logs `e instanceof Error`, queues a 'micro' row; w.on('message'), w.on('exit'))
  start | uncaught true | wexit 1 | micro | EXIT 0        rc 0, stderr ""
fatal.cjs     (no uncaughtException listener; w.on('message'), w.on('exit'))
  start | EXIT 1                                         rc 1, stderr = the MODULE_NOT_FOUND stack (no wexit row)
listened.cjs  (w.on('error') logs, queues a 'micro' row)
  start | error true | micro | wexit 1 | EXIT 0         rc 0, stderr ""
```

Also (3 runs each): a Worker whose script throws, parent with
`uncaughtException` → `uncaught worker boom / wexit 1 / EXIT 0`, rc 0; without
it → `EXIT 1`, rc 1, no `wexit`. So, unloaded: `'error'` (or the uncaught
exception it becomes) first, `'exit'` 1 after the microtasks that handling
queued, and no `'exit'` once the uncaught exception ended the parent. (Not a
stable Node order: §Final+GREEN r2 reception.)

### Fix

`Worker#fail(error)` (`worker_threads.ts`) is the one failure path for the data:
URL start, the kernel spawn catch, the peer error and the same-realm catch: emit
`'error'`, then in `finally` queue `terminate(1)` (release both, `'exit'` 1)
unless the owner's exit has begun (`isNodeProcessExiting`, Node `_exiting`,
`process-lifecycle-events.ts`). The same-realm catch calls it from a microtask,
so an unlistened `'error'` is an uncaught exception, not a rejection.

### RED (HEAD `30a429e00` product, new carriers)

- `npx vitest run --project unit packages/runtime-js/src/builtins/worker_threads-keepalive.fault.test.ts`
  → 7 failed / 5 passed: each unlistened-uncaught row `- "exit:1"`, `releasedAtExit: false`;
  each listened row `[ 'error', 'exit:1', 'micro' ]` vs `[ 'error', 'micro', 'exit:1' ]`;
  same-realm rows: `Unhandled Rejection VfsError: ENOENT: /workspace/w-missing.cjs`, events `[]`.
  The kernel/data: URL "ends the owner" rows pass on HEAD (they pin the no-`'exit'` guard).
- `RIFTY_PLAYGROUND_PORT=5408 npx playwright test --config playwright.browser-unit.config.ts tests/browser-unit/worker-handle-keepalive.spec.ts`
  → failed: `failed-start-uncaught` `timedOut: true`, rows `WT|start / WT|uncaught true / WT|micro`
  (no `wexit 1`, no `EXIT 0`); `failed-start-listened` `wexit 1` before `micro`;
  `failed-start-fatal` already `WT|start / WT|EXIT 1`, exit 1; the 13 other programs equal live Node.

### Mutants (fault test, fixed tree)

- `finally { void this.terminate(1) }` (sync release, the blocker's literal fix) → 9 failed
  (`exit:1` before `uncaught`; `exit:1` after `owner-exit:1`; `exit:1` before `micro`).
- no `isNodeProcessExiting` guard → 3 failed (`[ 'owner-exit:1', 'exit:1' ]`).
- same-realm catch calls `fail` directly (rejection route) → 2 failed (same-realm rows).

### GREEN

- fault + `worker_threads.test.ts` → 39 passed.
- browser-unit `worker-handle-keepalive`, `message-port-ref-keepalive` (+ `.fault`),
  `advanced-ipc`, `owner-node-process-lifecycle`, `kernel-process-terminal-drain-real-worker`
  (`--workers=1`, port 5408) → 21 passed; the three `failed-start-*` programs equal live Node.
- `pnpm pr:check` on `fd74c13a6` → 25/25 passed (first run on the uncommitted tree: only
  `check:compat-drift`, the uncommitted `process.md` edit, and `check:esbuild-legacy-retirement`,
  typescript-worker.js same 10 022 694 bytes with renamed shared-chunk imports → sha256 re-pinned
  `b9369814…` in `fd74c13a6`).
- `CI= RIFTY_PLAYGROUND_PORT=5408 npx playwright test --config playwright.prod.config.ts --project=chromium
  tests/e2e-prod/worker-threads-keepalive.spec.ts` (fresh prod build) → 1 passed.

## Final+GREEN r2 reception (2026-09-25) — Node's `'exit'` placement is timing-dependent; unlistened peer death

Blockers (Final+GREEN r2, Bugs): (1) peer death with no `'error'` listener gave
`exit:1, uncaught, micro` (fatal: `exit:1, owner-exit:1`) — the kernel's
`attempt(() => emit('peererror'))` collected the listener's throw and rethrew
it after its `queueMicrotask` close chain, i.e. after `fail()`'s terminate
microtask — contradicting ADR-0446 §3 / CHANGELOG, no carrier; (2) the
browser-unit `failed-start-uncaught` compared rifty's fixed order with one live
Node run whose order varies (red on the reviewed tree).

### Node rows under load (v24.16.0; sources = the fixture's Node programs)

`cd /tmp/vgoal/u8/fgr2/node` (`uncaught.cjs` / `fatal.cjs` / `listened.cjs` = the
fixture's `failed-start-*` sources with `./missing.cjs`, no `WT|` wrapper;
`throw-*.cjs` = a worker `throw new Error('boom')`); each run's stdout to its own
file, `sort | uniq -c`:

```text
20 sequential (for i in $(seq 20); do node X.cjs; done):
  uncaught  20  start|uncaught true|wexit 1|micro|EXIT 0   rc 0
  listened  20  start|error true|micro|wexit 1|EXIT 0      rc 0
  fatal     20  start|EXIT 1                               rc 1
10 parallel × 6 rounds:
  uncaught  43  start|uncaught true|wexit 1|micro|EXIT 0
            14  start|uncaught true|micro|wexit 1|EXIT 0
             3  start|wexit 1|uncaught true|micro|EXIT 0
  listened  60  start|error true|micro|wexit 1|EXIT 0
  fatal     60  start|EXIT 1
16 parallel × 10 rounds:
  uncaught  71 uncaught,wexit,micro / 66 uncaught,micro,wexit / 23 wexit,uncaught,micro   (all EXIT 0, rc 0)
  listened 146 error,micro,wexit / 14 error,wexit,micro                                    (all EXIT 0, rc 0)
  fatal    151 start|EXIT 1 / 9 start|wexit 1|EXIT 1                                       (all rc 1)
  throw-uncaught 93 uncaught,wexit,micro / 54 uncaught,micro,wexit / 13 wexit,uncaught,micro
  throw-fatal    153 EXIT 1 / 7 wexit 1|EXIT 1
```

Through the spec's own `runNodeProgram` + `failedStartRows`
(`npx tsx /tmp/vgoal/u8/fgr2/oracle-failed-start.mts <rounds> <parallel>`):

```text
20×1   uncaught 20 start,uncaught,wexit,micro,EXIT 0 · fatal 20 start,EXIT 1 · listened 20 start,error,micro,wexit,EXIT 0
       projected: one value per program (20/20)
10×16  uncaught 95 …micro,wexit… / 55 …wexit,micro… / 10 start,wexit,uncaught…
       fatal 147 start,EXIT 1 / 13 start,wexit 1,EXIT 1 · listened 150 …micro,wexit… / 10 …wexit,micro…
       projected (160/160 each):
       uncaught {"ordered":["WT|start","WT|uncaught true","WT|micro","WT|EXIT 0"],"wexit":["WT|wexit 1"]} code=0
       fatal    {"ordered":["WT|start","WT|EXIT 1"]} code=1
       listened {"ordered":["WT|start","WT|error true","WT|micro","WT|EXIT 0"],"wexit":["WT|wexit 1"]} code=0
```

So Node's stable facts: `'error'` precedes `'exit'` when listened; an unlistened
`'error'` is the parent's uncaught exception; the parent survives it with
`'exit'` 1 and rc 0 when handled, and ends rc 1 otherwise; nothing hangs. The
`wexit` row's place (and, when the exception is fatal, whether it prints) races.
Rifty's fixed order = every unloaded Node run's order above.

### Fix

- `worker_threads.ts`: the peer error calls `fail()` from its own microtask, so an
  unlistened `'error'` escapes to the realm trap before `fail()`'s terminate
  microtask (same order as the failed starts; the kernel no longer holds it back).
- Carriers: the fault test's failure rows gain `kernel peer death` (uncaught /
  fatal / listened); the browser-unit failed-start programs are compared with
  live Node on `failedStartRows` (every row but `wexit` in order; `wexit` only
  where Node always prints it), in their own `expect` after Acceptance 2's.
- ADR-0446 §3, CHANGELOG, compat keepalive row, unit peer-death row + re-cut:
  Node's placement recorded as timing-dependent, rifty's as an unloaded Node run's.

### RED (HEAD `cb2039be8` product, new peer-death rows)

`npx vitest run --project unit packages/runtime-js/src/builtins/worker_threads-keepalive.fault.test.ts`
→ 2 failed / 13 passed: `kernel peer death: … uncaught exception, then 'exit' 1`
events `[ 'exit:1', 'uncaught', 'micro' ]`; `kernel peer death: … ends the owner`
events `[ 'exit:1', 'owner-exit:1' ]` (= the reviewer's probe).

