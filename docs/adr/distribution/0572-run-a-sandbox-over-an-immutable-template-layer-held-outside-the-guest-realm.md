# ADR 0572: Run a sandbox over an immutable template layer held outside the guest realm

Status: Proposed
Date: 2026-11

> TL;DR: A sandbox's template (`produceDependencySnapshot` artifact) is decoded once per consumer process and once per worker and never enters the per-run state; each run's fresh isolate gets the template copied in as one buffer and materialized as views into it, under the sandbox's difference — the only state that moves (F1 (a), user 2026-11-25); writable or read-only per sandbox; persisting a template sandbox is deferred.

## Context

Goal `isolate-host-sandbox-template` (scenario verbatim below). Requirements: consumer,
2026-11-24 (`/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md`
§1–3, §7, «Найдено дополнительно»). ADR-0568 Consequences: «While an immutable template layer is
part of a run's state, every run pays that: the template goal must keep the layer out of the
per-run state or bring this fork back to the user»; §Alternatives A′ «Revisit with the template
goal». ADR-0567 §4: «The layer's own ADR defines how a snapshot leaves out its immutable paths (a
new version if records change)».

Probes (`docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`, M3 Pro,
Node 24.16.0, isolated-vm 7.0.2): M — `require('<lib>')` from `/workspace/main.js` resolves as Node
for a template at `/node_modules` and at `/workspace/node_modules` (main, exports, subpath,
hoisted/nested, missing). L — per-run cost of four ways a fresh isolate sees a template, T1 (1 MB,
296 files) vs T95 (88.8 MB, 23 654 files), worker-side medians:

| arm | T1 semver | T95 semver | T95 pdf-lib | T95 1 000 writes | T1 8 MiB chunked I/O | isolate floor T1 / T95 |
|---|---|---|---|---|---|---|
| full (today: template in the state) | 70 ms | 392 ms | 647 ms | 359 ms | 55 ms | 19 / 215–219 MiB |
| views (materialized, one buffer, no per-file copy) | 66 | 190 | 454 | 157 | 48 | 19 / 123 |
| lazy (template read through 3 host functions) | 78 | 80 | 406 | 34 | 64 | 19 / 19–23 |
| worker (whole FS in the worker, every call crosses) | 75 | 77 | 393 | 51 | 259 (541 MB copied) | 19 / 19–23 |

`full` adds the consumer's encode + decode of the whole state per `exec` (T95 ~150 + ~170 ms).
Four concurrent runs on one process, T95 pdf-lib wall: 801 / 570 / 528 / 507 ms. `worker`'s
chunked-I/O row: runtime-js's fd layer reads or rewrites the whole file per chunk, a memcpy in the
guest realm, a bridge copy per chunk across it.

## Decision

Proposed; F1–F4 (§Forks) are the user's, the rest follows from the requirements and probes.

1. **Template = an immutable layer outside the state.** The consumer turns the artifact (gzip or
   br, ustar + PAX, profile `replay` or `frozen`) into a decoded template once per process,
   keyed by identity; a broken, truncated or unsupported artifact is a named error before any
   sandbox. Mounted at `/node_modules`: `payload/node_modules` only (F3, user 2026-11-25) — no
   `payload/package.json`, no lock, never `rifty/*`. Per sandbox writable (default) or read-only
   (F2, user 2026-11-25: both): read-only makes every write, remove, rename or `mkdir` under the
   mount `EROFS`, from the guest and from host ops. A worker receives a template once, as bytes in a
   binary request frame (`distribution/isolate-host-binary-request-frame`), keeps it for its life,
   counts it in its RSS ceiling and idle watermark; a call names its template by identity.
2. **A run's FS** is rifty's `MemoryFsSync` in the guest realm, as today (F1 (a), user
   2026-11-25). The worker copies the template into the fresh isolate as one buffer (one ivm copy)
   with its index; the guest writes every template entry as a view into that buffer (no per-file
   copy, times from the template), then restores the sandbox's difference over it (changed files,
   new files, template paths deleted). After the run the capture walks the tree and emits only
   entries that are not the template's own views with the template's times, plus template paths
   now absent. Read-only mode: an `FsSync` wrapper installed with `setSyncMirror` refuses every
   mutation under `/node_modules` (`EROFS`). The guest's FS is sync only (no async `Vfs`; the
   guest's sync-only change on top of PR #434). A sandbox without a template runs the same path with
   an empty template (one lifecycle, ADR-0568 §8). Host ops in the consumer: the same
   materialization — one shared template buffer per process, a per-sandbox `MemoryFsSync` of views
   into it (an index per sandbox, ~400 B per entry, ADR-0568 §6), the difference computed by the
   same walk. Measured (probe L `views`, T95): +~90 ms materialize and +~37 ms capture walk per run,
   isolate floor 123 MiB (four-library template, 8 001 files: ~+50 ms, ~+90 MiB, extrapolated by
   entry count — the carrier measures it).
