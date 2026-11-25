---
kind: epic
status: draft
title: Isolate host sandbox template — libraries from a dependency artifact, mounted at /node_modules, outside the sandbox's state
created: 2026-11-24
value: A Node service starts every agent sandbox over one prebuilt `node_modules` (pptxgenjs, pdf-lib, docx, exceljs) from `produceDependencySnapshot`, held once per process and per worker, with only the sandbox's own changes moving per run and per host write.
user_story: As a Node service whose agent writes document generators against preinstalled libraries, I want `createSandbox({ template })` from my dependency artifact, but today `template` is `NotImplementedError('isolate-host.sandbox-template')` and a hand-laid `node_modules` makes every run and host write cost the whole ~95 MB.
tier: robust
---

## Outcome

`@riftydev/isolate-host` accepts the artifact `produceDependencySnapshot` makes (gzip or br,
profile `replay` or `frozen`) — or the id of one registered in the process — as a sandbox's
template, mounted at `/node_modules` (its `node_modules` only: no `package.json`, no lock, no
`rifty/*`). The guest's `require('<lib>')` from `/workspace/main.js` resolves into it as Node's
resolution does. Per sandbox the template is writable (a change or deletion seen by the sandbox's
later runs and host ops) or read-only (a write under the mount is `EROFS`, as on a read-only
mount). The template is a separate layer: loaded once per consumer process and once per worker,
shared by every sandbox over it, never part of a sandbox's state; the state cap counts the
sandbox's difference from it, and only the difference crosses to the worker and back per run. A
fresh isolate per run holds the template in its heap (copied in per run, user 2026-11-25), so a
run's latency and isolate memory grow with the template — measured and published (the agent's
reading of the user's «ок», Decisions). Neither the template's bytes, nor its total number of
entries, nor its depth changes the cost of a host op, the per-run wire or an idle sandbox, and
reading never changes the state; a host op that touches no template directory is constant (probe
W). One dependency is open: **every operation that touches a template directory — its first read,
`list` or `stat`, a write, removal, rename or copy inside it — costs, and if it changes the
directory carries on the wire and in the cap, in proportion to that directory's width (number of
entries), and so does a `/workspace` write after such a change and an idle sandbox's memory after
such a touch** (probe W, 10 → 5 000 packages in `/node_modules`: first touch 0.01 → 5.5 ms, a write
in a package 0.04 → 10.6 ms and 10 → 5 000 rows, ~730 cap units per row, an idle sandbox after one
listing 11 KiB → 3.3 MiB; `/workspace` untouched 0.007 ms and one row throughout; on the
four-library template, `/node_modules` 180 wide: first touch 0.2 ms, a write in `pdf-lib` 0.44 ms
and 189 rows / 33 KB on the wire / 147 k cap units — 0.2 % of the default 64 MiB cap —, an idle
sandbox after one listing 134 KiB instead of 4). It comes from
materializing a template directory whole on first touch and from an explicit directory being
opaque. That is a narrowing of requirements §3 («Хостовая запись стоит O(размер записи + дифф)»;
costs on ~1 MB and ~95 MB «отличаются не больше чем на константу»; «Память простаивающей
песочницы у потребителя не включает шаблон») — the user's word is pending (map.md); the goal stays
draft until it. What the host sees is what the next run sees, after any sequence of host ops and runs,
as rifty's FS without a template would show it, and as live Node over a real directory where
rifty's FS itself agrees with Node (I11). `exec` reports the paths the run changed, with sizes, deletions included. A broken,
truncated or unsupported artifact is a named error before a sandbox exists. Persisting a template
sandbox between turns is deferred (`snapshot()` / `createSandbox({ snapshot })` over a template:
`NotImplementedError('isolate-host.sandbox-template-snapshot')`,
`distribution/isolate-host-sandbox-template-snapshot`). Everything of `isolate-host-live-sandbox`
that holds for a sandbox without a template holds over a template too, except its snapshot round
trip (its I9), deferred with persistence.

## User scenario

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
   template hold one copy of it in the consumer, each idle one only its own changes (with, while
   the width dependency stands, the template directories it touched — map.md).
8. A guest that breaks its own runtime (replaced intrinsics) cannot leave a tree its file
   operations did not produce while its run reads as success (live-sandbox I1).
9. The README shows building the template from `package.json` + lock and requiring each of the
    four libraries.

## Invariants

