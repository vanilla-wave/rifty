# ADR 0568: Run guest files in a live sandbox whose state is filesystem bytes held by the consumer

Status: Accepted
Date: 2026-11

> TL;DR: `createSandbox()` gives the consumer a sandbox whose files are snapshot bytes it holds; the host edits them directly, and `exec(path)` is one ordinary pool call — a fresh isolate restores the bytes, runs `node <path>`, and hands back new bytes that replace the state only if the run ended on its own.

## Context

The live-sandbox goal (closed 2026-11-23; its invariants and scenario are §Invariants and
scenario below). User requirements (2026-11-17, via the
manager): host file ops read/list/write/change without binary loss, `exec`
narrowly `node <path>`, one instance through write → exec → error → fix →
exec, the host reading a binary result at a model-chosen path, realm-level
destroy, consumer docs; proposed form `create(template, snapshot?) / files /
exec / snapshot / destroy` over RPC. Recorded user decisions the model must
keep: «харденинг нужен только на внешнем шве: выставленные хостовые функции,
исходящий RPC, spawn наружу, передача результата» and «Владелец ФС живёт в том
же realm, что и гость (внутри isolate)» (stated as the reason SAB is not
needed). The state model's host-disk alternative was rejected by the user (§Not the user's words). Step 0
(`docs/backlog/distribution/reference/isolate-host-sandbox-step0.md`):
`new Array(2 ** 28).fill(0)` ends in V8's catastrophic OOM, an ICU flood
keeps the worker above its ceiling after its isolate is disposed; ivm copies a
view's whole backing buffer; rifty's program entry has diagnostic gaps and no
`require.main`.

## Decision

