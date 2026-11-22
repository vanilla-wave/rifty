# @riftydev/isolate-host

Run untrusted JavaScript from a Node service like `node -e <code>`. The code
runs in a fresh rifty runtime inside a V8 isolate (isolated-vm). Isolates live
in long-lived worker processes that the package spawns and reuses, up to 4
calls per worker. Decisions: ADR-0557, ADR-0563.

```js
import { runCode } from '@riftydev/isolate-host';

const { stdout, stderr, exitCode } = await runCode("console.log(6 * 7)");
// → { stdout: '42\n', stderr: '', exitCode: 0 }
```

## Install (dev)

The package is not on npm yet. Install the packed tarball:

```sh
# in the rifty checkout
pnpm install && pnpm --filter @riftydev/isolate-host build
cd packages/isolate-host && pnpm pack          # → riftydev-isolate-host-0.1.0.tgz
# in the service
npm install /path/to/riftydev-isolate-host-0.1.0.tgz
```

Requirements: Node ≥ 24, an ESM importer. Tested on darwin-arm64 and
linux-x64 (CI); Windows is not tested. The only runtime dependency is
`isolated-vm@7.0.2`. It ships prebuilt binaries for linux-x64/arm64,
darwin-arm64 and win32-x64; other platforms need a C++ toolchain. Your service
starts with plain `node`. The package passes `--no-node-snapshot` to its own
workers.

## API

`runCode(code: string, options?) → Promise<RunCodeResult>`

| option | default | meaning |
|---|---|---|
| `allowSharedArrayBuffer` | true | false removes the global (`typeof SharedArrayBuffer === 'undefined'`), matching Node with `--enable-sharedarraybuffer-per-context`. Access to a shared wasm backing buffer throws `NotImplementedError('isolate-host.SharedArrayBuffer')` for this call. Ordinary buffers, wasm and Atomics keep their semantics. |
| `timeoutMs` | 30 000 | wall-clock deadline from the call |
| `memoryLimitMb` | 256 | isolate heap limit (min 8); adds 3 × this to its worker's RSS ceiling (256 MiB + 3 × the sum over the worker's calls). Below ~16 the rifty runtime itself does not fit and every run ends as `termination: 'memory'` (measured: 12 fails, 15 runs `console.log`) |
| `maxOutputBytes` | 1 MiB | stdout + stderr bytes kept |

Result:

- `stdout`, `stderr`: the bytes the guest wrote, decoded as UTF-8.
  `process.stdout.write('x')` gives `'x'`. Nothing is added by the host.
- `exitCode`: Node's status. It is `null` when the run was killed; Node's
  `spawnSync().status` is also `null` for a killed child.
- `termination`: `'timeout'` or `'memory'`, present only on a kill. `'memory'`
  means the call's own isolate hit its heap limit or a V8 fatal OOM, or the
  call, rerun alone, exhausted its worker. Keep an RSS cgroup around the
  workers (bound below).
- `truncated: true`: output passed `maxOutputBytes`. The excess was dropped,
  not buffered, and the run went on to its own exit.

Every call settles within `timeoutMs` + 1 s, measured from the call.

Each call is a new isolate: files, globals and timers do not carry over to any
other call, on the same worker or not. Calls may run concurrently: the first
4 share a worker, the next ones start another. One idle worker stays warm. A
worker does not keep your process alive, and it dies with your process.

When a worker is lost with no culprit known, each of its calls reruns once on
a worker of its own, within its original deadline. Causes: a crash, the
OOM-killer, an external `kill`, or its RSS ceiling on a worker shared with
other calls. Alone, a call that exhausts its worker gets `memory`; an innocent one
completes. A call whose own worker is lost for an unknown reason, or whose
rerun does not finish before its deadline, rejects with an `Error` whose
`code` is `'ERR_ISOLATE_HOST_WORKER_LOST'`. Its message,
`isolate-host child exited unexpectedly (code …, signal …)`, contains no guest
text.

`ERR_ISOLATE_HOST_WORKER_LOST` can be the call's own doing: a guest that
exhausts its worker only on its first attempt, or only late, is not caught by
its rerun and may run out of its deadline. Each retry also reruns the calls
that share its worker, at up to four processes. Retry such a call at most once,
and count the retry against the rate limit of its source.

How far RSS can go, for your RSS cgroup. A worker's ceiling is
256 MiB + 3 × A, where A is the largest sum of `memoryLimitMb` over the calls
it ran at the same time since it last went from idle to busy; A does not fall
while the worker stays busy. A worker may pass its ceiling by one allocation
step before it is caught. Example: a call at 1024 and a call at 64 run together
(A = 1088); the 1024 one ends and the 64 one goes on alone — that worker may
still reach 256 + 3 × 1088 = 3520 MiB, not 448. With the defaults (256) a full
worker can reach 3328 MiB; a call rerun alone, 256 MiB + 3 × its own limit.
The pool runs at most (calls in flight + 1) workers at once: every worker but
one warm idle one holds a call. A call that timed out counts as in flight until
its isolate stops (at most ~1 s more for a guest that ignores termination). Size the cgroup for your peak of concurrent
calls times their workers' ceilings.

