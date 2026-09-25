# Worker lifecycle Contract+RED — 2026-09-23

Owns map items 8/11 plus required kernel natural-exit repair. Preparation only;
no Worker production edits. Baseline checked after 57602c71a; final fixture run
on current 0879f7bf tree with ongoing parent-owned lifecycle work.

## Oracle and reusable source

Native Node v24.16.0. Same exact parent/child source for native and Chromium:
`tests/browser-unit/fixtures/worker-lifecycle-cases.ts`. A parent-only global
sentinel makes same-realm fallback fail. No Worker eval:true entries.

```sh
node --import tsx --input-type=module <<'NODE'
import {workerLifecycleCases} from './tests/browser-unit/fixtures/worker-lifecycle-cases.ts';
import {nativeWorkerLifecycle} from './tests/browser-unit/fixtures/worker-lifecycle-oracle.ts';
console.log(process.version);
for(const fixture of workerLifecycleCases) console.log(fixture.name,JSON.stringify(await nativeWorkerLifecycle(fixture)));
NODE
```

```text
v24.16.0
parent-live-worker {"code":0,"stdout":"WORKER|message=late\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
parent-ref-after-unref {"code":0,"stdout":"WORKER|message=late\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
parent-unref {"code":0,"stdout":"WORKER|parent-exit=0\n","stderr":""}
child-natural-exit {"code":0,"stdout":"WORKER|message=immediate\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
parent-port-close {"code":0,"stdout":"WORKER|message=ready\nWORKER|message=reply:ping\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
parent-port-remove {"code":0,"stdout":"WORKER|message=ready\nWORKER|message=reply:ping\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
parent-port-unref {"code":0,"stdout":"WORKER|message=ready\nWORKER|message=reply:ping\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
stdio-capture {"code":0,"stdout":"WORKER|captured={\"shape\":[true,true,\"function\",\"function\"],\"stdout\":\"WORKER|stdout\\nWORKER|console-stdout\\n\",\"stderr\":\"WORKER|stderr\\nWORKER|console-stderr\\n\",\"code\":0,\"ended\":[true,true]}\nWORKER|parent-exit=0\n","stderr":""}
stdio-default {"code":0,"stdout":"WORKER|streams=[\"object\",\"object\",\"function\",\"function\"]\nWORKER|stdout\nWORKER|console-stdout\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":"WORKER|stderr\nWORKER|console-stderr\n"}
explicit-empty-exec-argv {"code":0,"stdout":"WORKER|parent-eval=true\nWORKER|child-exec-argv=[]\nWORKER|exit=0\nWORKER|parent-exit=0\n","stderr":""}
terminate-releases-once {"code":0,"stdout":"WORKER|exit=1\nWORKER|terminated=1\nWORKER|terminated-again=undefined\nWORKER|parent-exit=0\n","stderr":""}
```

## Discriminating RED

```sh
pnpm test:browser-unit tests/browser-unit/worker-thread-lifecycle.spec.ts
```

Real COI Chromium, sealed Workbench, real terminal commands and kernel Workers;
no mocked Worker/runtime package. External 6-second test deadline only diagnoses
missing completion; terminal.close always tears down the command. The deadline
never enters the child keepalive count. CJS parent tests use no artificial
interval or top-level await. ESM awaits isolate child/stdio behavior from the
missing parent ref; these ESM cases do not claim parent-handle proof.

Observed 9 RED, 2 controls PASS:

| Case | Browser observation |
|---|---|
| parent-live-worker / parent-ref-after-unref | only parent-exit=0; late message and child exit absent |
| child-natural-exit | immediate message received; no child exit before host deadline |
| parent-port-close / remove / unref | ready and reply:ping received; no child exit before host deadline |
| stdio-capture | Worker.stdout/stderr absent; stream collector fails, exit 1 |
| stdio-default | accessing Worker.stdout.pipe fails, exit 1 |
| explicit-empty-exec-argv | parent-eval=true; Worker.execArgv NotImplementedError, exit 1 |
| parent-unref | native output match; PASS preservation control |
| terminate-releases-once | native output match; PASS preservation control |

Terminal multiplexes stderr/stdout, so assertions retain stdout ordering and
compare stderr's own rows independently. Capture uses sentinel lines: accidental
forwarding produces extra visible rows and fails exact comparison. Byte strings
inside the captured result and readableEnded flags prove full output + EOF.

Native detail: Readable end callbacks need not fire before Worker exit; an
initial probe's exit callback saw no end callbacks yet. The certified candidate
waits for stdout EOF, stderr EOF and worker exit together; no invented ordering.

## Root ownership and bounded route

- Worker constructor/ref/unref/finish in `builtins/worker_threads.ts` lack parent
  refs. Existing child_process hold/release owner and terminal observer are the
  sibling reference; no second terminal authority.
- Kernel Worker hardcodes serve:true, bypassing natural drain. The child
  parentPort EventEmitter lifetime must be counted before switching that path;
  timer/message-driven Rolldown workers must stay alive.
- Stdout/stderr only emit parent events today; real kernel streams already
  deliver bytes. Expose/forward/end through Readables with the existing terminal
  ordering boundary, not separate transport or synthetic data.
- Own execArgv currently rejected before dispatch, even []; explicit [] must
  override inherited eval args, while nonempty unsupported identity stays loud.
- IPC serializer work concurrently advances bootstrap protocol; this preparation
  edits no launch schema or product owner. Coordinate final Worker bootstrap
  branch with parent after process/IPC changes.

Vitest-main pending-handle coverage fog remains a scenario observation owned by
the driver; generic I2 behavior is independently reproduced here. No widened
handle class or special Vitest promise-wait proposed.

