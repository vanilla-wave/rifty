---
kind: epic
status: ready
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
reading of the user's «ок», Decisions); a host op costs O(the template entries the sandbox has
touched since its last run + the difference) and an idle sandbox holds only its difference and
those touched entries (references into the shared copy) — neither grows with the template. What
the host sees is what the next run sees, after any sequence of host ops and runs, as live Node over
a real directory shows it. `exec` reports the paths the run changed, with sizes, deletions included. A broken,
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
   template hold one copy of it in the consumer, each idle one only its own changes.
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
  per-sandbox index of it; per run only the difference crosses to the worker and back; `maxFsBytes`, `ERR_ISOLATE_HOST_SANDBOX_FULL` and
  `stateRefused: ERR_FS_SNAPSHOT_TOO_LARGE` count the difference only.
- I5. Cost. Templates: T1 (~1 MB, ~300 files) and T95 (23 654 files, 95 MB), generated
  deterministically by the carrier (fixed names, sizes and bytes — not the pnpm store), plus the
  four-library artifact. Structural, by unit tests: a host op (`writeFile`, `readFile`, `remove`,
  `list`, the cap check included) reads the template index only to materialize the not yet
  materialized directories on its path (and, for `list(dir)`, `dir`) — exactly their children,
  counted — never a walk of the template; the cap check derives the difference by visiting only the
  entries materialized since the sandbox's last run (counted) and encodes only that difference; a
  warm `exec`'s request frame carries the encoded difference and the deleted list and nothing of
  the template (frame bytes counted), the template travels to a worker once per identity (frames
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
- I11. Sequences: for each row of the sequence table — remove → write the same path, remove a
  directory → write a child (with and without `mkdir`), `rmdir` + `mkdir`, `rename` of a template
  directory, a template file moved out and a file moved in, a rename onto a non-empty directory,
  `utimes`, an overwrite with the same bytes, a write on a directory path, `mkdir` of an existing
  directory, a non-recursive `rm` of a non-empty directory, a copy out — done by the guest, by host
  ops, or host ops then a run, the files the host then sees (`list`, `readFile`, `stat` kind, size
  and file mtime) equal what the next run sees and what live `node` v24.16.0 leaves over a real
  directory holding the same template and files, each call's error code included, also from one
  run to the next; reading template files changes nothing (the difference stays empty of them)
  (probe S's table is the seed). A rename of a template directory moves its whole subtree into the
  difference (rifty's FS has no cross-layer rename): over `maxFsBytes` it is the cap's named result
  (`stateRefused: ERR_FS_SNAPSHOT_TOO_LARGE`), never a partial tree — declared compat ⚠️ (Node
  renames in O(1)).

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

## Decisions

- 2026-11-24 — agent: requirements 1–3, the live-sandbox unit `distribution/isolate-host-sandbox-capture-outside-guest-realm` and the changed-paths list are one goal (the manager's brief: the capture is rewritten for the diff anyway).
- 2026-11-24 — agent: tier robust, as `isolate-host-live-sandbox` — state over runs, caches per process and per worker, concurrency; every reachable axis × operation gets an honest outcome and a fault test.
- 2026-11-24 — agent: a template's identity (the registry's and the workers' cache key) = `{ rifty/manifest.json templateId, snapshotId }` — `snapshotId` is the sha256 of the decoded tar (`dep-snapshot-producer.ts:203`), the same for gzip and br, recomputable from the artifact alone; `installArtifactIdentity` is a build constant shared by every template one rifty build makes, so it identifies none.
- 2026-11-24 — agent: the producer stays `@riftydev/workbench`'s `produceDependencySnapshot`, documented as usable from Node CI: published `@riftydev/workbench@0.11.0` produced the four libraries' artifact in plain Node 24 (library probe, PR #430 as merged: 10–12 s, 19.9 MB gzip `frozen`, two runs byte-identical; `payload/node_modules` = the `npm ci` tree except `.bin` entries (plain files, not links) and no `.package-lock.json`, no shadow substitution); the repo's own `packages/workbench/dist` does not load in plain Node (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, same probe) — the packed package does (`tests/integration/workbench-packed-consumer.mjs`). The acceptance carrier builds its template with it, so the isolate fit is proven by the scenario.
- 2026-11-25 — user: «Давай запишем бэклок, но пока делать не будем. И оставим как есть. Я понимаю, что сейчас файлы исчезнут?» (F4, a killed run's writes; the agent's answer: «Да, сейчас файлы такого прогона исчезают. Если прогон убит (`timeout`, память, отмена), песочница возвращается к состоянию до этого прогона. Пропадает всё, что он успел записать, `out.pptx` тоже. Файлы прошлых прогонов остаются.») — a killed run (`timeout`, `memory`, abort) rolls back to the state of before (the sandbox's difference and its template-file changes); keeping its writes stays `distribution/isolate-host-sandbox-killed-run-partial-writes` (draft, route recorded there).
- 2026-11-25 — user: «И сохранение снапшота песочницы не нужно. Решили, что сохранять все это не будем. Агент может [поработать] с песочницей и забрать из живой песочницы файл. После этого песочницу уничтожаем. Так что все задачи про сохранение и изменение снапшота мы кладем в бэк-лог, и пока не делаем.» (bracket: the voice input's «подъем кто-то», the agent's reading) — requirements §2 (diff-only snapshot, restore by template identity, format v2, compressed budget) leave this goal for `distribution/isolate-host-sandbox-template-snapshot`; over a template, `snapshot()` and `createSandbox({ snapshot })` are `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌. Kept: the template, cost independence of host ops and consumer memory (§3, narrowed for runs by F1 below), changed paths, the capture unit (a run's end state still becomes the state for the sandbox's next run).
- 2026-11-25 — user: «Я бы на самом деле поддержал оба варианта, чтобы можно было выбирать, как ты хочешь написать, сделать [read-only] или [не read-only].» (F2; brackets: the voice input's «редогли или нередонгли», the agent's reading) — a template is writable or read-only, chosen per sandbox (the agent's reading of «выбирать»). Agent: writable by default (an `npm ci`'d `node_modules` is writable), read-only an option of `createSandbox`.
- 2026-11-25 — user: «ок» (F3, «`/node_modules`, без `package.json` и lock — рекомендую») — the mount is `/node_modules`, only the artifact's `payload/node_modules`.
- 2026-11-25 — user, F1 (who holds the run's FS), in three replies: «правильно понимаю, что проще пока оставить как есть? Если так давай оставим + обсужденную версию в бэклог запишем»; then «давай Не с формальной точки зрения про соответствие требования, а с точки зрения того, какую пользу это нам даст.»; then «ок» to the agent's message, whose figures and recommendation were: «Память. Копирование добавляет ~90–100 МиБ памяти изолята на каждый одновременный прогон. При лимите по умолчанию 256 МиБ коду агента остаётся ~130 МиБ вместо ~235, и тяжёлые генераторы (exceljs) раньше упадут по памяти. 8 одновременных прогонов — это ещё ~0,8 ГБ RAM на машине. Это главный выигрыш ленивого варианта.», «Задержка. Примерно +50 мс на `exec` (на шаблоне в 23 тыс. файлов было +120 мс)», «Рекомендация: сейчас копировать шаблон в изолят — это ближе всего к «оставить как есть», как вы и предлагали. Ленивое чтение записать в backlog с поводом взяться: память на одновременный прогон становится узким местом или шаблон заметно растёт. Цена: требование потребителя «стоимость не зависит от размера шаблона» по памяти и задержке выполнится не полностью. Снапшот по-прежнему будет только диффом, а стоимость хостовых записей от шаблона не зависит.» The four-library figures were extrapolated from probe L's T95 arm `views` by entries and bytes, not measured. «Снапшот по-прежнему будет только диффом» there meant the run's state on the consumer ↔ worker wire (the user had just deferred `snapshot()` persistence); `snapshot()` over a template refuses (I8). — A fresh isolate gets the template per run (ADR-0572 §3); the agent's reading: requirements §3's constant `exec` latency and isolate memory become «measured and published» (I5), host-op cost stays independent (as the message promised). Return condition (the agent's tolerances over the figures the user saw): on the four-library artifact, a warm `exec` of an empty file (median of 7) slower than the same without a template by more than 50 ms + 20 ms, or a smallest passing `memoryLimitMb` (bisection, 4 MiB steps) larger by more than 100 MiB + 8 MiB → the run stops and the numbers go back to the user (goal conflict, `AGENTS.md` §Fidelity); measured in map items 5 and 7. Lazy template reads: `distribution/isolate-host-sandbox-template-lazy-read`.
- rejected route: the template inside the sandbox's state (a hand-laid `node_modules` in the snapshot, today's only path) — violates I4.
- rejected route: a per-sandbox `MemoryFsSync` of views into the template in the consumer, the cap check walking it (ADR-0572 draft before 2026-11-25 review) — violates I4/I5: probe H, T95 — `writeFile` 10 KiB 29 ms vs 0.19 ms (layered), idle 9.4 MiB per sandbox vs 4 KiB.
- rejected route: a hand-written consumer overlay (difference + deleted set) beside a guest-side materialization with its own apply/capture rules (ADR-0572 draft after B1) — violates I11 (remove → write the same path lost the file; a renamed template entry was not emitted) and ADR-0568 §2 «no second implementation».
- rejected route: the worker owns the run's whole FS (ADR-0572 §Forks F1 (c)) — violates the live-sandbox Outcome clause «The files stay rifty's in-memory filesystem in the guest's own realm», which this goal's Outcome keeps; recorded with its costs in `distribution/isolate-host-sandbox-killed-run-partial-writes`.
- 2026-11-25 — agent: the template comes as artifact bytes or a registered id because requirements §1 name both («либо идентификатор шаблона, заранее зарегистрированного в процессе»): bytes for one-off use, the id to hand many `createSandbox` calls one decoded copy.
- 2026-11-25 — agent (external reviews of PR #429, B1 then N1/S-a): what the host sees equals what the next run sees by construction — one `LayeredFsSync` (ADR-0572 §2) runs both the consumer's host ops and the guest's `fs` — rifty's `MemoryFsSync` with template entries materialized lazily, its difference derived — so host-op cost and an idle sandbox hold requirements §3's «O(размер записи + дифф)» and «Память простаивающей песочницы у потребителя не включает шаблон», and the consumer's and the guest's trees cannot follow two rules; probe S (23/23 sequences vs live Node), H (T95 `writeFile` 0.19 ms, idle 4 KiB), L (`layered`).