<!-- False on main @ 57152054d (all): `createSandbox({ template })` → NotImplementedError
(sandbox.ts:656); the codec is always called with `template: null` (sandbox.ts:334, :692, :723,
child/main.ts:310, :355); `ExecResult` has no changed paths (sandbox.ts:84); no README template
example; a hand-laid
`node_modules` is part of the state: probe arm `full`, T95 exec 392 ms worker side + ~150 + ~170 ms
consumer encode/decode per exec, isolate floor 215 MiB, state 96 MB, every host write encodes it
(README: «one `writeFile` / one state intake after a run: 1 MB state 1 / 2 ms; 16 MB 19 / 19 ms; 56 MB near the cap 69 / 67 ms»)
(`docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md`). -->

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
  (`scripts/measure.mjs`) as a sweep — template bytes × entries × directory width × depth, host
  `writeFile` / `readFile` / `list` / `remove` and the next `exec`'s wire, at `/workspace` and at
  template directories of depth 0–2 — each claim «does not grow» a row with a last/first ratio ≈ 1, each other
  slope named in the README (probe W's shape): host-op medians, idle memory per sandbox, the consumer's peak memory per
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
  or not), `rename`, `cpSync`, `copyFileSync`, `utimes`, read, `readdir` and `stat` sequences over
  a small template and new paths runs each sequence on the layered FS and on rifty's FS without a
  template holding the same files: every `FsSync` call's whole returned value (all of `stat` but
  `ino`) and the tree after the state is carried over the wire
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

## Challenge

challenge: 2026-11-24 — 9 problems (fresh critic on the requirements, earlier user words, ADR-0567/0568, probes and the draft recommending the worker-owned FS; verified, dispositions)

1. `lazy` and `worker` tie on the probe; `worker`'s extra value is the capture unit and a keepable killed run; the capture unit's own primordial-codec candidate was unweighed — accepted: F1 lists (b′), recommendation moved to (b).
2. The `worker` arm restored its difference outside the timed window — fixed in `layer.mjs`; `bigdiff` (16 MiB): worker 51.8 vs lazy 39.5 ms.
3. Chunked I/O on the agent's files crosses the bridge per chunk under `worker` — measured: 259 vs 64 ms, 541 MB copied for 8 MiB; recorded in F1 (c).
4. A worker holding templates sits at the idle-retire line — ADR-0572 Consequences: watermark and ceiling include held templates.
5. Template decode on the worker's main thread delays every slot — ADR-0572 Consequences.
6. A write-less shared buffer for `views` — not built: the guest that breaks its rifty can write it (ADR-0572 Alternatives).
7. (c) amends the live-sandbox Outcome «The files stay rifty's in-memory filesystem in the guest's own realm» and repeats the seam the goal's reading rejected — F1 is the user's, both quoted in ADR-0572 §Trust.
8. Identity: every tar-changing rebuild orphans stored snapshots — requirements §2 mandate the loud refusal; consequence recorded with the deferred snapshot (`distribution/isolate-host-sandbox-template-snapshot`), not a fork.
9. Tools as a fresh subpath export would be a second implementation against the user's «никакой второй независимой реализации; нужен общий набор инструментов» — `epics/isolate-host-agent-tools` Decisions changed to one shared core.

Reconsidered 2026-11-25 for the user's amendments (no persistence; F1 (a); both modes): the route is the user's choice (critic findings 1–6 bear on (b)/(c), now deferred items); the user first proposed keeping it simple («оставить как есть»), asked for the practical value, and accepted the agent's recommendation of (a) with extrapolated four-library figures (not measured — hence the return condition in Decisions); the 2026-11-24 critic saw the measured `views` arm on T95; premise reused.