## Sandbox: files and `node <path>` runs (ADR-0568)

One sandbox for one agent run: the host writes the model's files, runs one as
`node <path> [args]`, reads what it wrote (bytes, a PDF included), fixes and
runs again.

```js
import { createSandbox } from '@riftydev/isolate-host';

const sandbox = await createSandbox();
await sandbox.writeFile('main.js', `
  const fs = require('fs');
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync(process.argv[2], Buffer.concat([Buffer.from('%PDF-1.4\\n'), Buffer.from([0, 255])]));
  console.log('wrote', process.argv[2]);
`);
const result = await sandbox.exec('main.js', { args: ['out/report.pdf'] });
// → { stdout: 'wrote out/report.pdf\n', stderr: '', exitCode: 0 }
const pdf = await sandbox.readFile('out/report.pdf'); // Uint8Array, straight from the sandbox
await sandbox.destroy();
```

`createSandbox(options?) → Promise<Sandbox>`

| option | default | meaning |
|---|---|---|
| `snapshot` | — | bytes of `sandbox.snapshot()`: the new sandbox starts with those files |
| `maxFileBytes` | 32 MiB | largest file one `readFile`/`writeFile` moves (`ERR_FS_FILE_TOO_LARGE`) |
| `maxFsBytes` | 64 MiB | largest state, counted as snapshot bytes: a host write past it rejects `ERR_ISOLATE_HOST_SANDBOX_FULL`, a run whose end state is past it gets `stateRefused`. A run needs an isolate of about 2.3 × its state (`memoryLimitMb` 256 holds about 100 MiB); raise both together |
| `template` | — | not implemented: `NotImplementedError('isolate-host.sandbox-template')` |

A fresh sandbox holds the empty directories `/workspace` (the cwd) and `/tmp`
(rifty's `os.tmpdir()`). Paths: a relative path resolves against
`/workspace`; `..` never leaves the sandbox's own `/`; a NUL is
`ERR_INVALID_ARG_VALUE`. Errors have Node's shape (`code`, `syscall`, `path`,
`ENOENT: no such file or directory, open '/workspace/x'`) and name only
sandbox paths. rifty's FS has no links: every entry is a file or a directory.

| method | does |
|---|---|
| `writeFile(path, data)` | `Uint8Array` or UTF-8 string; parents created |
| `readFile(path)` | `Uint8Array`, a copy (and `writeFile` copies its input) |
| `list(path = '/workspace')` | `{ name, type: 'file' \| 'directory', size }[]`, by name |
| `remove(path)` | a file or a directory tree |
| `exec(path, options?)` | `node <path> [args]` in `/workspace`: `runCode`'s options plus `args` (strings); `env`, `cwd`, `stdin` are `NotImplementedError('isolate-host.sandbox-exec-<option>')`. The path is one file, never a shell command |
| `snapshot()` | the files as bytes (ADR-0567), taken between operations |
| `destroy()` | the run in flight and everything after reject `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`; the state is dropped |

Operations on one sandbox take effect one at a time, in call order, also when
you do not await them; sandboxes do not wait for each other. A run's
`timeoutMs` counts from when it starts, after earlier operations.

`exec` returns `runCode`'s result, plus `stateRefused` when the run ended on
its own but its files were not kept. What survives a run:

| the run | the files after it |
|---|---|
| exits (any code, `process.exit`, an uncaught throw or rejection) | as the run left them |
| `termination: 'timeout'` or `'memory'` | as before the run: a killed run's writes are rolled back (Node keeps them) |
| its worker lost (rerun once, alone; then `ERR_ISOLATE_HOST_WORKER_LOST`) | as before the run; the rerun starts from the same files |
| `stateRefused` (`ERR_FS_SNAPSHOT_TOO_LARGE`, `ERR_ISOLATE_HOST_SANDBOX_CAPTURE`, a refusal of the codec; `ERR_ISOLATE_HOST_SANDBOX_RESTORE`: the files did not fit the run's isolate or its worker, no guest code ran, `exitCode: null`; an isolate too small for the runtime itself is `termination: 'memory'`, as for `runCode`) | as before the run |

Each run is a fresh isolate, like a new `node` process: only files carry over.
Between operations a sandbox holds no process and no isolate, only its files
in your process's memory (about their size); a sandbox you drop is ordinary
garbage. The number of live sandboxes is yours to cap.

Cost (M3 Pro, Node 24.16.0, medians, built package): `createSandbox` 0.01 ms; a warm
`exec` 17 ms with one small file, 21 ms with 66 files (~180 KiB), 265 ms with a 20 MiB
file (its state goes to the run and back as bytes); `writeFile` 10 KiB 0.14 ms on a small
sandbox, 24 ms on a 20 MiB one (each host write checks the state cap by measuring a snapshot);
an idle sandbox ~1.6 KiB plus its files.

If your result type has `exitCode: number`, map a killed run yourself from
`termination` (`exitCode: null` is never a guest's status).

## What the guest gets

The guest gets rifty's Node environment, which is not real Node: `require`,
`fs` over an in-memory filesystem (`runCode`: the empty directories `/workspace`,
the cwd, and `/tmp`, rifty's `os.tmpdir()`; a sandbox run: the sandbox's files),
`Buffer`, `process`, timers, `console`, the builtin modules as globals for
`runCode` only (`path`, `fs`, …, as `node -e` provides; a file run has none, as
`node <file>`), `TextEncoder`/`TextDecoder` (UTF-8),
`atob`/`btoa`, `crypto.getRandomValues`/`randomUUID` and `performance.now`.
Parity with `node -e` on Node 24 is tested on a corpus of model-style
snippets (`tests/parity.test.ts`).

Not available. Each of these throws `NotImplementedError` naming the API:

- network: `fetch`, `WebSocket`, `node:http`/`https`/`net` (throw at
  require), `node:tls`/`dgram`/`http2`;
- `URL`, `URLSearchParams`, `structuredClone`, web streams,
  `AbortController`/`AbortSignal`, `Event`/`EventTarget`/`CustomEvent`,
  `Blob`/`File`, `Request`/`Response`/`Headers`/`FormData`,
  `MessageChannel`/`MessagePort`/`BroadcastChannel`, the other web-stream,
  `Performance*`, `Crypto*` and event classes, `URLPattern`, `navigator.*`,
  `crypto.subtle`, `performance.mark`/`measure`/`nodeTiming`/…. Static members of these (`URL.canParse`,
  `AbortSignal.timeout`, …) are missing and give a plain `TypeError`;
- ESM syntax in the code (`import … from`, top-level `await`). Node runs such
  input as a module; this host evaluates CommonJS only, so use `require()`.
  `import()` ends the run: its named error goes to stderr and the run exits 1,
  whatever the code does with the returned promise (a `.catch` cannot keep the
  run alive). Use `require()`.
- `zlib`, `child_process`, `worker_threads` (throw at require).

Known differences:

- `console.log`/`util.inspect` formatting is simpler than Node's: no line
  breaking or grouping of long arrays and objects, typed arrays print as
  objects, default depth is 3.
- An uncaught error that is not a `throw` statement (e.g. `undefined.x`)
  prints without Node's `[eval]:1` source header.
- An unhandled rejection fails at rifty's next event-loop check, not at once: a
  `.catch` attached from a later timer may still run first. A rejection whose
  handler comes from a timer or immediate already due, or that is chained after
  an `fs.promises` call, can go unreported (exit 0; Node exits 1).
- An unhandled rejection is lost when the GC collects its promise before the
  task ends (isolated-vm keeps it by weak handle,
  https://github.com/laverdet/isolated-vm/issues/589): `Promise.reject(err)`
  or an un-awaited `async` call followed by allocating work (a few ms can be enough) gives
  `exitCode: 0` and an empty stderr where Node exits 1. Nothing in the result
  tells it from a clean exit, and an `unhandledRejection` listener does not
  fire. In guest code, handle every promise: end each chain and the async
  entry point with `.catch((e) => { console.error(e); process.exitCode = 1 })`.
- `process.exit()` from a promise callback or `queueMicrotask` queued by the
  code's synchronous run ends as `termination: 'timeout'`; from a later task
  it exits as in Node. Set `process.exitCode` instead.
- An `unref()`'d timer may still fire during the few ms the run takes to
  confirm its loop is idle.
- An `unhandledRejection` listener receives a copy of the reason, and
  `promise` is `undefined`. A non-`Error` reason arrives as a generic `Error`.
- Identity is rifty's: `process.version`, `os.platform()`, `process.cwd()`,
  `process.argv`. `process.env` is empty. There is no stdin.

Matrix: `docs/public/compat/isolate-host.md`.

To run the same guest in an isolate you create yourself (your own isolated-vm,
your own topology), use `@riftydev/isolate-guest` (unstable, ADR-0558). The
guarantees on this page do not carry over to it.

## Security: what this does and does not protect

Tested:

- a guest cannot make `runCode` report a failure of the host's own, and
  cannot hang the call past `timeoutMs` + 1 s. One exception is outside the
  isolate: something can kill a worker, such as your cgroup's OOM-killer
  (which a guest can provoke by allocating). Each call on it then reruns once,
  alone, and a loss of that worker rejects it with
  `ERR_ISOLATE_HOST_WORKER_LOST`;
- a guest that does not escape changes another call's result only by
  delaying it. Memory blow-ups, hangs, `Atomics.wait`, builtins that ignore
  termination, and output or timer floods were tested next to 3 concurrent
  calls on one worker. A call whose deadline the delay outlives ends as
  `timeout`, or as `ERR_ISOLATE_HOST_WORKER_LOST` after its worker was lost;
- a guest can change its own result. It can forge its exit status (throw a
  `RIFTY_PROCESS_EXIT` lookalike, rewrite a caught exit signal) or replace JS
  intrinsics rifty's runtime uses. Either way its stdout, stderr and exit code
  can differ from Node's, and a failing program can read as exit 0 (compat
  ⚠️). That is a fidelity gap of its own run, not a way out of the isolate;

- the guest sees none of your process's globals or env;
- the guest gets no Node primitive or isolated-vm handle;
- the guest has no network;
- limits end the guilty call or its worker, never your process.

Workers start with an empty environment. A worker is treated as hostile: it
reports through length-framed binary frames on a pipe that your process parses
itself. Each frame names its call, and a frame for a call that is not in
flight on that worker is a violation. What your process keeps is bounded by the output cap
(about 2× the cap while a frame is in flight). Transient RSS can reach several
times the cap: ~6.5× for one cap-sized frame, ~100 MiB for a flood of tiny
frames at the default 1 MiB cap. A malformed or
out-of-protocol frame kills the worker, and its calls reject with
`isolate-host child protocol violation: …`.

Not protected:

- **An isolate escape.** A V8 or isolated-vm bug can give the guest code
  execution as the worker's OS user, inside a process that hosts other calls'
  guests, now and later. Escaped code can read and change their code, data and
  output, read your process's environment (`/proc/<ppid>/environ`), the
  filesystem and the network. The empty worker env only stops a leak through a
  rifty bug. **You must put the workers behind your own boundary:** a separate
  uid, a sandbox or container, an RSS cgroup, no secrets reachable by that
  user. Keep V8 up to date: upgrade Node point releases that patch V8.
- **Side channels between isolates of one worker** are an open class.
  By default `SharedArrayBuffer` and `Atomics` exist in the guest (no second thread, no
  memory shared with other isolates). `performance.now()` resolves to ~3 µs.
  Tenants that must not share a process need separate consumer processes.
- **Repeated attacks.** A guest can repeat any attack in new calls without
  bound. Limit the call rate per source yourself.

What a worker shares between its calls, and what bounds each part
(ADR-0563 §7):

| Shared | Bound |
|---|---|
| Process memory, in or out of the isolate heaps (wasm, resizable buffers, ICU, timers) | each call's isolate heap limit; the worker's RSS ceiling (256 MiB + 3 × the calls' limits, never lowered while it is busy) kills it, and each call reruns alone, where an exhaustion is its own `memory`; an idle worker above 256 MiB is replaced |
| isolated-vm's thread pool (cores + 1 threads) | 4 calls per worker; an isolate still running 1 s after termination retires its worker, whose other calls finish there |
| The worker's event loop (guest writes, timers) | output capped per call; an interval re-arms only after its callback ran; requests are read linearly |
| CPU | the OS scheduler: delay only. On a 1–2 core machine the pool has fewer threads than a worker's 4 calls, so busy neighbours wait their turn |

## Cost

Each call builds a fresh isolate and loads a ~7 MB runtime bundle into it, on a
warm worker from a V8 code cache. N concurrent calls run in ⌈N/4⌉ workers.
There is no queue, so cap concurrency yourself. Reproduce with
`node scripts/measure.mjs` after `pnpm run build`. On an Apple M3 Pro, macOS,
Node v24.16.0 (darwin/arm64), at this commit:

```
first call (worker spawn, uncached compile): 127 ms
warm worker runCode('console.log(1)'): p50 13.1 ms, max 16.1 ms (20 sequential)
1 concurrent on one worker: 143 MiB peak worker RSS
2 concurrent on one worker: 165 MiB peak worker RSS
3 concurrent on one worker: 187 MiB peak worker RSS
4 concurrent on one worker: 211 MiB peak worker RSS
8 concurrent, cold (2 workers): 414 MiB peak total RSS, 658 ms wall
```

The same machine with a child process per call (ADR-0557, before this pool):
p50 137 ms per call; 8 concurrent calls peaked at 1118 MiB. Concurrent calls
sleep 500 ms. A guest's heap counts on top of this, up to `memoryLimitMb`.
These are measurements, not promises.