1. **API** (`src/index.ts`, plain data and bytes only, so it can move behind
   an RPC):
   - `createSandbox(options?) → Promise<Sandbox>`; `options.snapshot`
     (bytes, ADR-0567 format) restores; `maxFileBytes` (per host file op,
     `ERR_FS_FILE_TOO_LARGE`), `maxFsBytes` (the state cap, a host write past
     it `ERR_ISOLATE_HOST_SANDBOX_FULL`); `options.template` →
     `NotImplementedError('isolate-host.sandbox-template')`.
   - `writeFile(path, data: Uint8Array | string)` (string = UTF-8, parents
     created), `readFile(path) → Uint8Array`, `list(path = '/workspace') →
     {name, type: 'file' | 'directory', size}[]` sorted by name, `remove(path)`
     (a file or a directory tree). rifty's FS has no links (ADR-0050:
     `fs.symlink*`/`link*` throw `NotImplementedError`, ADR-0443 correction
     2026-11-22), so every
     entry is a file or a directory. A relative path resolves against
     `/workspace`; a NUL or a non-string → `ERR_INVALID_ARG_VALUE` /
     `ERR_INVALID_ARG_TYPE`; failures are Node-shaped (`code`, `syscall`,
     `path`, message) naming only sandbox paths.
   - `exec(path, {args?, timeoutMs?, memoryLimitMb?, maxOutputBytes?,
     allowSharedArrayBuffer?}) → RunCodeResult`: `node <path> [args]` with cwd
     `/workspace`; `runCode`'s option defaults and result shape, `exitCode:
     null` + `termination` for a killed run (ADR-0557 dated line 2026-11-22).
     `env`, `cwd`, `stdin` → `NotImplementedError('isolate-host.sandbox-exec-<option>')`.
     The path is one file path, never parsed as a command.
   - `snapshot() → Uint8Array` (ADR-0567 bytes, at a point of rest),
     `destroy()`.
2. **State.** Between operations a sandbox is its snapshot bytes in the
   consumer's process (ADR-0567 codec, decoded in the consumer realm into
   rifty's own `MemoryFsSync` for host file ops — no second implementation).
   A sandbox is lost only with its consumer process. rifty's filesystem exists only in a guest's isolate, during a
   run. No process or isolate is held by an idle sandbox.
3. **A run** is one call on the ADR-0563 pool: a fresh isolate restores the
   state before any guest code, runs the file through rifty's program entry,
   and after the run ends snapshots the filesystem; the worker sends the
   bytes as a frame before the terminal frame. On a terminal `exit` the
   consumer validates and decodes the bytes and they replace the state; on
   `timeout`, `memory` or a rejection the state stays as before the run
   (whole-run rollback; Node keeps partial writes — compat ⚠️). A run that
   ended on its own but whose end state is not kept — over the cap, out of
   isolate memory while capturing, a snapshot its own guest broke — resolves
   its own result plus `stateRefused: <code>`, state unchanged. The code is
   what the trusted side measured: the guest's codec is asked for anything
   the isolate can hold, so an end state over the cap comes out as bytes —
   the worker names `ERR_FS_SNAPSHOT_TOO_LARGE` for bytes over `maxFsBytes`,
   the consumer's codec for a budget over it — and `CAPTURE` for a capture
   that threw or returned no bytes (never reading the guest's text); the consumer names
   its codec's refusal of the bytes. Every way the worker ends a sandbox run
   itself (the `import()` gap, a broken guest tail) goes through one terminal
   that sends the state's fate first (refused `CAPTURE` when nothing was
   captured): a result
   of the guest's run, never a rejection (a guest cannot pose as
   infrastructure). A state its run cannot restore is the same field, before
   any guest code: `{stdout: '', stderr: '', exitCode: null, stateRefused}` —
   the isolate's memory while the state is decoded and copied in, or the
   worker's RSS crossing before guest code (the worker then holds the state);
   the isolate's own heap limit during the bundle's boot stays `memory`, as
   for `runCode`. The run's
   input is bytes, so ADR-0563 §6's rerun of a lost worker's calls stays
   idempotent and applies unchanged.
4. **One operation at a time.** Each sandbox runs its operations in call
   order, one at a time (a run replaces the whole state, so a host write
   during it would be lost). A run's `timeoutMs` counts from the moment it
   leaves the queue and covers restore, the run and the capture.
   Mechanism sweep (`fault-classes.md` §Class-kill): no ordering mechanism
   exists in `isolate-host`; the queue is one promise chain per sandbox, the
   only state owner. Sandboxes do not wait for each other.
5. **destroy** rejects queued and later operations
   `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`, cancels a run in flight (its
   isolate is disposed as at a deadline) and drops the state; it resolves once
   every call the sandbox placed has left: settled, and its isolate gone — the
   worker's `gone` frame (sent once the run both reported and unwound, on every
   end — exit, timeout, memory, refused state, cancel, a lost worker), or the
   worker's end. One event per call, registered with the sandbox when the call
   is created (the pool's `onStart`) and removed only by that event, so no
   phase of `exec` hands it from field to field (round 3: it was registered
   after the result, and a destroy in between returned with the isolate still
   running). A worker's slot frees on the same event (round 2: it freed at the
   result). Bounded: an isolate still on its worker 1 s after the result
   (ADR-0563 §4's stuck grace) retires that worker, which ends once its calls
   are settled. Carried as a table: every end × every destroy moment (before
   start, in flight, 0–3 microtasks after the result, after `await`), observed
   on the workers' CPU (`tests/sandbox-destroy-table.test.ts`). Every operation
   whose promise has not settled when `destroy()` is called rejects `DESTROYED`:
   one re-check in the last link of the operation queue, in the microtask that
   settles the caller's promise (round 4: a host op or a run already done could
   still hand the caller its data a microtask later); the table asserts what the
   caller got per operation and moment. A rollback was decided for round 4
   (manager 2026-11-23: another hole in isolate stopping → I5 rewritten weaker,
   with a number, a compat row and a user question); round 4 confirmed the
   isolate half by three independent runs and found the outcome half (fixed
   above), so the rollback was not taken.
6. **Limits.** Per run: `runCode`'s; `timeoutMs` covers the consumer's encode
   (done before the call registers, so a throw there settles the call and
   leaves no phantom), the worker's restore, run and capture — not the
   consumer's decode after (about one restore of the state). Host file op:
   `maxFileBytes` per call; every writing host op costs one encoding of the
   whole state (the cap check) — measured with the README's table, of one
   order with the intake of a run's state. `maxFsBytes` is in the codec's
   budget units (ADR-0567), and a run needs `memoryLimitMb` ≥ 2 × it + 16 MiB:
   the defaults 64 / 256 hold. `createSandbox` refuses `maxFsBytes` below the
   codec's cost of an empty sandbox (`ERR_OUT_OF_RANGE`, the number computed
   by the codec), so the empty state always encodes.
   The consumer's memory per concurrent run: at most 5 × S + 16 MiB (heap +
   ArrayBuffers; an upper bound over the measurements — 212 and 255 MiB at
   56 MB, round 2 — not a mean) for a state of S — the old FS, the encoded state (encoded again
   for a rerun, never kept by the call), its base64 written in pieces, the end
   state and the new FS until the swap (measured 2026-11-23: 6.7 S before those
   cuts); between operations a sandbox holds its FS (~400 B per entry plus its
   bytes). The README turns this into the service's cgroup rule.
   The capture is asked for up to the run's isolate memory so the trusted side
   can measure an over-cap state: a refused capture may cost the worker up to
   `memoryLimitMb` of copy (default 256 MiB, ~4 × the default cap), bounded and
   inside the worker's RSS ceiling.
   The sandbox's state: one cap, the codec's `maxBytes` count (ADR-0567
   refuses before allocating): an end state over it, or one the isolate runs
   out of memory capturing, is the named capture result of §3; a host write
   that would pass it rejects and leaves the files as they were, times included
   (the four times of the target and of every directory above it, restored on
   the rollback; PR #419, Greptile). No second quota inside the guest's FS (`REV-7`,
   manager 2026-11-22). The isolate limit alone does not bound the state: a
   guest fits 51 MiB of files at limit 64 (step 0) while capture peaks at
   ~2 × S (ADR-0567 P2). Defaults: `maxFsBytes` 64 MiB (a run needs ~2.3 × its
   state of isolate; `memoryLimitMb` defaults to 256), `maxFileBytes` 32 MiB.
7. **Trust.** Snapshot bytes from a run were produced in the guest's realm:
   hostile input, validated by the codec before they become state. Bounds:
   the copy out of the isolate is bounded by the run's `memoryLimitMb` (it is
   taken before its type and length are judged), the frame by `maxFsBytes`.
   Into the isolate the state crosses as an exact buffer. Host bytes in and
   out (`writeFile`, `readFile`, `snapshot()`, `createSandbox({snapshot})`)
   are exact copies, sizes checked before the copy. Errors leaving the API
   carry their first line as `stack`.
   Text crossing to the host: host-op errors are built in the consumer from
   a code and a sandbox path (`code`, `syscall`, `path`, message); a run's
   text is its own stdout/stderr; `stateRefused` is a fixed code chosen by the
   worker or the consumer (`ERR_ISOLATE_HOST_SANDBOX_RESTORE`,
   `ERR_ISOLATE_HOST_SANDBOX_CAPTURE`, `ERR_FS_SNAPSHOT_TOO_LARGE`, or the
   consumer codec's `ERR_FS_SNAPSHOT_*`).
8. **`runCode`** keeps its API, results, corpus and pool behavior, with one
   change shared with sandboxes (2026-11-22): a fresh guest FS also holds
   `/tmp`, rifty's `os.tmpdir()` (`GUEST_DIRS`), so writing there works as in
   Node (corpus `os-tmpdir-is-writable`). A
   sandbox run is a pool call with state in and out, not a second lifecycle.

## Alternatives (for the critic; surfaces, not a verdict)

- **A. State = bytes in the consumer** (this ADR). Seam: bytes and plain data
  across the isolate; the codec decodes guest-produced bytes in the consumer.
  Lost per outcome: a killed or lost run's partial writes (rollback). Density:
  an idle sandbox = its bytes; a run = a pool slot (4 per worker). Cost per
  run: restore + snapshot, linear in the files; at the requirements' template
  scale (23 654 files, 95 MB): export 0.62 s + import 0.53 s in the isolate,
  ~95 MB each way on the wire, a consumer-side decode, and an isolate floor of
  ~205 MiB before guest code (ADR-0567 P1/P2) — unless a template layer keeps
  the immutable part out of the per-run state (the template goal's).
- **B. A directory on the host disk per sandbox, reached through the bridge.**
  Seam: every guest `fs` call becomes a host `node:fs` call with a
  guest-chosen path, so a jail over `node:fs` becomes load-bearing (links,
  name case/normalization, OS stat values and error texts with host paths,
  quota as disk accounting); the guest leaves rifty's VFS for an OS-dependent
  one. Lost per outcome: nothing a killed process would not lose (partial
  writes kept). Density: an idle sandbox = its directory; a run = a solo
  worker (no rerun: not idempotent). Cost: per syscall. Rejected by the user,
  2026-11-22: «все правильно, не нужно давать настоящую fs».
- **A′. A live isolate per agent run, bytes only as a restore point.**
  Closest to the requirements' wording (one instance per agent run, restore
  once). Not chosen: a run must be a fresh realm (globals, module cache,
  timers of one `node` process never reach the next — I2), which a live
  isolate gives only by a new context per run over the same heap; a lost
  worker's run cannot be rerun idempotently; a sandbox pins a worker slot
  while idle; a heap-limit or catastrophic end takes the files back to the
  last restore point anyway. For the consumer the contract is the same: one
  sandbox per agent run; restore per run is internal (the manager's reading
  of the user's words, §Not the user's words). Revisit with the template goal.
- **C. In-memory VFS in a per-sandbox worker or long-lived isolate.**
  Rejected: catastrophic OOM / ICU retention / heap-limit disposal lose the
  files (step 0 S1).
- **D. Build `runCode` on the sandbox.** Rejected: no consumer needs it, and
  it adds a state round trip to every `runCode` call — against «`runCode`
  does not change» (the goal's Outcome).

## Invariants and scenario

The goal's `## User scenario` and `## Invariants`, verbatim (the goal closed
2026-11-23; tests cite them as "scenario N" and I1–I9). What the goal decided or
the code refined since is not folded in: the user's words and the manager's
reading are in §Not the user's words (behavior divergences from Node, the
lifecycle class), the code's refinements in §Decision (§5: an operation not yet
settled when `destroy()` is called rejects; §6: `timeoutMs` covers the consumer's
encode; a refused host write leaves the files as they were, times included).
Carriers: `packages/isolate-host/tests/sandbox-acceptance.test.ts` (scenario,
corpus vs live Node), `sandbox-faults.test.ts`, `sandbox-destroy-table.test.ts`,
`protocol.test.ts`.

