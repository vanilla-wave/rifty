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
  `GuestHost`, `GuestEntry`, `HostFunctions`, `HostHooks`, `HostBridge`;
- the FS snapshot (§Snapshot): `snapshotFs`, `restoreFs`, `FsSnapshotError`
  and the types `SnapshotFs`, `SnapshotOptions`, `SnapshotStat`,
  `SnapshotTemplate`, `FsSnapshotErrorCode`.

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
export async function run(code, { allowSharedArrayBuffer = true } = {}) {
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
    // The call's result ends with it (step 8): later guest output is dropped.
    write: (fd, bytes) => ended || out[fd].push(Buffer.from(bytes)),
    // Settles when the guest ran the callback: an interval re-arms only then.
    fire: (id) => guest.fire.apply(undefined, [id]),
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
      `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, allowSharedArrayBuffer: $0, ${names
        .map((name, i) => `${name}: $${i + 1}`)
        .join(', ')} };`,
      [allowSharedArrayBuffer, ...names.map((name) => new ivm.Callback(functions[name]))],
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
`@riftydev/isolate-host`: it adds the limits and runs isolates in its own worker processes.
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
| `allowSharedArrayBuffer?` | you | boolean, default true. False removes the global (`typeof SharedArrayBuffer === 'undefined'`), as in Node with `--enable-sharedarraybuffer-per-context`. Requesting a shared wasm backing buffer throws `NotImplementedError('isolate-host.SharedArrayBuffer')`. Use a fresh pristine context and supply only the specified bridge values with ordinary backing stores. |
| `timeOrigin` | you | a number: the call's start in epoch ms (`createHostBridge` returns it). Never your process's `performance.timeOrigin`: the guest would read your uptime and could link calls |

The `write` hook must be synchronous: a promise it returns is not awaited, and
its rejection is yours. The `fire` hook returns a promise that settles once the
guest ran the callback (isolated-vm: `Reference.apply`, not `applyIgnored`).
A repeating timer re-arms only after it settles, so expiries never pile up
behind a busy guest, and its next expiry keeps Node's period from the tick's
start (an overrun ticks again at once). A hook that returns no promise
re-arms at once and gets no such bound.

A refused call throws a `TypeError` starting `isolate-host bridge: `, with no
host stack. A hook that throws reaches the guest as `isolate-host bridge: <name>
failed`. A `fire` hook that throws or whose promise rejects ends that timer, and
nothing reaches your event loop. `close()` ends the call: it clears every timer, and after it
`timerStart` arms nothing.

Timer expiries queue in your process, not in the isolate: at most one `fire`
per armed timer is in flight, so the queue is bounded by the guest's own
timers, each of which lives in its heap.

isolated-vm does not count some guest memory against `memoryLimit`: wasm
memory, resizable/growable buffers (`maxByteLength`), Intl/ICU data, host
timers. Bound your process from outside (measured: `docs/backlog/distribution/reference/isolate-host-pool-step0.md`).

### Guest entry: `globalThis.__riftyGuest`

The bundle defines this global. You take its functions before you call
`run`, then delete the global.

| function | called by | arguments, controlled by | what the embedder must check |
|---|---|---|---|
| `run(code)` | you, once | `code`: you | the promise's value is guest-controlled: pass it through `exitStatus(value)` (an integer 0..255, else 1). A rejection while the isolate is alive is exit 1 |
| `fire(id)` | your `fire` hook | `id`: armed by the guest | none (`createHostBridge` fires only ids it armed) |
| `rejection(reason)` | your unhandled-rejection hook | `reason`: guest | send a copy. If it cannot be copied (a function-bearing object, a symbol), send `UNCOPYABLE_REJECTION` |
| `restore(bytes, options)` | you, before `run` | `bytes`: a snapshot, once written by a guest | copy exactly the bytes' range in (isolated-vm copies a view's whole backing store). Throws `ERR_FS_SNAPSHOT_*` (§Snapshot); `ERR_FS_SNAPSHOT_NOT_FRESH` once `run` was called |
| `snapshot(options)` | you, whenever no guest code runs (after `run` settled included) | — | after `run` the result is guest-authored: bound it by `memoryLimit`, accept it only through `restoreFs` |

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

## Snapshot

The guest's whole in-memory FS as one opaque byte string, and back (ADR-0567).
**After `ERR_FS_SNAPSHOT_INCOMPLETE` the target FS is partial: discard it.**
In the isolate `run`, `snapshot` and `restore` then refuse with that code;
in your realm nothing stops a later `snapshotFs` of that FS from returning a
valid blob of the partial tree, so never snapshot it. The same module runs in
the isolate (inside `guest.js`) and in your Node realm, over rifty's
`MemoryFsSync` (or any `SnapshotFs`):

```js
const options = { template: { id: 'docs-libs', version: '2026.11.1' }, maxBytes: 256 << 20 };
const bytes = await guest.snapshot.apply(undefined, [options], {
  arguments: { copy: true },
  result: { copy: true },
});
// … store bytes; next turn, a fresh isolate, before run:
await guest.restore.apply(undefined, [new Uint8Array(bytes), options], { arguments: { copy: true } });
```

- **Kept:** every path from `/`, file bytes, empty directories, any name of
  up to 16 383 code units without NUL (lone surrogates included), `mtime`,
  `atime`, `ctime`, `birthtime` within the Date range. **Renewed:** `ino`, as after a copy. rifty's FS has no
  symlinks, hard links, modes or owners, so there is nothing of them to keep.