Final written-result check 2026-11-25 (fresh reviewer, goal/map/ADR-0572/new items with the requirements and the user's answers): 9 findings — I9 contradicted the deferred snapshot (fixed: live-sandbox I1–I8), scenario step 9 untraced (I10 added), identity/registry id (I1), stale texts and refs (fixed); recheck at 923e15568: one stale I# range (fixed), no new findings.

External review of PR #429 @ a7d164476 (the manager's independent reviewer, 2026-11-25): 1 blocker, 9 should, minors; dispositions —
B1 host-op cost and idle memory violated requirements §3 behind «bytes» wording → design changed to a consumer-side overlay (ADR-0572 §2), probe H, I4/I5 restated with O(write + difference) and tolerances;
S1 F1 quotes incomplete, extrapolated figures shown as measured → all three replies and the figures quoted, marked extrapolated, return condition added, «measured and published» labeled the agent's reading;
S2 killed-run question, F5 recommendation and the 2026-11-17 attribution → quoted in full, `isolate-host-rejection-in-exit-listener-exits-0` owned by `isolate-host-agent-tools`;
S3 library dependency stale vs main → rewritten from compat @ 57152054d (all four libraries' I10 `require`s succeed);
S4 capture unit had two owners → owned here, live-sandbox closes there;
S5 ADR leftovers of (b) → A′ reason, peak memory, «Not the user's words» list, PR #437 as an external dependency of read-only mode (no sync-only wrapper alone), title;
S6 amendments of ADR-0567/0568 unnamed → ADR-0572 §Amends, the isolate rule and the restore refusal for a template that does not fit;
S7 I3/I5 uncheckable → oracle named (map fog), T1/T95/four-library and tolerances;
S8 map order → I8's loud gap with intake (item 2), cache with the frame (item 3);
S9 probe gaps → README «Not probed» extended.
Fresh final check after these fixes (2026-11-25, new reviewer): 9 findings, recheck 2 more (I5 had no checkable row for the consumer's peak per run — added; ADR §6 T95 arithmetic — corrected) — scenario 7 had narrowed «~95 MB» to the four-library template without the user (restored), I5 tolerances not checkable (restated: deterministic T1/T95, structural unit tests, published measurement), a silent `exec` between map items 2 and 4 (item 2 refuses it by name), stale section refs, #437's base, ADR §6 arithmetic, ADR-0567 §4 wording, a duplicate owner line, the prebuild list — all fixed.

Second external review of PR #429 @ 9624b9c9d (the manager's reviewer): N1 (blocker) — the consumer's accumulated deleted set and the guest's capture-by-view-identity lost files (remove → write the same path; a renamed template entry), S-a — the consumer overlay was a second hand-written tree (ADR-0568 §2, «никакой второй независимой реализации»), S-b — packages not in the manifest, S-c — I5 checks ambiguous or at noise level, S-d — the F1 return condition undefined and above the figures shown; dispositions — one `LayeredFsSync` for both realms with a derived difference (ADR-0572 §2), probe S 23/23 vs live Node + mutation check, I11 added, I6 «changed» defined; packages from the lock (I1); I5 structural (lookups, frames, codec I/O counted); return condition defined with tolerances over the shown figures, measured in map items 5 and 7; minors fixed.
Fresh final check after the redesign (2026-11-25, new reviewer @ ff003bbf8): 9 findings (cost bound of the derived difference, the rename ceiling undeclared, map item refs, «…» in quotes, A′ figures, concurrency note, `seq.mjs` gate + run → run + minimality, the memory method, an implementation name in the Outcome) — fixed; recheck @ 503d5bfa1: the Outcome's equality needed the rename ceiling's exception and its whole-run rollback, its compat row an owner — fixed.

Third external review of PR #429 @ ee8614363 (the manager's reviewer): N2 (blocker, the class's third round) — the existence-derived difference kept template children under a renamed-then-recreated directory and broke file ↔ directory replacements; S1 — host-op cost O(touched), not §3's «O(размер записи + дифф)»; S2 — the F1 metric (an empty file) blind to the per-call cost; S3 — the rename ceiling without owner; S4–S6 — probe table, oracle coarseness and an unreproducible mutation count, item refs; minors (shared bytes unguarded, a moved directory's mtime on first readdir, I5 counts for `remove`/`cpSync`, the #437 overlap); dispositions — the state by node identity, once (ADR-0572 §2), I11 generated (probe G: 0 / 3 000 vs 302 / 3 000 for the old rule, guest sample 60 / 60, shared bytes hashed), N2's rows named (probe S 29/29); the budget kept per operation (H: 0.05 ms after touching the whole template); the metric on the four libraries' generators (probe F, recorded noisy); the ceiling removed (a rename moves a marker); probe README rebuilt from its outputs; refs fixed; minors folded into I4/I5 and ADR Consequences; rifty-fs divergences the generator exposed recorded as `runtime-js/fs-generated-sequence-divergences-from-node`.

Fresh final check after the N2 fixes (2026-11-25, new reviewer @ 3c3971679): blocker — half of the rule was missing: every materialized node went on the wire, so `require` of the four libraries put 3 317 rows on it and the state grew with reading (against the Outcome, scenario 7, requirements §3); should — the per-operation budget missed parents a copy creates and drifted by `/` on rebuild, unchecked by G; minors — stale figures, the guest «flat» arm was the same class over an empty index, no generated run boundary, coarse times. Dispositions — the rule's second half (an untouched node is one row, `lazy` collapses an untouched subtree; ADR-0572 §2), the cap counted over the state by the same walk; G gains a run boundary, a budget check against an independent wire count, a reads-only minimality check and a plain `MemoryFsSync` guest arm (v3 0 / 3 000 on every count; v2 grows on reads 3 000 / 3 000); a dropped change mark caught 118 / 1 000; F re-measured at load ~5 (inside the return condition); figures refreshed from committed outputs.
Recheck @ 7cda4de03 (same reviewer, five mutants of the new rule all caught: 93–2 171 / 3 000): the Outcome's «neither grows with the template» needed the fan-out of a changed template directory named, and H's after-listing write was not isolated from the row's own files — both fixed (H re-measured: 0.02 ms fresh and after listing).

Fourth external review of PR #429 @ 1594114f5 (the manager's reviewer; N2 closed on content, kind and times, 30 000 new seeds and 20 000 sequences of its own generator clean): Б1 (blocker) — a write inside a template directory costs and carries rows by that directory's width, a narrowing of §3 presented as meeting it («neither grows with the template's bytes», «not by its size», «meets both»), the third round of «a bound weaker than §3, claimed met» (B1 → S1 → Б1), each time found by a reviewer; S-a — `stat` of a lazy template directory gave another `nlink` (2 vs 3), `stat` absent from G; S-b — `cpSync` marked only its destination root, a nested overwrite held by a backend mtime side effect; S-c — the rifty-fs finding misdescribed its two silent successes; minors. Dispositions — Б1: claims removed, the dependency named with probe W's sweep (bytes × width × files × depth × operation × place; only width at template places has a non-zero slope), the fork to the user (map.md), goal back to draft; S-a: `stat` materializes a lazy directory, G gains `stat` with the whole returned value, a `stat-lazy` mutant red (18 / 1 000, minimized to one `stat('/node_modules')`); S-b: `cpSync` marks every destination path, G gains a times-independent mark audit, a `cp-dest-only` mutant red (named row + 1 / 1 000); six mutants reproducible by `--mutant`; S-c: the finding rewritten (minimal calls, `rifty-fix`, the coupling with S-b); minors fixed.

Fresh final check after review 4's fixes (2026-11-25, new reviewer): the `cpSync` fix marked the whole destination tree (a 1-file copy into `/node_modules` → 25 000 rows) — fixed: a copy materializes only the directories it writes into and marks only the paths it writes; the sweep had measured reads, `list` and `stat` after a write (hiding the first-touch cost), varied no rows already on the wire, no idle memory, no `cp` / `rename` — sweep W rebuilt (first touch, write, remove, rename, copy, a `/workspace` write after a template write, idle fresh and after a listing; plus the real four-library template): width is the one axis with a slope, every operation touching a template directory grows with its width; the Б1 dependency and the user's question widened to that (sent to the manager, who asks the user in that wording); minors (ratio wording, cap figure range, oracle `ctime` artifact, whole `stat` in the guest sample) fixed.

## Decisions

- 2026-11-24 — agent: requirements 1–3, the live-sandbox unit `distribution/isolate-host-sandbox-capture-outside-guest-realm` and the changed-paths list are one goal (the manager's brief: the capture is rewritten for the diff anyway).
- 2026-11-24 — agent: tier robust, as `isolate-host-live-sandbox` — state over runs, caches per process and per worker, concurrency; every reachable axis × operation gets an honest outcome and a fault test.
- 2026-11-24 — agent: a template's identity (the registry's and the workers' cache key) = `{ rifty/manifest.json templateId, snapshotId }` — `snapshotId` is the sha256 of the decoded tar (`dep-snapshot-producer.ts:203`), the same for gzip and br, recomputable from the artifact alone; `installArtifactIdentity` is a build constant shared by every template one rifty build makes, so it identifies none.
- 2026-11-24 — agent: the producer stays `@riftydev/workbench`'s `produceDependencySnapshot`, documented as usable from Node CI: published `@riftydev/workbench@0.11.0` produced the four libraries' artifact in plain Node 24 (library probe, PR #430 as merged: 10–12 s, 19.9 MB gzip `frozen`, two runs byte-identical; `payload/node_modules` = the `npm ci` tree except `.bin` entries (plain files, not links) and no `.package-lock.json`, no shadow substitution); the repo's own `packages/workbench/dist` does not load in plain Node (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, same probe) — the packed package does (`tests/integration/workbench-packed-consumer.mjs`). The acceptance carrier builds its template with it, so the isolate fit is proven by the scenario.
- 2026-11-25 — user: «Давай запишем бэклок, но пока делать не будем. И оставим как есть. Я понимаю, что сейчас файлы исчезнут?» (F4, a killed run's writes; the agent's answer: «Да, сейчас файлы такого прогона исчезают. Если прогон убит (`timeout`, память, отмена), песочница возвращается к состоянию до этого прогона. Пропадает всё, что он успел записать, `out.pptx` тоже. Файлы прошлых прогонов остаются.») — a killed run (`timeout`, `memory`, abort) rolls back to the state of before (the sandbox's difference and its template-file changes); keeping its writes stays `distribution/isolate-host-sandbox-killed-run-partial-writes` (draft, route recorded there).
- 2026-11-25 — user: «И сохранение снапшота песочницы не нужно. Решили, что сохранять все это не будем. Агент может [поработать] с песочницей и забрать из живой песочницы файл. После этого песочницу уничтожаем. Так что все задачи про сохранение и изменение снапшота мы кладем в бэк-лог, и пока не делаем.» (bracket: the voice input's «подъем кто-то», the agent's reading) — requirements §2 (diff-only snapshot, restore by template identity, format v2, compressed budget) leave this goal for `distribution/isolate-host-sandbox-template-snapshot`; over a template, `snapshot()` and `createSandbox({ snapshot })` are `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌. Kept: the template, cost independence of host ops and consumer memory (§3, narrowed for runs by F1 below), changed paths, the capture unit (a run's end state still becomes the state for the sandbox's next run).
- 2026-11-25 — user: «Я бы на самом деле поддержал оба варианта, чтобы можно было выбирать, как ты хочешь написать, сделать [read-only] или [не read-only].» (F2; brackets: the voice input's «редогли или нередонгли», the agent's reading) — a template is writable or read-only, chosen per sandbox (the agent's reading of «выбирать»). Agent: writable by default (an `npm ci`'d `node_modules` is writable), read-only an option of `createSandbox`.
- 2026-11-25 — user: «ок» (F3, «`/node_modules`, без `package.json` и lock — рекомендую») — the mount is `/node_modules`, only the artifact's `payload/node_modules`.
- 2026-11-25 — user, F1 (who holds the run's FS), in three replies: «правильно понимаю, что проще пока оставить как есть? Если так давай оставим + обсужденную версию в бэклог запишем»; then «давай Не с формальной точки зрения про соответствие требования, а с точки зрения того, какую пользу это нам даст.»; then «ок» to the agent's message, whose figures and recommendation were: «Память. Копирование добавляет ~90–100 МиБ памяти изолята на каждый одновременный прогон. При лимите по умолчанию 256 МиБ коду агента остаётся ~130 МиБ вместо ~235, и тяжёлые генераторы (exceljs) раньше упадут по памяти. 8 одновременных прогонов — это ещё ~0,8 ГБ RAM на машине. Это главный выигрыш ленивого варианта.», «Задержка. Примерно +50 мс на `exec` (на шаблоне в 23 тыс. файлов было +120 мс)», «Рекомендация: сейчас копировать шаблон в изолят — это ближе всего к «оставить как есть», как вы и предлагали. Ленивое чтение записать в backlog с поводом взяться: память на одновременный прогон становится узким местом или шаблон заметно растёт. Цена: требование потребителя «стоимость не зависит от размера шаблона» по памяти и задержке выполнится не полностью. Снапшот по-прежнему будет только диффом, а стоимость хостовых записей от шаблона не зависит.» The four-library figures were extrapolated from probe L's T95 arm `views` by entries and bytes, not measured. «Снапшот по-прежнему будет только диффом» there meant the run's state on the consumer ↔ worker wire (the user had just deferred `snapshot()` persistence); `snapshot()` over a template refuses (I8). — A fresh isolate gets the template per run (ADR-0572 §3); the agent's reading: requirements §3's constant `exec` latency and isolate memory become «measured and published» (I5), host-op cost stays independent (as the message promised). Return condition (the agent's tolerances over the figures the user saw — ~+50 ms per `exec`, ~90–100 MiB): on the four-library artifact, on an idle machine (load < 2), median of 7 warm runs — each canonical generator of the four libraries (the carrier's) over the template slower than the same program with the same files in the sandbox's state by more than 50 ms + 20 ms (its run phase only: what the template mechanism adds to a real program), or four such runs at once by more than that, or an empty file's smallest passing `memoryLimitMb` (bisection, 4 MiB steps) above an empty sandbox's without a template by more than 100 MiB + 8 MiB → the run stops and the numbers go back to the user (goal conflict, `AGENTS.md` §Fidelity); measured in map items 5 and 7. Probe F (`gens.mjs`, the third construction, load ~5): empty +20 ms; generators pdf +21, docx +18, pptx +25, xlsx +19 ms; four at once pdf +41, xlsx +7 ms; floor 103 vs 19 MiB — inside the condition; the carrier re-measures on landed code. Lazy template reads: `distribution/isolate-host-sandbox-template-lazy-read`.
- rejected route: the template inside the sandbox's state (a hand-laid `node_modules` in the snapshot, today's only path) — violates I4.
- rejected route: a per-sandbox `MemoryFsSync` of views into the template in the consumer, the cap check walking it (ADR-0572 draft before 2026-11-25 review) — violates I4/I5: probe H, T95 — `writeFile` 10 KiB 30.0 ms vs 0.02 ms (`layered`), idle 9.3 MiB per sandbox vs 4 KiB.
- rejected route: a hand-written consumer overlay (difference + deleted set) beside a guest-side materialization with its own apply/capture rules (ADR-0572 draft after B1) — violates I11 (remove → write the same path lost the file; a renamed template entry was not emitted) and ADR-0568 §2 «no second implementation».
- rejected route: a layered FS whose difference is derived from path existence and times (deletions = materialized template paths now gone; `layered-v1.ts`, ADR-0572 draft after N1) — violates I11: probe G, 302 of 3 000 generated sequences differ from rifty's FS without a template (first: a lone `rename` of a template directory), review N2's renamed-then-recreated directory and file ↔ directory among them.
- rejected route: every node the layered FS holds on the wire (`layered-v2.ts`, ADR-0572 draft after N2) — violates I4 (reads change nothing) and the Outcome's «reading the template never changes the state»: probe G, reading grew the state in 3 000 / 3 000 sequences; a `require` of the four libraries' 815 loaded files put 3 317 rows on the wire (the fresh reviewer's measure, /tmp, not committed; probe G's count is the committed evidence).
- rejected route: the worker owns the run's whole FS (ADR-0572 §Forks F1 (c)) — violates the live-sandbox Outcome clause «The files stay rifty's in-memory filesystem in the guest's own realm», which this goal's Outcome keeps; recorded with its costs in `distribution/isolate-host-sandbox-killed-run-partial-writes`.
- 2026-11-25 — agent: the template comes as artifact bytes or a registered id because requirements §1 name both («либо идентификатор шаблона, заранее зарегистрированного в процессе»): bytes for one-off use, the id to hand many `createSandbox` calls one decoded copy.
- 2026-11-25 — agent (external reviews of PR #429, B1 → N1/S-a → N2 → the fresh check → Б1/S-a/S-b): one `LayeredFsSync` (ADR-0572 §2) runs both the consumer's host ops and the guest's `fs`; its state is described by node identity — a node untouched from its template origin is one row (`lazy` / `ref`), anything else explicit, an explicit directory opaque — never derived from path existence; the state cap is the count of that description; `stat` of a lazy directory materializes it, `cpSync` marks every path it writes. Probe G (`gen.mjs`, `stat` in the grammar, whole return values, a mark audit): 0 / 3 000 generated sequences and 0 / 7 named regressions differ from rifty's FS without a template, with a run boundary or in the cap's count, reads never grow the state (existence-derived: 233 / 3 000 differ; every-node: reading grew the state in 3 000 / 3 000); guest sample 300 / 300; shared template bytes unchanged; six mutants of the rule red (`--mutant`); probe S 30/30 named rows; probe W: flat on bytes, entries and depth, linear in a template directory's width for writes inside it (the open fork).