### User scenario

1. The agent's host creates a sandbox and writes `/workspace/main.js` (the
   model's code) and an input file with binary bytes.
2. It runs `exec('main.js')`. The code has a bug: the result is exit 1 with
   the error on stderr, as `node main.js` reports it in a directory holding
   the same files.
3. The model fixes the file; the host writes it; `exec('main.js', {args})`
   now writes `out.pdf` (binary) at a path the model chose and exits 0. The
   host reads `out.pdf`: the bytes real `node main.js` writes from the same
   files.
4. Another fix introduces an endless loop, then a memory blow-up: the runs
   end `termination: 'timeout'` and `'memory'`; the sandbox and its files are
   still there; the next fix runs clean.
5. Between runs nothing but files carries over: globals, module cache,
   timers, `process.exitCode`, listeners and the cwd of one run are not seen
   by the next — as with consecutive `node main.js` processes.
6. Writes of the host and runs of the guest on one sandbox, issued without
   waiting for each other, take effect one at a time in call order.
7. The host destroys the sandbox, also in the middle of a run: the run and
   anything still pending reject with a distinct code, and nothing of the
   sandbox remains.
8. A model-chosen path or size the host refuses (a file over the per-file
   limit, an invalid path) is a loud Node-shaped error that names only
   sandbox paths; the guest of one sandbox cannot see another sandbox's
   files.
