# ADR 0572: Run a sandbox over an immutable template layer held outside the guest realm and snapshot only the difference

Status: Proposed
Date: 2026-11

> TL;DR: A sandbox's template (`produceDependencySnapshot` artifact) is decoded once per consumer process and once per worker and never enters the per-run state; during a run the guest reads template files on demand from the worker through read-only host functions, its own files stay in its realm (§Forks F1, recommended (b)); `snapshot()` is format v2: the difference plus the template's `{id, version}`.

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
   sandbox. Mounted: `payload/node_modules` (§Forks F3: where, and whether `payload/package.json`
   and the lock are visible); `rifty/*` never. A worker receives a template once, as bytes in a
   binary request frame (`distribution/isolate-host-binary-request-frame`), keeps it for its life,
   counts it in its RSS ceiling and idle watermark; a call names its template by identity.
2. **A run's FS** is an overlay in the guest realm: the sandbox's difference (rifty's
   `MemoryFsSync`, restored from the state as today) over the template, read on demand through
   three sync host functions — `stat`, `read`, `readdir` of a template path: exact lookup in the
   worker's immutable map, copies out, no other effect. The end state is the difference only. A
   sandbox without a template runs the same overlay over an empty template (one lifecycle,
   ADR-0568 §8). Owner of the FS: F1 (this is option (b)).
3. **Identity** `{id, version}` = `{rifty/manifest.json templateId, snapshotId}` (sha256 of the
   decoded tar, as the producer computes it; the same for gzip and br).
4. **Format v2** (ADR-0567 §3: v1 still read; the writer writes v2): v1's layout, version 2; with a
   template bound, entries are a layer over it — restore = template + entries; a v1 blob with a
   template stays a whole FS. Writable template (F2): a new record kind 3 = deletion of a template
   path, and a directory record flag "opaque" (a template directory removed and recreated).
   Read-only template: entries under the mount are refused (`_CORRUPT`), no new kinds.
5. **Cap and cost.** `maxFsBytes` counts the difference (codec budget units); a host write costs
   O(write + difference); `stateRefused` and `ERR_ISOLATE_HOST_SANDBOX_FULL` as today, over the
   difference. (Under F1 (c) the cap would move to the guest's write, `ENOSPC`, reversing `REV-7`.)
6. **Changed paths.** `exec`'s result adds `changes: { path, type, size }[]` (created, changed,
   deleted), derived from the difference before and after the run.
7. **Killed run** (`timeout`, `memory`, abort): F4. **Lost worker:** the state of before (the run
   reruns from it, ADR-0563 §6 unchanged).
8. **Capture outside the guest realm** (`distribution/isolate-host-sandbox-capture-outside-guest-realm`,
   live-sandbox I1): under (b) the difference is still captured in the guest's realm; the unit
   is a child of the template goal (scenario step 9, requirements §7 «проверяются на диффовом
   снапшоте») whose mechanism is chosen at its PICKUP among its candidates and (b′).

## Forks (user)

- **F1 — who owns the guest's FS during a run.**
  (a) materialize the template in the isolate (`views`): keeps every recorded decision; per-run
  cost and isolate memory linear in the template (T95 +110 ms, +100 MiB) — fails requirements §3.
  (b) **recommended** — lazy template: only template reads cross, 3 read-only host functions over
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
- **F2 — template files writable (copy-on-write, deletions in the format) or read-only (`EROFS`).**
- **F3 — mount `/node_modules` or `/workspace/node_modules`; `payload/package.json`/lock visible.**
- **F4 — a killed run's writes: kept as Node, or rolled back (documented, the tools say so).**
  Keeping needs (c) (or a write journal to the worker); even then a lost worker loses them.

## Trust (what F1 changes in recorded decisions)

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
   `exec('main.js')`: `require` of each of the four libraries resolves into the template, as Node
   resolves `require` from a file beside a `node_modules`; `rifty/*` is not visible to the guest.
4. The run's result names the paths it created, changed or deleted, with their sizes; the host
   reads the produced document's bytes.
5. At the end of the turn the host takes `snapshot()`: writing one file of F bytes over a ~95 MB
   template gives about F plus a header of kilobytes. The README states the per-conversation budget
   in compressed bytes.
6. Next turn: `createSandbox({ template, snapshot })` sees the same files; with no template, or
   another `{id, version}`, the restore is a named error before any guest code.
7. Template files the agent changed or deleted (if the template is writable — `map.md` Open
   questions) are seen changed or absent after restore (`require`, `fs.existsSync`).
8. The agent runs `node` many times per turn: a warm `exec`, a host `writeFile`/`list`/`remove` and
   the consumer's peak memory per run differ between a ~1 MB and a ~95 MB template by at most a
   constant; an empty sandbox over the ~95 MB template runs with the default `maxFsBytes` and
   `memoryLimitMb`; N sandboxes over one template hold one copy of it in the consumer.
9. A guest that breaks its own runtime (replaced intrinsics) cannot leave a tree its file
   operations did not produce while its run reads as success (live-sandbox I1).
10. The README shows building the template from `package.json` + lock and requiring each of the
    four libraries.

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
- Identity: any rebuild that changes the artifact's tar (a dependency bump, replay ↔ frozen) gives
  a new `version`; snapshots over the old one restore only over the old one (a named error
  otherwise, requirements §2); the consumer keeps old artifacts it still has snapshots for.
- `runCode` unchanged.
- Not the user's words: identity, format v2 layout, the binary frame, the worker cache policy are
  agent decisions.
