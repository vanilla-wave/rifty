# @riftydev/isolate-host

Run untrusted JavaScript from a Node service like `node -e <code>`. The code
runs in a fresh rifty runtime inside a V8 isolate (isolated-vm), inside a
child process that is spawned for the call and killed after it. Decision:
ADR-0557.

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

Requirements: Node ≥ 24, an ESM importer. The only runtime dependency is
`isolated-vm@7.0.2`. It ships prebuilt binaries for linux-x64/arm64,
darwin-arm64 and win32-x64; other platforms need a C++ toolchain. Your service
starts with plain `node`. The package passes `--no-node-snapshot` to its own
child.

## API

`runCode(code: string, options?) → Promise<RunCodeResult>`

| option | default | meaning |
|---|---|---|
| `timeoutMs` | 30 000 | wall-clock deadline from the call |
| `memoryLimitMb` | 256 | isolate heap limit (min 8); child RSS ceiling = 256 + 3 × this |
| `maxOutputBytes` | 1 MiB | stdout + stderr bytes kept |

Result:

- `stdout`, `stderr`: the bytes the guest wrote, decoded as UTF-8.
  `process.stdout.write('x')` gives `'x'`. Nothing is added by the host.
- `exitCode`: Node's status. It is `null` when the run was killed; Node's
  `spawnSync().status` is also `null` for a killed child.
- `termination`: `'timeout'` or `'memory'`, present only on a kill. `'memory'`
  covers the isolate heap limit, V8 fatal OOM and the child RSS ceiling. The
  RSS ceiling is a sampled watchdog, so one large allocation can overshoot
  it. Keep an RSS cgroup around the child.
- `truncated: true`: output passed `maxOutputBytes`. The excess was dropped,
  not buffered, and the run went on to its own exit.

Every call settles within `timeoutMs` + 1 s. If the child dies on its own
(crash, OOM-killer, external `kill`), the call rejects at once with an
`Error` that names the code and signal.

Each call is a new instance: files, globals and timers do not carry over.
Calls may run concurrently; each one is its own child process.

## What the guest gets

The guest gets rifty's Node environment, which is not real Node: `require`,
`fs` over an empty in-memory filesystem (cwd `/workspace`), `Buffer`,
`process`, timers, `console`, the builtin modules as globals (`path`, `fs`, …,
as `node -e` provides), `TextEncoder`/`TextDecoder` (UTF-8),
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
  `import()` rejects with a named error; unhandled, the run fails with
  exit 1, as Node fails a missing module.

Known differences:

- `console.log`/`util.inspect` formatting is simpler than Node's: no line
  breaking or grouping of long arrays and objects, typed arrays print as
  objects, default depth is 3.
- An uncaught error that is not a `throw` statement (e.g. `undefined.x`)
  prints without Node's `[eval]:1` source header.
- An `unhandledRejection` listener receives a copy of the reason, and
  `promise` is `undefined`. A non-`Error` reason arrives as a generic `Error`.
- Identity is rifty's: `process.version`, `os.platform()`, `process.cwd()`,
  `process.argv`. `process.env` is empty. There is no stdin.

Matrix: `docs/public/compat/isolate-host.md`.

## Security: what this does and does not protect

Tested:

- the guest sees none of your process's globals or env;
- the guest gets no Node primitive or isolated-vm handle;
- the guest has no network;
- limits kill the child, never your process.

The child starts with an empty environment.

Not protected: an isolate escape. A V8 or isolated-vm bug can give the guest
code execution as the child's OS user. Escaped code can then read your
process's environment (`/proc/<ppid>/environ`), the filesystem, and the
network. The empty child env only stops a leak through a rifty bug. **You
must put the child behind your own boundary:** a separate uid, a sandbox or
container, an RSS cgroup, no secrets reachable by that user. Keep V8
up to date: upgrade Node point releases that patch V8.

## Cost

Each call spawns a Node process and loads a ~7 MB runtime bundle into a
fresh isolate. Measured: `runCode('console.log(1)')` p50 123 ms, p95 125 ms
(20 sequential calls, Apple M3 Pro, macOS, Node v24.16.0). This is a
measurement, not a promise of density or speed.
