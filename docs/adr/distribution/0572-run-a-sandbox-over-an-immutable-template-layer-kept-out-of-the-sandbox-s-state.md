# ADR 0572: Run a sandbox over an immutable template layer kept out of the sandbox's state

Status: Proposed
Date: 2026-11

> TL;DR: A sandbox's template (`produceDependencySnapshot` artifact) is decoded once per consumer process and once per worker and never enters the per-run state; one layered FS class (rifty's `MemoryFsSync` with template entries materialized lazily; its state by node identity — an untouched template node is one row, anything else explicit) runs a sandbox's host ops in the consumer and its `fs` in each run, over one shared template index (host ops O(the write + the state)); each run's fresh isolate gets the template copied in (F1 (a), user 2026-11-25); writable or read-only per sandbox; persisting a template sandbox is deferred.

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
Four concurrent runs on one process, T95 pdf-lib wall: 801 / 570 / 528 / 507 ms. The chosen
construction (§2, arm `layered`, a later run on T95 = 23 654 files / 72.5 MB, load ~5): semver
86 ms, pdf-lib 244, 1 000 writes 80, floor 99–103 MiB, against `views` 167 / 319 / 157 / 107 in the
same run; probe
G: 0 / 3 000 generated sequences differ from rifty's FS without a template (§2). `worker`'s
chunked-I/O row: runtime-js's fd layer reads or rewrites the whole file per chunk, a memcpy in the
guest realm, a bridge copy per chunk across it.

## Decision

Proposed. F1–F4 (§Forks) are the user's; the rest is the agent's (listed in Consequences, «Not
the user's words»).

1. **Template = an immutable layer outside the state.** The consumer decodes the artifact (gzip or
   br, ustar + PAX, profile `replay` or `frozen`) once per process into one buffer of file bytes and
   an immutable index (path → kind, range, times; directory → sorted children), keyed by identity
   (§4); a broken, truncated or unsupported artifact is a named error before any sandbox.
   Registering returns the identity and the packages: the names of the root's dependencies in
   `payload/package-lock.json` (`packages[""]`) with the versions installed for them
   (`packages["node_modules/<name>"].version`) — the manifest's `deps` are only declared ranges.
   Mounted at `/node_modules`: `payload/node_modules` only (F3, user 2026-11-25) — no
   `payload/package.json`, no lock, never `rifty/*`. Per sandbox writable (default, the agent's) or
   read-only (F2, user 2026-11-25: both). A worker receives a template once, as bytes in a binary
   request frame (`distribution/isolate-host-binary-request-frame`), keeps it by identity for its
   life, counted in its RSS ceiling and idle watermark; a call names its template by identity.
2. **One layered FS on both sides, its state by node identity** (reviews of PR #429: N1/S-a,
   N2, and the fresh check after it). A `LayeredFsSync` in `@riftydev/vfs` (an `FsSync`, bundled
   into the guest and into the consumer's codec module like `MemoryFsSync` today). Its upper is
   rifty's own `MemoryFsSync`; every call runs on it unchanged after the touch it needs, so every
   semantics and error is `MemoryFsSync`'s by construction. Template entries enter the upper
   lazily, by node: a template directory as a directory node with an origin (the template
   directory it is) and, until a path through it is first touched, a lazy mark (children not yet
   materialized — then materialized with its own times kept); a template file as a node whose
   bytes are the template's bytes (the same reference) with an origin. Origins and marks belong to
   their node: they move with it on `rename`, go with it on `rm`. Every mutation marks the
   directories from `/` down to its path as changed (reads mark nothing). A node is **untouched
   from** its origin O when its kind and times are O's, a file's bytes are O's reference, and a
   directory is not marked changed. **The rule**, once — the state, from `/` down: a node untouched
   from its origin O is one row, `lazy(O)` for a directory (its subtree not descended into) or
   `ref(O)` for a file; any other directory is explicit and opaque (its children are exactly those
   described under it, each by this rule); any other file carries its bytes; all with their times.
   Path existence decides nothing; there is no deletion list and no merge — rebuilding recreates
   the same nodes. So reading never changes the state; an untouched template directory is one row
   wherever it is (a rename moves it as a row, no bytes); a changed directory lists its children,
   rows for the untouched ones. The state cap is the count of that description, computed by the
   same walk, which enters only changed directories. Probe G (`gen.mjs`): 3 000 seeded random
   sequences — `mkdir`, write, `rm`, `rename`, `cpSync`, `copyFileSync`, `utimes`, read, `readdir` —
   equal rifty's FS without a template in every call, in the tree rebuilt from the wire, with a
   rebuild at a seeded run boundary, and in the cap's count; reads alone leave the state a fresh
   sandbox's (0 / 3 000 on every count; the existence-derived construction: 302 / 3 000 differ; the
   every-node construction: reading grew the state in 3 000 / 3 000); a guest sample in fresh
   isolates against rifty's plain `MemoryFsSync` 60 / 60; the shared template bytes unchanged;
   probe S (`seq.mjs`): 29 named rows vs live `node` over a real directory. A sandbox without a
   template is the same class over an empty index (one lifecycle, ADR-0568 §8).
3. **A run** (F1 (a), user 2026-11-25): the worker copies the template's buffer and index into the
   fresh isolate (one ivm copy); the guest builds the index, installs a `LayeredFsSync` over it as
   the realm's only FS surface (sync; promise and stream forms go through it, as PR #437 does for
   every guest), rebuilds the sandbox's state over it, runs, and hands back its state (§2's rule).
   The consumer validates it (§5) and rebuilds it on a fresh view, which becomes the sandbox. Read-only mode: the
   same class refuses every mutating call under `/node_modules` as Node on a read-only mount (goal
   I3, its oracle in `map.md`), in both realms. Measured (probe L `layered`, T95 23 654 files /
   72.5 MB, M3 Pro, load ~5): restore (copy + index) 39–40 ms, capture 0.5–8 ms, isolate floor
   99–103 MiB (`views`: 88 ms, 35–39 ms, 107 MiB); probe F, the four-library artifact, its four
   generators: +18…+25 ms over the same program with the files in the state, four at once +7…+41,
   empty file +20 ms, floor 103 MiB against 19 without a template — inside the F1 return condition
   (goal Decisions), which the carrier re-measures on landed code.