- **Format:** versioned and template-bound; a later rifty reads every
  version released before it, an older one refuses a newer version
  (`ERR_FS_SNAPSHOT_VERSION`). Restore requires the template it was made
  with (`ERR_FS_SNAPSHOT_TEMPLATE`). The same tree gives the same bytes.
- **Restore** checks every byte before it writes anything, then replaces the
  whole FS. A refused blob (`ERR_FS_SNAPSHOT_CORRUPT` — truncated, a flipped
  byte, a bad path, a duplicate…; `ERR_FS_SNAPSHOT_TOO_LARGE` before reading)
  leaves the FS as it was. Error text carries no blob bytes. A restore that
  fails *while writing* (memory) throws `ERR_FS_SNAPSHOT_INCOMPLETE`: the FS
  is partial. Discard it — in the isolate `run`, `snapshot` and `restore`
  then refuse with the same code; dispose the isolate.
- **Snapshot** refuses a tree the format cannot carry
  (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`: a name over 16 383 code units or with
  NUL, a time not finite or outside the Date range): it never writes what
  restore would refuse. A sandbox run whose guest created such a state cannot
  save it. V8 hashes strings over 16 383 units by length alone, so longer
  names would make directory maps quadratic.
- **After guest code** the realm is the guest's: `snapshot` may return
  anything, hang, or throw an error whose text the guest chose. Give the call
  a deadline, never show its error text as your own, and accept its bytes
  only through `restoreFs`, which relies on nothing the writer promises.
- **Budget:** `maxBytes` (required both ways) counts the blob's bytes + 384
  per entry + 8 per code unit of each entry's path + 80 per level of its
  depth, so a blob dense in entries, depth or long names is bounded like one
  dense in bytes. The memory limit either direction needs (isolate
  `memoryLimit`, or the heap limit in your realm) is ≈ 2 × bytes + ~680 B ×
  entries + 15 MiB — under 2 × `maxBytes` + 16 MiB for any blob a budget
  admits. Time: the densest blob a budget admits takes ~2 ms per MiB of
  budget in either realm, flat, deep, long-named or mixed (table below). A snapshot right after a restore, with
  no guest code between, can need ~3 × the bytes (the restored blob is not
  yet collected: 231–322 MiB at template scale). An allocation the limit
  refuses is `ERR_FS_SNAPSHOT_TOO_LARGE` (snapshot) or `_INCOMPLETE`
  (restore); an isolate the limit kills outright is your memory termination.
- **Crossing into the isolate:** isolated-vm copies the `bytes` argument
  before `restore` runs; if that copy fails (the blob does not fit the
  isolate), the error is isolated-vm's own, unnamed — `restore` never ran and
  the FS is untouched.

Cost (M3 Pro, Node 24.16.0, isolated-vm 7.0.2, median of 5,
`node --no-node-snapshot scripts/measure-snapshot.mjs`; not measured on Linux):

| tree | blob | Node snapshot / restore | isolate restore / snapshot | ivm copy in / out | smallest `memoryLimit`: restore → `run` → snapshot |
|---|---|---|---|---|---|
| 10 files, 958 kB | 962 kB | 0.8 / 0.8 ms | 2.3 / 1.2 ms | 0.1 / 0.2 ms | 19 MiB (empty guest 15) |
| 23 654 files, 100.6 MB | 102.9 MB | 142 / 161 ms | 173 / 138 ms | 10 / 5.2 ms | 223 MiB |

Densest blobs a 64 MiB budget admits (restore, Node / isolate; smallest
isolate `memoryLimit`; measured at load 57–130 on 12 cores):

| shape | entries | blob | restore | `memoryLimit` |
|---|---|---|---|---|
| flat empty directories | 122 665 | 5.7 MB | 120 / 116 ms | 95 MiB (+49 MiB retained heap in Node) |
| deepest chain `/a/a/…` | 1 154 | 2.7 MB | 146 / 120 ms | 19 MiB |
| 300-level chain + directories at its bottom | 2 346 | 2.7 MB | 136 / 130 ms | 19 MiB |
| 16 383-unit names under a 16 383-unit directory | 205 | 13.3 MB | 87 / 79 ms | 31 MiB |

The template scale above needs a budget of 142.2 MB (102.9 MB + 384 × 26 300
entries + 8 × their path units + 80 × their depths).

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
(`tests/embedder.test.ts`), except one gap of isolated-vm itself: it keeps an
unhandled rejection by weak handle, so when a GC collects the rejected promise
before its task ends, `onUnhandledRejection` never fires and the run exits 0
with an empty stderr where Node exits 1
(https://github.com/laverdet/isolated-vm/issues/589). Your embedder cannot see
it happen; guest code avoids it by handling every promise
(`docs/public/compat/isolate-host.md`).

isolated-vm 6.2.0 has neither `onUnhandledRejection` nor
`importModuleDynamically`. Measured on Node v24.16.0, a guest loses two
behaviors there:

- An unhandled rejection does not fail the run with Node's diagnostic.
  Instead, the embedder's pending `eval`/`apply` call rejects with the reason —
  or, after a GC collected the promise, settles normally (the same weak record;
  measured on 7.0.2 without the hook, 6.2.0 has the same code).
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
