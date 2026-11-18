# @riftydev/isolate-guest

> **Unstable.** The bridge contract below may change in any release, a patch
> included, until it is declared stable. Pin the exact version, and take the
> bundle and the host-side functions from that same version. Decision:
> ADR-0558.

rifty's guest for your own V8 isolate. It runs code like `node -e <code>`
inside an isolate you create, with your own isolated-vm and your own process
topology. rifty's own host (`@riftydev/isolate-host`, `runCode`) runs on this
same package. The package has no dependencies and loads no native addon.

It gives you:

- `@riftydev/isolate-guest/guest.js`: the guest bundle, one classic script
  (~7 MB) with rifty's runtime and a Web shim for bare V8;
- `createHostBridge(hooks)`: the host functions the guest calls, with every
  argument validated;
- `exitStatus(value)`, `IMPORT_GAP`, `UNCOPYABLE_REJECTION`, and the types
  `GuestHost`, `GuestEntry`, `HostFunctions`, `HostHooks`, `HostBridge`.

## Minimal embedder (isolated-vm 7.0.2)

```js
import { readFileSync } from 'node:fs';
import ivm from 'isolated-vm';
import {
  IMPORT_GAP,
  UNCOPYABLE_REJECTION,
  createHostBridge,
  exitStatus,
} from '@riftydev/isolate-guest';

// isolated-vm < 7 lacks two hooks this contract needs and ignores unknown options silently.
const ivmVersion = JSON.parse(
  readFileSync(new URL(import.meta.resolve('isolated-vm/package.json')), 'utf8'),
).version;
if (Number(ivmVersion.split('.')[0]) < 7) throw new Error(`isolated-vm ${ivmVersion}: need >= 7`);

const bundle = readFileSync(
  new URL(import.meta.resolve('@riftydev/isolate-guest/guest.js')),
  'utf8',
);

/** One call: a fresh isolate runs `code` like `node -e`, then is disposed. */
export async function run(code) {
  const out = { 1: [], 2: [] };
  let ended = false;
  let settle;
  let fail;
  const result = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const end = (exitCode) => {
    ended = true;
    settle(exitCode);
  };
  let guest;
  const { functions, timeOrigin, close } = createHostBridge({
    write: (fd, bytes) => out[fd].push(Buffer.from(bytes)),
    fire: (id) => guest.fire.applyIgnored(undefined, [id]),
  });
  const isolate = new ivm.Isolate({
    memoryLimit: 128,
    // `import()` is a declared gap: the run ends here, whatever the guest does next.
    importModuleDynamically: () => {
      if (!ended) out[2].push(Buffer.from(`Error: ${IMPORT_GAP}\n`));
      end(1);
      throw Object.assign(new Error(IMPORT_GAP), { stack: `Error: ${IMPORT_GAP}` });
    },
    onUnhandledRejection: (reason) => {
      try {
        guest.rejection.applyIgnored(undefined, [reason], { arguments: { copy: true } });
      } catch {
        guest.rejection.applyIgnored(undefined, [UNCOPYABLE_REJECTION]);
      }
    },
  });
  try {
    const context = await isolate.createContext();
    const names = Object.keys(functions);
    await context.evalClosure(
      `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names
        .map((name, i) => `${name}: $${i}`)
        .join(', ')} };`,
      names.map((name) => new ivm.Callback(functions[name])),
    );
    const script = await isolate.compileScript(bundle, { filename: 'rifty-isolate-guest.js' });
    await script.run(context);
    // Taken before any guest code runs, then removed from the guest's realm.
    const entry = await context.global.get('__riftyGuest', { reference: true });
    guest = {
      fire: await entry.get('fire', { reference: true }),
      rejection: await entry.get('rejection', { reference: true }),
    };
    const start = await entry.get('run', { reference: true });
    await context.global.delete('__riftyGuest');
    start
      .apply(undefined, [code], { arguments: { copy: true }, result: { promise: true, copy: true } })
      .then(
        (status) => end(exitStatus(status)),
        // A disposed isolate is your memory limit, not the guest's exit.
        () => (isolate.isDisposed ? fail(new Error('isolate disposed')) : end(1)),
      );
    const exitCode = await result;
    const text = (fd) => Buffer.concat(out[fd]).toString('utf8');
    return { stdout: text(1), stderr: text(2), exitCode };
  } finally {
    close();
    if (!isolate.isDisposed) isolate.dispose();
  }
}
```

Start your process with `node --no-node-snapshot` (isolated-vm's own
requirement on Node ≥ 20).

**This example has no limits, so one guest line takes your service down.**
Measured in cross-review (2026-11-18, isolated-vm 7.0.2, Node 24):
`while (true) {}` hangs `run()` forever; 3 GB of stdout grow the embedder to
7.3 GB RSS; `new Array(1e9).fill({})` aborts the process (SIGABRT). The
example runs isolates in your own process, which ADR-0557 rejected for rifty's
own host. For untrusted code, the protected path is `runCode` from
`@riftydev/isolate-host`: it adds the limits and a child process per call.
Your own topology is your choice and your responsibility.

## Contract

The guest is hostile. Everything it hands you is input you validate.

### Host functions: `globalThis.__riftyIsolateHost`

You set this global to an object before the bundle runs. The bundle captures it
and deletes it before any guest code runs. Each function must be callable from
the guest realm and must receive copies of its arguments, never live guest
objects. Return values must be copies too, and no host object may reach the
guest. `createHostBridge` performs every check in the last column. If you write
your own, you must perform them yourself.

