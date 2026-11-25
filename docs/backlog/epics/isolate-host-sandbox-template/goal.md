---
kind: epic
status: draft
title: Isolate host sandbox template — libraries from a dependency artifact, cost independent of the template
created: 2026-11-24
value: A Node service starts every agent sandbox over one prebuilt `node_modules` (pptxgenjs, pdf-lib, docx, exceljs) from `produceDependencySnapshot`, and pays the same per run and per host write whatever the template's size.
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
shared by every sandbox over it, never part of a sandbox's per-run state; the state cap counts the
sandbox's difference from it. A run's cost (latency, consumer memory, isolate memory) and a host
op's cost do not grow with the template; the README's cost table shows it for a ~1 MB and a ~95 MB
template. `exec` reports the paths the run changed, with sizes, deletions included. A broken,
truncated or unsupported artifact is a named error before a sandbox exists. Persisting a template
sandbox between turns is deferred (`snapshot()` / `createSandbox({ snapshot })` over a template:
`NotImplementedError('isolate-host.sandbox-template-snapshot')`,
`distribution/isolate-host-sandbox-template-snapshot`). Everything of `isolate-host-live-sandbox`
that holds for a sandbox without a template holds over a template too.

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
7. The agent runs `node` many times per turn: a warm `exec`, a host `writeFile`/`list`/`remove` and
   the consumer's peak memory per run differ between a ~1 MB and a ~95 MB template by at most a
   constant; an empty sandbox over the ~95 MB template runs with the default `maxFsBytes` and
   `memoryLimitMb`; N sandboxes over one template hold one copy of it in the consumer.
8. A guest that breaks its own runtime (replaced intrinsics) cannot leave a tree its file
   operations did not produce while its run reads as success (live-sandbox I1).
9. The README shows building the template from `package.json` + lock and requiring each of the
    four libraries.

## Invariants

<!-- Drafted at FIT once map.md's owner: user questions are answered; evidence (all false on
main @ b3731e9c0): `createSandbox({ template })` → NotImplementedError (sandbox.ts:499-502);
the codec is always called with `template: null` (sandbox.ts:256, :568, child/main.ts:310, :355);
a hand-laid template is part of the state: probe arm `full`, T95 exec 392 ms worker side + ~150 +
~170 ms consumer encode/decode, isolate floor 215 MiB, state 96 MB
(`docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md`). -->

## Challenge

challenge: 2026-11-24 — 9 problems (fresh critic on the requirements, earlier user words, ADR-0567/0568, probes and the draft recommending the worker-owned FS; verified, dispositions)

1. `lazy` and `worker` tie on the probe; `worker`'s extra value is the capture unit and a keepable killed run; the capture unit's own primordial-codec candidate was unweighed — accepted: F1 lists (b′), recommendation moved to (b).
2. The `worker` arm restored its difference outside the timed window — fixed in `layer.mjs`; `bigdiff` (16 MiB): worker 51.8 vs lazy 39.5 ms.
3. Chunked I/O on the agent's files crosses the bridge per chunk under `worker` — measured: 259 vs 64 ms, 541 MB copied for 8 MiB; recorded in F1 (c).
4. A worker holding templates sits at the idle-retire line — ADR-0572 Consequences: watermark and ceiling include held templates.
5. Template decode on the worker's main thread delays every slot — ADR-0572 Consequences.
6. A write-less shared buffer for `views` — not built: the guest that breaks its rifty can write it (ADR-0572 Alternatives).
7. (c) amends the live-sandbox Outcome «The files stay rifty's in-memory filesystem in the guest's own realm» and repeats the seam the goal's reading rejected — F1 is the user's, both quoted in ADR-0572 §Trust.
8. Identity: every tar-changing rebuild orphans stored snapshots — requirements §2 mandate the loud refusal; consequence recorded (ADR-0572 Consequences), not a fork.
9. Tools as a fresh subpath export would be a second implementation against the user's «никакой второй независимой реализации; нужен общий набор инструментов» — `epics/isolate-host-agent-tools` Decisions changed to one shared core.

## Decisions

- 2026-11-24 — agent: requirements 1–3, the live-sandbox unit `distribution/isolate-host-sandbox-capture-outside-guest-realm` and the changed-paths list are one goal (the manager's brief: the capture is rewritten for the diff anyway).
- 2026-11-24 — agent: tier robust, as `isolate-host-live-sandbox` — state over runs, caches per process and per worker, concurrency; every reachable axis × operation gets an honest outcome and a fault test.
- 2026-11-24 — agent: a template's identity (the registry's and the workers' cache key) = `{ rifty/manifest.json templateId, snapshotId }` — `snapshotId` is the sha256 of the decoded tar (`dep-snapshot-producer.ts:203`), the same for gzip and br, recomputable from the artifact alone; `installArtifactIdentity` is a build constant shared by every template one rifty build makes, so it identifies none.
- 2026-11-24 — agent: the producer stays `@riftydev/workbench`'s `produceDependencySnapshot`, documented as usable from Node CI: published `@riftydev/workbench@0.11.0` produced the four libraries' artifact in plain Node 24 (library probe, PR #430: 14–16 s, 19.9 MB gzip `frozen`, two runs byte-identical; `payload/node_modules` = the `npm ci` tree minus `.bin`/`.package-lock.json`, no shadow substitution); the repo's own `packages/workbench/dist` does not load in plain Node (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, same probe) — the packed package does (`tests/integration/workbench-packed-consumer.mjs`). The acceptance carrier builds its template with it, so the isolate fit is proven by the scenario.
- 2026-11-25 — user: «Давай запишем бэклок, но пока делать не будем. И оставим как есть.» (F4, a killed run's writes) — a killed run (`timeout`, `memory`, abort) rolls back to the state of before (the sandbox's difference and its template-file changes); keeping its writes stays `distribution/isolate-host-sandbox-killed-run-partial-writes` (draft, route recorded there).
- 2026-11-25 — user: «И сохранение снапшота песочницы не нужно. Решили, что сохранять все это не будем. Агент может [поработать] с песочницей и забрать из живой песочницы файл. После этого песочницу уничтожаем. Так что все задачи про сохранение и изменение снапшота мы кладем в бэк-лог, и пока не делаем.» (bracket: the voice input's «подъем кто-то», the agent's reading) — requirements §2 (diff-only snapshot, restore by template identity, format v2, compressed budget) leave this goal for `distribution/isolate-host-sandbox-template-snapshot`; over a template, `snapshot()` and `createSandbox({ snapshot })` are `NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌. Kept: the template, cost independence (§3), changed paths, the capture unit (a run's end state still becomes the state for the sandbox's next run).
- 2026-11-25 — user: «Я бы на самом деле поддержал оба варианта, чтобы можно было выбирать, как ты хочешь написать, сделать [read-only] или [не read-only].» (F2; brackets: the voice input's «редогли или нередонгли», the agent's reading) — a template is writable or read-only per sandbox. Agent: writable by default (an `npm ci`'d `node_modules` is writable), read-only an option of `createSandbox`.
- 2026-11-25 — user: «ок» (F3, «`/node_modules`, без `package.json` и lock — рекомендую») — the mount is `/node_modules`, only the artifact's `payload/node_modules`.