9. Before destroying, the host takes `snapshot()`; a sandbox created later
   from those bytes runs `main.js` and sees the same files.
10. The service owner reads the package README: how to connect, the API, the
   limits, what is not there.

### Invariants

- I1. No ending of a run loses the sandbox. A run that ends on its own —
  exit 0 or N, `process.exit`, an uncaught throw or rejection — leaves
  exactly the files it had at its end. A run that is killed (`timeout`,
  `memory`) or rejects (its worker lost) leaves exactly the files of before
  it: whole-run rollback, never a partial state (Node would keep the partial
  writes: declared, compat ⚠️). The host and the next run see that state.
  A run that ended on its own but whose end state cannot be kept (over the
  cap, too large for its isolate to capture, a guest that broke its own
  snapshot) resolves with its own output and exit code plus a field naming
  why its state was refused, and leaves the state of before it: a result of
  the guest's run, never a rejection that reads as infrastructure (I7). A
  state the run cannot restore is refused before any guest code, named the
  same way (empty output, `exitCode: null`). Under this model a sandbox is lost only
  with its consumer process (the requirements' rollback to the last saved
  archive).
- I2. `node <path>` fidelity in sequences: a sequence of `exec(path, {args})`
  over one sandbox gives, run by run, the stdout, stderr, exit code and files
  of the same sequence of `node <path> [args]` processes over the same files in
  a temporary directory (its path read as `/workspace`): relative `require`,
  JSON, `__filename`, `__dirname`, `process.argv`, `require.main`, relative
  paths, uncaught errors with file-path frames, a syntax error in the entry
  and in a dependency. Only files carry from one run to the next. A
  divergence is loud (`NotImplementedError` + compat row) or, for the text of
  a diagnostic only, a pinned ⚠️ row owned by the runtime-js diagnostics goal;
  a run never silently does something else (exit 0 where Node does work).
