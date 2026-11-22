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
     (bytes, ADR-0567 format) restores; `options.template` →
     `NotImplementedError('isolate-host.sandbox-template')`.
   - `writeFile(path, data: Uint8Array | string)` (string = UTF-8, parents
     created), `readFile(path) → Uint8Array`, `list(path = '/workspace') →
     {name, type: 'file' | 'directory', size}[]` sorted by name, `remove(path)`
     (a file or a directory tree). A relative path resolves against
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
   (whole-run rollback; Node keeps partial writes — compat ⚠️). A run whose
   end state cannot be captured or restored rejects with a named code of its
   own (*open:* name), state unchanged. The run's
   input is bytes, so ADR-0563 §6's rerun of a lost worker's calls stays
   idempotent and applies unchanged.
4. **One operation at a time.** Each sandbox runs its operations in call
   order, one at a time (a run replaces the whole state, so a host write
   during it would be lost). A run's `timeoutMs` counts from its start.
   *open:* mechanism sweep (`fault-classes.md` §Class-kill) before the
   per-sandbox FIFO lands.
5. **destroy** rejects queued and later operations
   `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`, cancels a run in flight (its
   isolate is disposed as at a deadline) and drops the state.
6. **Limits.** Per run: `runCode`'s. Host file op: `maxFileBytes` per call.
   The sandbox's files: a per-sandbox cap (*open:* default, relation to
   `memoryLimitMb`): the isolate limit alone does not hold it — a guest fits
   51 MiB of files at limit 64 (step 0) while capture peaks at ~2 × S
   (ADR-0567 P2), and host writes meet no isolate. Guest writes past it fail
   at the write like a full disk; host writes past it reject.
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
- **C. In-memory VFS in a per-sandbox worker or long-lived isolate.**
  Rejected: catastrophic OOM / ICU retention / heap-limit disposal lose the
  files (step 0 S1).

## Consequences

- An idle sandbox holds no process or isolate; a forgotten one is ordinary
  garbage.
- A killed run's partial writes are lost (declared ⚠️).
- Every run pays restore + snapshot, linear in the sandbox's files.
- Decisions recorded on ADR-0558 (guest contract: a program entry, restore and
  snapshot) and ADR-0563 (a call with state frames).
