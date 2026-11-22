# ADR 0568: Run guest files in a live sandbox whose state is filesystem bytes held by the consumer

Status: Proposed
Date: 2026-11

> TL;DR: `createSandbox()` gives the consumer a sandbox whose files are snapshot bytes it holds; the host edits them directly, and `exec(path)` is one ordinary pool call — a fresh isolate restores the bytes, runs `node <path>`, and hands back new bytes that replace the state only if the run ended on its own.

## Context

Goal `isolate-host-live-sandbox`. User requirements (2026-11-17, via the
manager): host file ops read/list/write/change without binary loss, `exec`
narrowly `node <path>`, one instance through write → exec → error → fix →
exec, the host reading a binary result at a model-chosen path, realm-level
destroy, consumer docs; proposed form `create(template, snapshot?) / files /
exec / snapshot / destroy` over RPC. Recorded user decisions the model must
keep: «харденинг нужен только на внешнем шве: выставленные хостовые функции,
исходящий RPC, spawn наружу, передача результата» and «Владелец ФС живёт в том
же realm, что и гость (внутри isolate)» (stated as the reason SAB is not
needed). The state model is a user fork carried by the manager; this ADR
records the manager's default. Step 0
(`docs/backlog/distribution/reference/isolate-host-sandbox-step0.md`):
`new Array(2 ** 28).fill(0)` ends in V8's catastrophic OOM, an ICU flood
keeps the worker above its ceiling after its isolate is disposed; ivm copies a
view's whole backing buffer; rifty's program entry has diagnostic gaps and no
`require.main`.

## Decision

Draft — open items are marked *open*.

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
     `fs.symlinkSync`/`linkSync` absent in the guest, compat ❌), so every
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
   its own result plus `stateRefused: <code>` (the codec's
   `ERR_FS_SNAPSHOT_*`, or the capture's own code), state unchanged: a result
   of the guest's run, never a rejection (a guest cannot pose as
   infrastructure). A state its run cannot restore is the same field, before
   any guest code. The run's
   input is bytes, so ADR-0563 §6's rerun of a lost worker's calls stays
   idempotent and applies unchanged.
4. **One operation at a time.** Each sandbox runs its operations in call
   order, one at a time (a run replaces the whole state, so a host write
   during it would be lost). A run's `timeoutMs` counts from the moment it
   leaves the queue and covers restore, the run and the capture.
   *open:* mechanism sweep (`fault-classes.md` §Class-kill) before the
   per-sandbox FIFO lands.
5. **destroy** rejects queued and later operations
   `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`, cancels a run in flight (its
   isolate is disposed as at a deadline) and drops the state.
6. **Limits.** Per run: `runCode`'s. Host file op: `maxFileBytes` per call.
   The sandbox's state: one cap, the codec's `maxBytes` count (ADR-0567
   refuses before allocating): an end state over it, or one the isolate runs
   out of memory capturing, is the named capture result of §3; a host write
   that would pass it rejects. No second quota inside the guest's FS (`REV-7`,
   manager 2026-11-22). The isolate limit alone does not bound the state: a
   guest fits 51 MiB of files at limit 64 (step 0) while capture peaks at
   ~2 × S (ADR-0567 P2). *open:* the default.
7. **Trust.** Snapshot bytes from a run were produced in the guest's realm:
   hostile input, bounded by a frame limit and validated by the codec before
   they become state. The bridge copies a view's range only, both directions.
   *open:* text crossing to the host.
8. **`runCode`** is untouched: same API, results, corpus, pool behavior. A
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
  worker (no rerun: not idempotent). Cost: per syscall. Not built (manager
  default, 2026-11-22).
- **A′. A live isolate per agent run, bytes only as a restore point.**
  Closest to the requirements' wording (one instance per agent run, restore
  once). Not chosen: a run must be a fresh realm (globals, module cache,
  timers of one `node` process never reach the next — I2), which a live
  isolate gives only by a new context per run over the same heap; a lost
  worker's run cannot be rerun idempotently; a sandbox pins a worker slot
  while idle; a heap-limit or catastrophic end takes the files back to the
  last restore point anyway. For the consumer the contract is the same: one
  sandbox per agent run; restore per run is internal. Revisit with the
  template goal.
- **C. In-memory VFS in a per-sandbox worker or long-lived isolate.**
  Rejected: catastrophic OOM / ICU retention / heap-limit disposal lose the
  files (step 0 S1).

## Consequences

- Cost per run today (no template; the state is the agent's files): ADR-0567
  measured 3 ms export and 4 ms import for 52 files / 410 kB. While the
  immutable template layer is part of a run's state, a run costs ~1.15 s of
  codec and an isolate of ~205 MiB before guest code (23 654 files, 95 MB):
  the template goal must keep that layer out of the per-run state or bring
  this fork back to the user.

- An idle sandbox holds no process or isolate; a forgotten one is ordinary
  garbage.
- A killed run's partial writes are lost (declared ⚠️).
- Every run pays restore + snapshot, linear in the sandbox's files.
- Decisions recorded on ADR-0558 (guest contract: a program entry, restore and
  snapshot) and ADR-0563 (a call with state frames).