- I3. Host file ops are exact: `writeFile`/`readFile`/`list`/`remove` move
  bytes unchanged (binary, empty, large up to the limit), see exactly what
  the guest's runs left and are seen by the next run.
- I4. One operation at a time: operations on one sandbox issued without
  awaiting each other take effect one at a time in call order.
- I5. End of life is loud and total: once `destroy()` resolves, no isolate of
  the sandbox runs and its state is unreachable; every operation in flight,
  queued or later rejects `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`.
- I6. Bounded: each run has `runCode`'s limits and hardening (time, isolate
  memory, output cap, no network); its `timeoutMs` runs from the moment it
  leaves the queue and covers restore, the run and the capture; a
  sandbox's state is bounded by one cap, one rule: a run whose end state is
  over it (or cannot be captured) is I1's named result, a host write that
  would pass it rejects; each host file op is bounded
  by a per-file limit; the consumer process survives every outcome; an idle
  sandbox holds no process and no isolate, its memory in the consumer is
  measured and documented (the number of live sandboxes is the consumer's to
  cap), and a sandbox the consumer drops leaves nothing behind.
- I7. Trust boundary, decided on the host side: model-chosen paths and bytes
  of host file ops stay inside the sandbox's own files; bytes a run hands back
  are hostile input to the consumer and are validated before they become the
  sandbox's state; a guest of one sandbox cannot read or write another
  sandbox's files (canary); an error reaching the host names only sandbox
  paths and carries no host text; the guest cannot make its run read as an
  infrastructure failure; bytes cross the bridge as their view's range only.
- I8. Plain-data API, documented: every argument and result of the sandbox
  API is a string, number, boolean, plain object/array or `Uint8Array`; the
  package README documents connection, the API, limits and gaps; compat rows
  name every gap.