| member | arguments, controlled by | what the embedder must check / does |
|---|---|---|
| `write(fd, bytes)` | `fd`, `bytes`: guest | `fd` is `1` or `2`, `bytes` is a `Uint8Array` of your realm; then your `write` hook. Size is unbounded: cap the output yourself |
| `timerStart(id, ms, repeat)` | all: guest | `id` an integer in 1..2^31-1, `ms` a number in 0..2^31-1, `repeat` a boolean; re-arming an `id` replaces it; on expiry call `fire(id)`. The number of timers is unbounded: bound it with your limits |
| `timerClear(id)` | `id`: guest | `id` as above; an unknown `id` is a no-op |
| `now()` | none | returns ms since `timeOrigin`, the start of this call |
| `random(byteLength)` | `byteLength`: guest | an integer in 0..65536; returns that many random bytes |
| `timeOrigin` | you | a number: the call's start in epoch ms (`createHostBridge` returns it). Never your process's `performance.timeOrigin`: the guest would read your uptime and could link calls |

The `write` and `fire` hooks must be synchronous: a promise they return is not
awaited, and its rejection is yours.

A refused call throws a `TypeError` starting `isolate-host bridge: `, with no
host stack. A hook that throws reaches the guest as `isolate-host bridge: <name>
failed`. A `fire` hook that throws ends that timer, and nothing reaches your
event loop. `close()` ends the call: it clears every timer, and after it
`timerStart` arms nothing.

Timer expiries queue in your process, not in the isolate. A host timer that
fires while the guest is still busy queues its `fire` call. Neither
`memoryLimit` nor the guest bounds that queue. A slow interval falls behind
(`setInterval` of a 10 ms callback at 1 ms: Node runs it 101 times in the
first second; through this bridge it runs 879 times and a 1000 ms timeout
fires at 8.8 s). Many short intervals grow your process's memory: 20000 of
them reached 4.96 GB RSS at `memoryLimit: 128`.

### Guest entry: `globalThis.__riftyGuest`

The bundle defines this global. You take its three functions before you call
`run`, then delete the global.

| function | called by | arguments, controlled by | what the embedder must check |
|---|---|---|---|
| `run(code)` | you, once | `code`: you | the promise's value is guest-controlled: pass it through `exitStatus(value)` (an integer 0..255, else 1). A rejection while the isolate is alive is exit 1 |
| `fire(id)` | your `fire` hook | `id`: armed by the guest | none (`createHostBridge` fires only ids it armed) |
| `rejection(reason)` | your unhandled-rejection hook | `reason`: guest | send a copy. If it cannot be copied (a function-bearing object, a symbol), send `UNCOPYABLE_REJECTION` |

### Lifecycle of one call

1. Create a fresh context. Nothing may carry over from an earlier call.
2. Set `__riftyIsolateHost`.
3. Run the bundle as a classic script named `rifty-isolate-guest.js`. Guest
   stack frames show this name, as in `runCode`.
4. Take `__riftyGuest` and delete it.
5. Call `run(code)`.
6. Deliver timer expiries and unhandled rejections until the call ends.
7. The call ends at the first of these: `run` settles (`exitStatus`), a guest
   `import()` (stderr gets `Error: ${IMPORT_GAP}`, exit 1), or your own limit.
8. Drop whatever the guest writes after that, call `close()`, dispose the
   isolate.

### Embedder hooks

The guest cannot see two events itself. Your embedder has to report them:

- `onUnhandledRejection` (isolated-vm option): deliver each one to
  `rejection`. This is how `Promise.reject(new Error('x'))` fails the run with
  Node's diagnostic and exit 1.
- `importModuleDynamically` (isolated-vm option): end the run as in step 7.
  The guest may never see the rejection: it can swallow it, or exit first.

## What you own

rifty's host makes the guarantees in `@riftydev/isolate-host` (ADR-0557). None
of them hold for your integration unless you provide them:

- limits: wall-clock time, isolate heap, process RSS, output bytes, timer count;
- the kill of a runaway call, and a result for it;
- the process boundary: rifty's host keeps your process free of isolated-vm
  and runs each call in a clean-env child;
- the isolate-escape posture: a V8 or isolated-vm bug gives the guest code
  execution in the process that holds the isolate. Put that process behind a
  separate uid, a sandbox or container, and an RSS cgroup, with no secrets
  reachable from it (`docs/public/trust-model.md` §Isolate host);
- argument validation, if you replace `createHostBridge` with your own code.

What the guest gets is rifty's Node environment: the same surface and the same
declared gaps as `runCode` (`docs/public/compat/isolate-host.md`).

## isolated-vm versions and other embedders

Tested: isolated-vm 7.0.2 on Node 24. The example above runs the isolate-host
parity corpus with the same result as `node -e`
(`tests/embedder.test.ts`).

isolated-vm 6.2.0 has neither `onUnhandledRejection` nor
`importModuleDynamically`. Measured on Node v24.16.0, a guest loses two
behaviors there:

- An unhandled rejection does not fail the run with Node's diagnostic.
  Instead, the embedder's pending `eval`/`apply` call rejects with the reason.
- `import()` rejects in the guest with `Not supported`. A `.catch` keeps the
  run alive, and the run can exit 0.

Other embedders are untested. The contract is written for any V8 embedder that
can copy values across the boundary and report both events.

## Versions

`0.x` and unstable: any release may change the global names, the members,
their argument ranges, the lifecycle or the bundle, with a CHANGELOG line.
Use the bundle and `createHostBridge` from one installed version. There is no
compatibility between versions, and nothing detects a mismatch at run time.

## Install (dev)

The package is not on npm yet. In the rifty checkout:

```sh
pnpm install && pnpm --filter @riftydev/isolate-guest build
cd packages/isolate-guest && pnpm pack     # → riftydev-isolate-guest-0.1.0.tgz
```

In your service, run `npm install /path/to/riftydev-isolate-guest-0.1.0.tgz`
together with your own `isolated-vm`. Node ≥ 24, ESM.