## Implementation and GREEN

ADR-0449 extends the existing refcount, not a second lifecycle registry.
Worker owns its parent ref; WorkerPort owns the child listener/ref transitions.
Kernel children use serve:false; their Workbench entry waits for runtime drain
then process.exit. Closed ports drop subsequent messages while consuming the
private channel, preventing closed-port messages being re-buffered as pre-entry
IPC. No process.ts/IPC-v5 changes in this unit.

`stdout`/`stderr` Readables receive real kernel output. The same streams forward
by default or remain capture-only per options; terminal finish pushes EOF.
Explicit [] bypasses only the nonempty-execArgv ceiling and overrides eval
inheritance. No package-specific promise waiting or source patch.

Reviewer advisory closed by added `persistent-exit-counter`: persistent
worker.on('exit') increments/logs every emission and parent process exit prints
the final count. Native and Chromium print one event and exit-count=1. Existing
certified assertions were not changed. Additional `terminate-drains-stdio`
control verifies all 262144 published bytes survive termination and EOF.

Checks on final Worker source:

- Chromium `worker-thread-lifecycle.spec.ts`: 13/13 PASS (11 certified + 2
  independent terminal/stdio controls); final log `/private/tmp/rifty-worker-final-browser.log`.
- `pnpm test:run packages/runtime-js/src/builtins/worker_threads.test.ts tests/conformance/builtins/worker_threads.test.ts`: 31/31 PASS.
- `node --import tsx tools/node-parity-runner/src/cli.ts worker_threads/`: 5/5 match.
- runtime-js and workbench package `tsc --noEmit`: PASS.
- Existing unit failures reproduced once in the failed file alone: old []
  rejection and serve:true assertions. Accepted contract supersedes those
  assertions; nonempty execArgv rejection remains tested, spawn now asserts
  serve:false. No certified RED retargeted.

## Vitest-main coverage fog

`pnpm test:e2e:heavy tests/e2e/owner-shell-vitest.spec.ts` — reported PASS, 47.4s test
(51.7s command), log `/private/tmp/rifty-vitest-with-worker-lifecycle.log`.
No dedicated port was supplied; heavy configuration may reuse an existing
server, and this run did not prove its worktree provenance. This result does
NOT close the Vitest-main coverage fog. Parent is running a fresh dedicated
port control; generic Worker acceptance above is hermetic browser-unit proof,
not a substitute for real Vitest acceptance from this tree.

## Native-observed parent message-port ref repair

Fresh dedicated-port RED after initial Worker implementation:

```sh
RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/worker-thread-lifecycle.spec.ts -g 'message-listener'
RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/worker-thread-lifecycle.spec.ts -g 'ref-return-values'
```

First command: 2 RED (first-message-listener-refs, once-message-listener-releases-ref),
2 controls PASS (additional-message-listener-keeps-unref, removed-message-listener-unrefs).
Second: RED; Worker and parentPort returned objects instead of native undefined.
Logs: `/private/tmp/rifty-worker-listener-red.log`, `/private/tmp/rifty-worker-ref-return-red.log`.

Native reference can be repeated from the shared fixtures with the oracle command
above, filtering names by `/message-listener|ref-return-values/`. Node v24.16.0:

```text
first-message-listener-refs: message=late → exit=0 → parent-exit=0
additional-message-listener-keeps-unref: parent-exit=0
removed-message-listener-unrefs: parent-exit=0
once-message-listener-releases-ref: message=ready → parent-exit=0
ref-return-values: ref-returns=["undefined","undefined"] → port-ref-returns=["undefined","undefined"] → parent-exit=0
```

Local native implementation confirms authority (`node` version above):

```js
const worker = process.binding('natives')['internal/worker'];
const io = process.binding('natives')['internal/worker/io'];
console.log(worker.slice(worker.indexOf('  ref() {'), worker.indexOf('  get threadId()')));
const start = io.indexOf('function setupPortReferencing');
console.log(io.slice(start, io.indexOf('class ReadableWorkerStdio', start)));
```

Worker.ref/unref call both kHandle and kPublicPort; setupPortReferencing only
refs on first message listener and unrefs on last removal. This rules out one
sticky boolean and unconditional ref on every listener. The smallest carrier
is two independent native ref factors feeding one existing aggregate keepalive
ref; MessageListenerEmitter shares the transition chokepoint with parentPort.
Explicit second unref still releases both factors; no Vitest-specific exception.

Final fresh-server check:

```sh
RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/worker-thread-lifecycle.spec.ts
```

18/18 PASS, 19.6s, `/private/tmp/rifty-worker-listener-green.log`. Browser-unit
config has reuseExistingServer:false and starts this checkout's playground.
Worker unit/conformance 31/31, Worker parity 5/5, runtime-js tsc also PASS after
this repair. The old return-this assertion was a native-disproved stub; its
replacement asserts undefined. Certified original cases unchanged.

Driver's actual Vitest trace shows two intentional unrefs from rolldown
onCreateWorker and emnapi threadSpawn; Worker creation is counted. Investigation
of a separate NAPI/MessageChannel lifetime remains driver-owned; these unrefs
are not overridden to hide it. Generic I2 proof does not close that scenario fog.

Final ownership gates: check:arch, file-size, dir-owner, refs, backlog and
whitespace checks PASS. Worker file 741 lines; helper 103; no ratchet changes.
A post-GREEN Worker revert-check is pending driver coordination: shared live
Vitest/IPC diagnostics made temporary source rollback unsafe during this
handoff. Pre-implementation REDs and all fresh listener REDs are recorded above.