4. **Identity** (registry and worker cache key) = `{rifty/manifest.json templateId, snapshotId}`
   (sha256 of the decoded tar, as the producer computes it; the same for gzip and br).
5. **The state on the wire** (consumer ↔ worker, internal, never handed out): an ADR-0567 v1 blob
   of the explicit nodes (template header: none; its §5 validation unchanged) plus rows
   `[path, lazy | ref, template path, times]` for the rest. The rows from a run are guest-authored:
   the consumer refuses them unless every path is canonical (ADR-0567 §5 rules), its parent is an
   explicit directory of the blob (or it is `/`), no path appears twice (in the rows or the blob),
   a `lazy` row names a template directory and a `ref` row a template file, the times are finite
   and in Date range, and the charge (384 + 8 per code unit + 80 per level of depth per row,
   ADR-0567 §7) fits the cap with the blob — else `stateRefused` with the codec's code.
   `snapshot()` and `createSandbox({ snapshot })` over a template:
   `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌, deferred to
   `distribution/isolate-host-sandbox-template-snapshot` (user 2026-11-25).
6. **Cap and limits.** `maxFsBytes` counts the state on the wire (codec budget units, rows
   charged as above; computed by §2's walk, O(the state)), never the template's bytes; `ERR_ISOLATE_HOST_SANDBOX_FULL` and
   `stateRefused: ERR_FS_SNAPSHOT_TOO_LARGE` as today, over it. A run's isolate also holds the template: it needs
   `memoryLimitMb` ≥ 2 × `maxFsBytes` + 16 MiB + the template's in-isolate size (its bytes plus its
   index); a template that does not fit the run's isolate is the named result of a state the run
   cannot restore — `stateRefused: ERR_ISOLATE_HOST_SANDBOX_RESTORE`, `exitCode: null`, before any
   guest code (ADR-0568 §3). The README states both cases with the defaults (256 MiB): an empty
   sandbox over the four-library artifact leaves its guest code ~130 MiB (the figure the user saw,
   2026-11-25) instead of ~235, and a full 64 MiB difference fits by the rule (2 × 64 + 16 + the
   template's in-isolate size ≈ 230–245 MiB) — the carrier measures both floors.
7. **Changed paths.** `exec`'s result adds `changes: { path, type, size }[]` — `created`,
   `changed` (kind or bytes differ; a change of times alone is not listed), `deleted` (a deleted
   directory listed once, its contents implied) — computed over the two states (an untouched row
   in both is skipped): O(the states).
8. **Killed run** (`timeout`, `memory`, abort): rolled back to the sandbox of before (F4, user
   2026-11-25). **Lost worker:** the same; the rerun starts from it (ADR-0563 §6 unchanged).
9. **Capture outside the guest realm** (`distribution/isolate-host-sandbox-capture-outside-guest-realm`,
   owned by the template goal): the state is still taken in the guest's realm; the unit's
   mechanism is chosen at its PICKUP among its candidates (a fresh realm over the FS records, the
   worker reading the isolate's FS through copies, a capture using only intrinsics captured before
   guest code).

## Amends

- ADR-0568 §1: `options.template` is accepted (no longer `NotImplementedError`); `createSandbox`
  gains the template options (artifact or id; read-only). §2 («decoded in the consumer realm into
  rifty's own `MemoryFsSync` for host file ops — no second implementation»): a template sandbox's
  host ops run on `LayeredFsSync` over rifty's `MemoryFsSync` — the same class as the guest's run,
  so still one implementation; idle it holds its own nodes and reference nodes for the template
  entries it touched (bytes shared), not ~400 B per template entry. §6: the isolate rule adds the
  template's in-isolate size (§6 above).
- ADR-0558 (guest contract): `GuestEntry` gains installing a template view + the sandbox's state
  before the run and handing back the state after it (beside `restore` / `snapshot`).
- ADR-0567 §4 («v1 snapshots the whole FS»): on the internal consumer ↔ worker wire of a template
  sandbox, a v1 blob (template header: none) carries the explicit nodes only, the rows beside it
  the rest; read only by a template run, never handed out, so no format version changes. ADR-0567
  §6 («Restore decodes fully, then replaces the whole target FS») holds for `restoreFs`; the state
  is rebuilt over a template view by `LayeredFsSync` (§2). ADR-0567 §5 validates the blob
  unchanged; the rows beside it are validated by §5 above.

## Forks (user)

- **F1 — who owns the guest's FS during a run.**
  **Answered 2026-11-25: (a)** (goal Decisions; (b) deferred to
  `distribution/isolate-host-sandbox-template-lazy-read`, (c) recorded in
  `distribution/isolate-host-sandbox-killed-run-partial-writes`).
  (a) the template in the isolate per run — first measured as `views`, built as `layered`
  (§2–3: lazily materialized, the state by node identity): keeps every recorded decision; per-run
  cost and isolate memory linear in the template (T95 ~+125 ms, +100 MiB); with both modes (F2) the
  simplest: a plain FS, writes and deletions of template files need no overlay.
  (b) lazy template (recommended before F2's answer): only template reads cross, 3 read-only host functions over
  immutable data shared by every sandbox; the agent's files stay in the guest realm as today.
  Meets §2–3; the capture unit stays open (§9); a killed run's writes stay lost (F4 = rollback).
  (c) the worker owns the whole FS: closes the capture unit by construction and makes a killed
  run's writes keepable; but every `fs` call is a host call (~11 operations — one dispatcher in the probe —, guest-chosen paths
  and bytes, per-call state in the multi-tenant worker), chunked I/O on the agent's own files turns
  quadratic across the bridge (8 MiB: 259 vs 64 ms, 541 MB copied) until rifty's FS interface gains
  ranged operations (vfs + runtime-js, every host), and the cap moves to the write (`ENOSPC`).
  (b′) (b) + the difference captured in the guest realm only through intrinsics captured before
  guest code (the capture unit's third candidate): not measured; the codec and the MemoryFs walk
  would both have to be primordial-safe — a class audit (`runtime-js/post-guest-paths-use-replaceable-intrinsics`).
- **F2 — template files writable or read-only.** Answered 2026-11-25: both, per sandbox (§1; «per sandbox» the agent's reading).
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
  host function behind a jail of our own over `node:fs`» against the user's words «харденинг нужен
  только на внешнем шве: выставленные хостовые функции, исходящий RPC, spawn наружу, передача
  результата».
  (c) has that seam; (b) adds 3 read-only functions.

- «rifty целиком внутри isolate, один одноразовый экземпляр на гостя. «Гость ломает собственный
  rifty» допустимо; харденинг нужен только на внешнем шве: выставленные хостовые функции,
  исходящий RPC, spawn наружу, передача результата» (requirements 2026-11-17, §Топология). (b): the
  runtime stays in the isolate; the template's store moves to the worker behind 3 new exposed host
  functions (guest-chosen path → exact lookup in an immutable map, copies out). (c): the FS
  implementation of the guest's files moves to the worker: ~11 exposed operations with
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
   the consumer's peak memory per run do not grow with the template; an empty sandbox over the
   ~95 MB template runs with the default `maxFsBytes` and `memoryLimitMb`; N sandboxes over one
   template hold one copy of it in the consumer, each idle one only its own changes.
8. A guest that breaks its own runtime (replaced intrinsics) cannot leave a tree its file
   operations did not produce while its run reads as success (live-sandbox I1).
9. The README shows building the template from `package.json` + lock and requiring each of the
    four libraries.

## Invariants (goal `isolate-host-sandbox-template`, verbatim)

- I1. Intake: `createSandbox({ template })` accepts a `produceDependencySnapshot` artifact (gzip or
  br, profile `replay` or `frozen`) or the id of one registered in the process; registering returns
  the template's identity `{id, version}`, derived from the artifact alone and documented, and its
  packages (the root's dependencies in the artifact's `payload/package-lock.json` with the versions
  installed for them); that identity is the id `createSandbox` takes; a corrupted, truncated or unsupported artifact, or an
  unknown id, is refused by name before any sandbox exists; no other conversion is needed on the
  consumer's side.
- I2. Mount: the guest sees the artifact's `payload/node_modules` at `/node_modules` and nothing
  else of it (`rifty/*`, `payload/package.json`, the lock); `require('<lib>')`, `require.resolve`
  and `module.paths` from `/workspace/main.js` resolve into it as Node's do over the same tree.
- I3. Modes: over a writable template a change or deletion of a template path — by the guest or a
  host op — is seen by that sandbox's later runs and host ops and by no other sandbox; over a
  read-only one every mutating call under `/node_modules`, from the guest (sync, callback, promise
  and stream forms) and from host ops, fails as Node v24.16.0 fails it on a read-only mount (code,
  syscall, path — `EROFS` where Linux returns it, the earlier error where Linux checks first, e.g.
  `EEXIST` for `mkdir` of an existing directory; oracle: `map.md` Open questions), and the template
  stays as it was.
- I4. Layer: a template is held once per consumer process and once per worker per identity; N
  sandboxes over it share that one copy and its index — an idle sandbox holds its difference and
  the entries it touched as references into that copy, never a copy of the template's bytes or a
  per-sandbox index of it, and nothing ever writes the shared bytes (their hash after the I11
  sequences over N sandboxes equals before); per run only the sandbox's state crosses to the worker
  and back — an untouched template directory or file is one row wherever it is, a changed
  directory lists its children (rows for the untouched ones), anything else carries its bytes;
  reads change nothing; `maxFsBytes`, `ERR_ISOLATE_HOST_SANDBOX_FULL` and `stateRefused:
  ERR_FS_SNAPSHOT_TOO_LARGE` count that state, never the template's bytes.
- I5. Cost. Templates: T1 (~1 MB, ~300 files) and T95 (23 654 files, 95 MB), generated
  deterministically by the carrier (fixed names, sizes and bytes — not the pnpm store), plus the
  four-library artifact. Structural, by unit tests: a host op (`writeFile`, `readFile`, `remove`,
  `list`, the cap check included) reads the template index only to materialize the directories it
  must see — the not yet materialized ancestors of its path, `dir` for `list(dir)`, the removed
  directory for a non-recursive `remove`, both trees of a recursive copy — exactly their children,
  counted, never a walk of the template; the cap check counts the state by entering only changed
  directories (counted), so listing the whole template does not make a write dearer;
  a warm `exec`'s request frame carries the encoded state (own entries + reference rows) and
  nothing of the template's bytes (frame bytes counted), the template travels to a worker once per identity (frames
  counted, cold and warm); the consumer's buffers for a run are those encodings and their decode,
  never a copy of the template's buffer or index (the codec's inputs and outputs counted). Measured
  on landed code and published in the README for T1, T95 and the four-library artifact
  (`scripts/measure.mjs`): host-op medians, idle memory per sandbox, the consumer's peak memory per
  run, a warm `exec`'s latency and isolate memory (the smallest passing `memoryLimitMb`, bisection
  in 4 MiB steps). An empty sandbox over T95 and over the
  four-library artifact runs with the default `maxFsBytes` and `memoryLimitMb`.
- I6. Changed paths: `exec`'s result names exactly the paths the run created, changed (kind or
  bytes differ; times alone are not a change) or deleted (a deleted directory once, its contents
  implied), template paths included, with their sizes — equal to a walk of live Node's tree before
  and after the same run (probe S's comparison).
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
- I11. Sequences, generated: a seeded generator of `mkdir`, write, `rm` (recursive or not, forced
  or not), `rename`, `cpSync`, `copyFileSync`, `utimes`, read and `readdir` sequences over a small
  template and new paths runs each sequence on the layered FS and on rifty's FS without a template
  holding the same files: every call's result and the tree after the state is carried over the wire
  and rebuilt on a fresh view are equal, by the guest (rifty `fs` in a fresh isolate) and by host
  ops, from one run to the next; and where rifty's FS without a template agrees with live `node`
  v24.16.0 over a real directory, so does the layered one. A failure prints its seed and a
  minimized sequence. Named rows stay as regressions: remove → write the same path, remove a
  directory → write a child, `rmdir` + `mkdir`, a template directory renamed then recreated, a
  template file turned into a directory and back, B → A after A → C, a rename onto an existing
  template file, a recursive copy merging into a template directory, `utimes`, a same-bytes
  overwrite, `EISDIR`/`EEXIST`/`ENOTEMPTY`, host → run → host. Also per generated sequence: a
  rebuild from the wire at a seeded point (a run boundary) changes no later result; the cap's count
  equals an independent count of the wire; the sequence's reads alone (and a read of every
  template file) leave the state a fresh sandbox's.

## Alternatives

- **full** (today, a hand-laid `node_modules` in the state): rejected — requirements §2–3 (snapshot
  ~96 MB, per-run cost linear in the template).
- **views** (F1a), **lazy** (F1b), **worker** (F1c): §Forks, measured above.
- **Shared template memory across isolates** (one `SharedArrayBuffer` mapped into each isolate):
  not built — the guest that breaks its own rifty reaches the buffer and writes into every other
  sandbox's template (ADR-0568 I7); the index build stays linear in the template (`views` ~90 ms).
- **Prebundling the libraries into one script** (requirements 2026-11-17 «esbuild в один скрипт»):
  rejected — `require` would not resolve into the artifact's files (scenario step 3), and every
  library change is a rifty build.
- **A′ (a live isolate per agent run, restore once)**: still not chosen — it would save the
  per-run template copy and index (`layered`, T95: restore 39–40 ms, isolate floor 99–103 vs 19
  MiB without a template), but its reasons in ADR-0568 (a fresh
  realm per run — I2, an idempotent rerun of a lost worker's call, no slot pinned by an idle
  sandbox) do not depend on the template.

## Consequences

- Memory: the consumer holds one copy of each template (buffer + index); each worker that served it
  holds one more; each run in flight holds one more inside its isolate (buffer + index, its touched
  entries materialized). Peak ≈ (1 + workers +
  concurrent runs) × the template's materialized size; a worker's idle watermark and RSS ceiling
  include its held templates, else an idle worker holding a ~90 MB template sits at the 256 MiB
  retire line.
- A template arriving at a worker is decoded on its main thread, which every slot's host calls
  share: a delay for its neighbours (ADR-0563 §7 class), bounded by the template's size.
- A run pays the template in its isolate: one copy and the index build, linear in the template's
  entries and bytes (the capture visits only what the run touched) (ADR-0568 Consequences' fork, brought back and answered by the
  user 2026-11-25). The wire, the consumer's per-run memory and host ops carry the sandbox's own
  nodes and reference rows only.
- A rename of a template directory moves its marker: no subtree copy, no bytes, no cap pressure
  (the ceiling of the existence-derived draft is gone).
- A changed template directory is opaque: it lists all its children, rows for the untouched ones —
  a write under `/node_modules/a` puts one row per package of `/node_modules` and per entry of `a`
  on the wire (~400 budget units each; 209 packages ≈ 80 KiB of the cap), bounded by the template's
  fan-out on the written path, not by its size.
- Per-call overhead of the layered class in a run (probe F, load ~5): +18…+25 ms on the four
  libraries' generators, four at once +7…+41 ms — inside the F1 return condition; map item 5
  re-measures it on landed code.
- The state cap is counted over the state: a host write costs O(the write + the state) — T95
  0.02 ms, 0.31 ms after the host listed the whole template with 21 files of its own (probe H).
- `runCode` unchanged.
- Overlap with PR #437 (open, the user's track: every guest's FS sync-only): a template run installs
  `LayeredFsSync` as the realm's only FS surface (§3), the same move for template runs; whichever
  lands second rebases. No async `Vfs` stays beside it, so read-only mode has no unguarded surface.
- Not the user's words (agent decisions, probed where noted): identity (§4); the packages' source
  (§1); writable as the default; `LayeredFsSync`, its node-identity rule (untouched = one row) and
  its place in `@riftydev/vfs` (§2, probed: G generated sequences, S named rows, H host-op cost, L/F
  per-run cost); the rows beside a v1 blob and their validation (§5); the isolate rule and the restore refusal for a template that does not fit (§6, not
  probed); the definition of `changed` (§7, probed in S); the binary frame; the worker cache
  policy; the read-only refusal table (its oracle: goal I3 / `map.md`, not probed).