- I9. Snapshot round trip: `snapshot()` taken with no run in flight
  returns bytes (the snapshot goal's format) holding exactly the sandbox's
  files; `createSandbox({ snapshot })` from them gives a sandbox whose host
  ops and runs see the same files; it waits its turn behind earlier
  operations (I4) and never captures a run's partial state.

## Consequences

- Cost per run (ADR-0567's codec, M3 Pro, median of 5, the snapshot thread's
  measure): 10 files / 958 kB — consumer snapshot + restore 0.8 + 0.8 ms,
  isolate restore + snapshot 2.2 + 1.1 ms, isolate peak 19 MiB (empty guest
  15). Template scale (23 654 files / 100.6 MB): consumer 143 + 164 ms, isolate
  174 + 132 ms, an isolate limit of at least 231 MiB (≈ 2.3 × S) before guest
  code. While an immutable template layer is part of a run's state, every run
  pays that: the template goal must keep the layer out of the per-run state or
  bring this fork back to the user. The same holds for host writes: each
  encodes the whole state for its cap check, so with a template layer in the
  state every host write would cost hundreds of milliseconds.

- An idle sandbox holds no process or isolate; a forgotten one is ordinary
  garbage.
- A killed run's partial writes are lost (declared ⚠️).
- Every run pays restore + snapshot, linear in the sandbox's files.
- Decisions recorded on ADR-0558 (guest contract: a program entry, restore and
  snapshot) and ADR-0563 (a call with state frames).

## Not the user's words

The user, 2026-11-22 (asked whether the guest should get a directory on the host disk): «все
правильно, не нужно давать настоящую fs» — no real filesystem for the guest; alternative B is the
user's rejection.

The user, 2026-11-23, asked by the manager «Песочница: принять три расхождения с Node как
объявленные ⚠️ или держать цель открытой до починки? Рекомендую принять.» after a table of the
three — (1) work queued at `process.exit()` runs and its file stays in the state; (2) a microtask
from an `'exit'` handler after an explicit `exit()` runs and may write a file; (3) an uncaught
throw with an endless microtask chain ends as a timeout with its writes rolled back, Node exits 1
with them kept: «ок». The manager's reading, not the user's words: «ок» accepts the
recommendation; the three stay declared ⚠️ and the goal's decision line «the same holds for
anything found in the class "a run silently does something else"» no longer gates the close for
them. Their records: (1), (2) `runtime-js/node-eval-work-queued-at-exit-runs` (and the untried
lead `distribution/isolate-host-sandbox-capture-at-process-terminal`); (3)
`distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint`. The question covered
three members of a wider class (`docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class.md`).

The user, 2026-11-17 (requirements, quoted in the goal's state-model line): «в пределах одного
прогона агента один экземпляр живёт через write → exec → ошибка → fix → exec. Следующий прогон…
новый экземпляр из шаблона + восстановленных файлов». The manager's reading, not the user's words
(2026-11-22): one sandbox per agent run is the contract kept; a restore per run is internal to it
(alternative A′).

Manager decisions by delegation (2026-11-22), not the user's words: a restore and a capture per run
with a killed run rolled back, and the per-run cost while a template layer is part of the state; one
size mechanism (the codec's count, no quota inside the guest FS); the killed-run shape `exitCode:
null` + `termination` (ADR-0557 dated line 2026-11-22).

Agent decisions: the API names and defaults, `stateRefused` as a result field, one operation at a
time per sandbox with the deadline from dequeue, `/workspace` and `/tmp` in a fresh FS, `env`/`cwd`/
`stdin` as loud gaps.

## Corrections

- 2026-11-23 — Consequences «an isolate limit of at least 231 MiB (≈ 2.3 × S) before guest code»: superseded by ADR-0567 §7 (goal `isolate-host-fs-snapshot` close, PR #422) — a run's restore → run → snapshot needs 223–225 MiB at template scale; only a snapshot straight after a restore with no guest code between needs up to ~3 × the bytes (`distribution/isolate-host-fs-snapshot-restore-then-snapshot-peak`).
