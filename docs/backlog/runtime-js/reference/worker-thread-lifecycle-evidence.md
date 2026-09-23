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