3. **Identity** (registry and worker cache key) = `{rifty/manifest.json templateId, snapshotId}`
   (sha256 of the decoded tar, as the producer computes it; the same for gzip and br).
4. **The difference between operations** is the sandbox's state (ADR-0568 §2), on the wire to the
   worker and back: ADR-0567 records of the paths that differ, plus — writable mode — the template
   paths deleted (a directory removed and recreated is opaque). Internal: never handed out, no
   format promise. `snapshot()` and `createSandbox({ snapshot })` over a template:
   `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌, deferred to
   `distribution/isolate-host-sandbox-template-snapshot` (format v2, restore by identity; user
   2026-11-25 «все задачи про сохранение и изменение снапшота мы кладем в бэк-лог»).
5. **Cap and cost.** `maxFsBytes` counts the difference (codec budget units); a host write costs
   O(write + difference); `stateRefused` and `ERR_ISOLATE_HOST_SANDBOX_FULL` as today, over the
   difference. (Under F1 (c) the cap would move to the guest's write, `ENOSPC`, reversing `REV-7`.)
6. **Changed paths.** `exec`'s result adds `changes: { path, type, size }[]` (created, changed,
   deleted), derived from the difference before and after the run.
7. **Killed run** (`timeout`, `memory`, abort): F4. **Lost worker:** the state of before (the run
   reruns from it, ADR-0563 §6 unchanged).
8. **Capture outside the guest realm** (`distribution/isolate-host-sandbox-capture-outside-guest-realm`,
   live-sandbox I1): the difference is still captured in the guest's realm; the unit is a child
   of the template goal (scenario step 8, requirements §7 «проверяются на диффовом снапшоте»)
   whose mechanism is chosen at its PICKUP among its candidates (a fresh realm over the FS records,
   the worker reading the isolate's FS through copies, a capture using only intrinsics captured
   before guest code).

## Forks (user)

- **F1 — who owns the guest's FS during a run.**
  **Answered 2026-11-25: (a)** (goal Decisions; (b) deferred to
  `distribution/isolate-host-sandbox-template-lazy-read`, (c) recorded in
  `distribution/isolate-host-sandbox-killed-run-partial-writes`).
  (a) materialize the template in the isolate (`views`): keeps every recorded decision; per-run
  cost and isolate memory linear in the template (T95 +110 ms, +100 MiB); with both modes (F2) the
  simplest: a plain FS, writes and deletions of template files need no overlay.
  (b) lazy template (recommended before F2's answer): only template reads cross, 3 read-only host functions over
  immutable data shared by every sandbox; the agent's files stay in the guest realm as today.
  Meets §2–3; the capture unit stays open (§8); a killed run's writes stay lost (F4 = rollback).
  (c) the worker owns the whole FS: closes the capture unit by construction and makes a killed
  run's writes keepable; but every `fs` call is a host function (~11 of them, guest-chosen paths
  and bytes, per-call state in the multi-tenant worker), chunked I/O on the agent's own files turns
  quadratic across the bridge (8 MiB: 259 vs 64 ms, 541 MB copied) until rifty's FS interface gains
  ranged operations (vfs + runtime-js, every host), and the cap moves to the write (`ENOSPC`).
  (b′) (b) + the difference captured in the guest realm only through intrinsics captured before
  guest code (the capture unit's third candidate): not measured; the codec and the MemoryFs walk
  would both have to be primordial-safe — a class audit (`runtime-js/post-guest-paths-use-replaceable-intrinsics`).
- **F2 — template files writable or read-only.** Answered 2026-11-25: both, per sandbox (§1).
- **F3 — mount `/node_modules` or `/workspace/node_modules`; `payload/package.json`/lock visible.**
  Answered 2026-11-25: `/node_modules`, `node_modules` only (§1).
- **F4 — a killed run's writes: kept as Node, or rolled back (documented, the tools say so).** Answered 2026-11-25: rolled back (goal Decisions).
  Keeping needs (c) (or a write journal to the worker); even then a lost worker loses them.

## Trust (what F1 (b)/(c) would change in recorded decisions; (a) changes none)

- Goal `isolate-host-live-sandbox` Outcome (user-owned): «The files stay rifty's in-memory
  filesystem in the guest's own realm; between operations the sandbox is bytes held by the
  consumer, and only bytes and plain data cross the isolate boundary.» (b): the agent's files stay
  there; template files are read across the boundary as bytes. (c): no file stays in the guest's
  realm — an amendment of that Outcome.
- The goal's own reading (Decisions, host-disk rejection): «every guest `fs` call becomes an exposed
  host function … against «харденинг нужен только на внешнем шве: выставленные хостовые функции…»».
  (c) has that seam; (b) adds 3 read-only functions.

- «rifty целиком внутри isolate, один одноразовый экземпляр на гостя. «Гость ломает собственный
  rifty» допустимо; харденинг нужен только на внешнем шве: выставленные хостовые функции,
  исходящий RPC, spawn наружу, передача результата» (requirements 2026-11-17, §Топология). (b): the
  runtime stays in the isolate; the template's store moves to the worker behind 3 new exposed host
  functions (guest-chosen path → exact lookup in an immutable map, copies out). (c): the FS
  implementation of the guest's files moves to the worker: ~11 exposed host functions with
  guest-chosen paths and bytes, per-call state in the multi-tenant worker (bounded by
  `maxFsBytes`), the guest's runtime otherwise in the isolate.
- «Владелец ФС живёт в том же realm, что и гость (внутри isolate), поэтому SAB/`Atomics.wait` не
  нужны» (same). (b): false for the template layer; (c): false for all files. Its stated reason
  holds in both: isolated-vm's sync callbacks need no SAB.
- «все правильно, не нужно давать настоящую fs» (user, 2026-11-22, ADR-0568 §Alternatives B: a host
  directory reached by `node:fs`). Neither (b) nor (c) touches `node:fs` or a host path: both are
  rifty's in-memory structures in the worker; (c) has B's seam shape (every guest `fs` call a host
  call) without its jail.

## User scenario (goal `isolate-host-sandbox-template`, verbatim)

1. In CI the service runs `produceDependencySnapshot` (`@riftydev/workbench`, Node) over its
   `package.json` + lock for `pptxgenjs`, `pdf-lib`, `docx`, `exceljs` and stores the artifact.
2. At start it hands the artifact to `@riftydev/isolate-host` (directly to `createSandbox({ template })`
   or registered once, then by id). A corrupted, truncated or unknown-format artifact is refused by
   name, before any sandbox exists.
3. Per agent turn it creates a sandbox over the template, writes `/workspace/main.js`, runs
   `exec('main.js')`: `require` of each of the four libraries resolves into `/node_modules`, as Node
   resolves `require` from a file below a `node_modules`; `rifty/*` is not visible to the guest.
4. The run's result names the paths it created, changed or deleted, with their sizes; the host
   reads the produced document's bytes from the live sandbox.
5. Over a writable template, a template file the agent changed or deleted is seen changed or absent
   by the sandbox's later runs (`require`, `fs.existsSync`) and host ops; over a read-only one, that
   write fails `EROFS` and the template stays as it was.
6. At the end of the turn the host has taken the files it needs and destroys the sandbox; nothing
   of it is kept.
7. The agent runs `node` many times per turn: the README's cost table gives a warm `exec`'s latency
   and its isolate memory over a ~1 MB and a ~95 MB template; a host `writeFile`/`list`/`remove` and
   the consumer's peak memory per run do not grow with the template's bytes; an empty sandbox over
   the ~95 MB template runs with the default `maxFsBytes` and `memoryLimitMb`; N sandboxes over one
   template hold one copy of its bytes in the consumer.
8. A guest that breaks its own runtime (replaced intrinsics) cannot leave a tree its file
   operations did not produce while its run reads as success (live-sandbox I1).
9. The README shows building the template from `package.json` + lock and requiring each of the
    four libraries.

## Invariants (goal `isolate-host-sandbox-template`, verbatim)

- I1. Intake: `createSandbox({ template })` accepts a `produceDependencySnapshot` artifact (gzip or
  br, profile `replay` or `frozen`) or the id of one registered in the process; registering returns
  the template's identity `{id, version}`, derived from the artifact alone and documented, and that
  identity is the id `createSandbox` takes; a corrupted, truncated or unsupported artifact, or an
  unknown id, is refused by name before any sandbox exists; no other conversion is needed on the
  consumer's side.
- I2. Mount: the guest sees the artifact's `payload/node_modules` at `/node_modules` and nothing
  else of it (`rifty/*`, `payload/package.json`, the lock); `require('<lib>')`, `require.resolve`
  and `module.paths` from `/workspace/main.js` resolve into it as Node's do over the same tree.
- I3. Modes: over a writable template a change or deletion of a template path — by the guest or a
  host op — is seen by that sandbox's later runs and host ops and by no other sandbox; over a
  read-only one every write, removal, rename or `mkdir` under `/node_modules` fails `EROFS` with
  Node's error shape, from the guest and from host ops, and the template stays as it was.
- I4. Layer: a template is held once per consumer process and once per worker per identity; N
  sandboxes over it share one copy of its bytes in the consumer; per run only the sandbox's
  difference crosses to the worker and back; `maxFsBytes`, `ERR_ISOLATE_HOST_SANDBOX_FULL` and
  `stateRefused: ERR_FS_SNAPSHOT_TOO_LARGE` count the difference only.
- I5. Cost, published: a host op's cost and the consumer's peak memory per run do not grow with the
  template's bytes; a warm `exec`'s latency and isolate memory over a ~1 MB and a ~95 MB template
  are measured on landed code and published in the README; an empty sandbox over the ~95 MB
  template runs with the default `maxFsBytes` and `memoryLimitMb`.
- I6. Changed paths: `exec`'s result names exactly the paths the run created, changed or deleted
  (template paths included), with their sizes, against a walk of the state before and after.
- I7. The end state: a guest that breaks its own runtime (replaced intrinsics) cannot leave a tree
  its file operations did not produce while its run reads as success — it gets the tree its
  operations produced or `stateRefused` with the state of before (live-sandbox I1).
- I8. Deferred, loud: `snapshot()` and `createSandbox({ snapshot })` over a template throw
  `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌; sandboxes without a
  template keep ADR-0567 v1 snapshots unchanged.
- I9. Unchanged guarantees: `isolate-host-live-sandbox` I1–I8 hold for a sandbox over a template
  (a killed run rolls back its difference and its template changes; destroy, ordering, limits,
  trust) — its I9 (snapshot round trip) is I8's deferred gap here — and `runCode` does not change.
- I10. Documented route: the README builds the template from `package.json` + lock with
  `produceDependencySnapshot` run in plain Node (the published `@riftydev/workbench`), passes it to
  `createSandbox`, and requires each of the four libraries from a sandbox run — each `require`
  succeeding, proven by the carrier on that artifact.

## Alternatives

- **full** (today, a hand-laid `node_modules` in the state): rejected — requirements §2–3 (snapshot
  ~96 MB, per-run cost linear in the template).
- **views** (F1a), **lazy** (F1b), **worker** (F1c): §Forks, measured above.
- **Shared template memory across isolates** (one `SharedArrayBuffer` mapped into each isolate):
  not built — the guest that breaks its own rifty reaches the buffer and writes into every other
  sandbox's template (ADR-0568 I7); the index build stays linear in the template (`views` 94 ms).
- **Prebundling the libraries into one script** (requirements 2026-11-17 «esbuild в один скрипт»):
  rejected — `require` would not resolve into the artifact's files (scenario step 3), and every
  library change is a rifty build.
- **A′ (a live isolate per agent run, restore once)**: still not chosen — its reasons in ADR-0568
  (fresh realm per run, idempotent rerun, no pinned slot) do not depend on the template; with the
  template out of the state, the per-run restore it saved is the difference only.

## Consequences

- Memory: the consumer holds one copy per template; each worker that served it holds one more
  ((workers + 1) × template bytes at peak); a worker's idle watermark and RSS ceiling include its
  templates, else an idle worker holding a ~95 MB template sits at the 256 MiB retire line.
- A template arriving at a worker is decoded on its main thread, which every slot's host calls
  share: a delay for its neighbours (ADR-0563 §7 class), bounded by the template's size.
- A run still pays the template in its isolate: one copy, the index build and the capture walk,
  linear in the template's entries and bytes (ADR-0568 Consequences' fork, brought back and
  answered by the user 2026-11-25: «ок» to copying now, lazy reads in backlog). The wire, the
  consumer's per-run memory and host ops carry the difference only.
- `runCode` unchanged.
- Not the user's words: identity, the difference's wire shape, writable as the default, the binary
  frame, the worker cache policy are agent decisions.
