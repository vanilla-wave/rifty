---
kind: epic
status: draft
title: Isolate host sandbox template — the libraries of a dependency artifact as the sandbox's own files at /node_modules
created: 2026-11-24
value: A Node service starts an agent sandbox over prebuilt `node_modules` (pptxgenjs, pdf-lib, docx, exceljs) from its own `produceDependencySnapshot` artifact, decoded once per process, with no conversion on its side; the price of a template held as the sandbox's files is measured and published.
user_story: As a Node service whose agent writes document generators against preinstalled libraries, I want `createSandbox({ template })` from my dependency artifact, but today `template` is `NotImplementedError('isolate-host.sandbox-template')` and the only route lays `node_modules` out with the package's internal codec, which a consumer cannot import.
tier: robust
---

## Outcome

`@riftydev/isolate-host` accepts the artifact `produceDependencySnapshot` makes (gzip or br,
profile `replay` or `frozen`) — directly, or by the identity `registerTemplate` returned for it in
this process — as a sandbox's template. The artifact is decoded once per process; a broken,
truncated or unsupported artifact, or an unknown identity, is a named error before any sandbox
exists. The template's `payload/node_modules` becomes the sandbox's own files at `/node_modules`
(no `package.json`, no lock, no `rifty/*`): from then on they are files of the live sandbox
exactly like the agent's (ADR-0568: a fresh isolate per `exec`, the state = bytes held by the
consumer). `require('<lib>')` from `/workspace/main.js` resolves into them as Node's resolution
does, and the four libraries write the files Node writes. Per sandbox the template is writable (a
change or deletion seen by that sandbox's later runs and host ops) or read-only (a write under the
mount fails as on a read-only mount). The template counts in `maxFsBytes` and in the run's isolate
memory like any files; what has to be raised is a named error with the number and is in the README,
with a cost table measured through the public API on the four-library artifact. Everything
`isolate-host-live-sandbox` holds for a sandbox without a template holds over one, except its
snapshot round trip: persisting a template sandbox is deferred, a loud refusal.

Declared deferred, by the user's choice (Decisions 2026-11-25): requirements §3 «стоимость не
зависит от размера шаблона» — here every `exec` restores and captures the whole state (~0.6 s for
an empty file, 0.83–0.99 s per generator), each sandbox holds ~88 MB, a host write encodes the
whole state. The next steps (`distribution/isolate-host-sandbox-template-layer`,
`distribution/isolate-host-sandbox-live-isolate-per-turn`) are meant to change only that price; the
template layer keeps the service's contract, the live isolate cannot keep two of its properties —
`exec`'s per-call `memoryLimitMb` and «an idle sandbox holds no process or isolate» (Decisions
«contract stability»; a fork for that step).

## User scenario

1. In CI the service runs `produceDependencySnapshot` (`@riftydev/workbench`, plain Node) over its
   `package.json` + lock for `pptxgenjs`, `pdf-lib`, `docx`, `exceljs` and stores the artifact.
2. At start it calls `registerTemplate(artifact)` and keeps the returned `{ id, version }` (or hands
   the artifact itself to `createSandbox`). A corrupted, truncated or unknown-format artifact is
   refused by name, before any sandbox exists.
3. Per agent turn it calls `createSandbox({ template, maxFsBytes })` with the `maxFsBytes` the README
   names for its template (too low → a named error with the number), writes `/workspace/main.js`
   and runs `exec('main.js', { args: ['out.pptx'] })`: `require` of each of the four libraries
   resolves into `/node_modules` as Node resolves `require` from a file below a `node_modules`;
   `rifty/*` is not visible to the guest; the generator writes a valid document and the host reads
   its bytes from the live sandbox.
4. Over a writable template a file the agent changed or deleted under `/node_modules` is seen
   changed or absent by that sandbox's later runs and host ops, by no other sandbox; over a
   read-only one that write fails `EROFS` and the template stays as it was.
5. A run that is killed (`timeout`, memory, abort) leaves the sandbox as before it, template files
   included.
6. At the end of the turn the host has taken the files it needs and destroys the sandbox; nothing
   of it is kept (`snapshot()` over a template is a loud refusal).
7. The README shows building the template from `package.json` + lock, requiring each of the four
   libraries, and the cost table: what an `exec`, a sandbox and a host write cost with this
   template and which `maxFsBytes` / `memoryLimitMb` it needs.

## Invariants

<!-- False on main @ 3d16cb7b8 (all): `createSandbox({ template })` → NotImplementedError
(`sandbox.ts:656`); no `registerTemplate` export (`src/index.ts`); the codec is always called with
`template: null` (`sandbox.ts:334`, `:692`, `:723`); README `:125` «not implemented»; compat
`isolate-host.md:96` ❌; the four libraries run only from a state built with the internal
`dist/codec.js` (`tests/package-closure.ts`, library probe PR #430); no read-only mode exists in
rifty's FS (no `EROFS` producer in `packages/vfs/src`, `runtime-js`, `isolate-guest`). -->

- I1. Intake: `registerTemplate(artifact)` and `createSandbox({ template })` accept a
  `produceDependencySnapshot` artifact — gzip or br, profile `replay` or `frozen` — and
  `createSandbox` also the identity `registerTemplate` returned; the identity `{ id, version }` is
  the manifest's `templateId` and the producer's `snapshotId` (sha256 of the decoded tar, the same
  for gzip and br), documented; an artifact already registered in the process is not decoded again
  (counted); a corrupted, truncated or unsupported artifact, and an unknown identity, are refused
  with a named error before any sandbox exists; the consumer converts nothing.
- I2. Mount: the guest sees exactly the artifact's `payload/node_modules` at `/node_modules`,
  byte for byte, and nothing else of the artifact (`rifty/*`, `payload/package.json`, the lock);
  `require('<lib>')`, `require.resolve` and `module.paths` from `/workspace/main.js` give what live
  Node v24.16.0 gives over the same tree.
- I3. Libraries, public API only: the four canonical generators of the library probe (`gen/pdf.cjs`,
  `gen/docx.cjs`, `gen/pptx.cjs`, `gen/xlsx.cjs`) run in a sandbox created by `createSandbox({ template })`
  from a real `produceDependencySnapshot` artifact of the four libraries, exit 0, and write the
  document live Node writes over the same `node_modules` (timestamps masked, the probe's masks), a
  valid one (PDF: `pdf-lib` loads it in Node; OOXML: a ZIP whose XML parts parse) — no import of
  the package's internals anywhere on the path. In rifty's CI.
- I4. Writable (default): a change, creation or deletion under `/node_modules` — by the guest or by
  a host op — is seen by that sandbox's later runs and host ops, by no other sandbox over the same
  template, and by no sandbox created later.
- I5. Read-only, per sandbox (user: both modes): every call whose writes reach `/node_modules`, from
  the guest (sync, callback, promise and stream forms) and from host ops, fails as Node v24.16.0
  fails it on a read-only mount (code, syscall, path) and leaves the template as it was.
- I6. Limits, honest: the template counts in `maxFsBytes` as any files. `createSandbox` over a
  template with `maxFsBytes` below the codec's budget of an empty sandbox over it rejects
  `ERR_OUT_OF_RANGE` naming that number; past it a host write is `ERR_ISOLATE_HOST_SANDBOX_FULL`
  and a run's end state `stateRefused: ERR_FS_SNAPSHOT_TOO_LARGE`; a `memoryLimitMb` below what the
  state needs is the named outcome it is without a template (`stateRefused:
  ERR_ISOLATE_HOST_SANDBOX_RESTORE` or `termination: 'memory'`). The README names the four-library
  artifact's `maxFsBytes` budget and its smallest `memoryLimitMb` for an empty file and each
  generator.
- I7. Unchanged guarantees: what `isolate-host-live-sandbox` I1–I8 hold for a sandbox without a
  template holds over one — a killed or aborted run rolls back its writes under `/node_modules`
  too; destroy, ordering, limits, trust — and its open part stays open for both (I1's «a guest that
  broke its own snapshot», `distribution/isolate-host-sandbox-capture-outside-guest-realm`);
  sandboxes without a template and `runCode` do not change (their suites unchanged and green).
- I8. Persistence deferred, loud: `snapshot()` of a sandbox over a template and
  `createSandbox({ template, snapshot })` throw `NotImplementedError('isolate-host.sandbox-template-snapshot')`
  + compat ❌.
- I9. Price, published: the README's cost table, measured through the public API on the
  four-library artifact — `registerTemplate`, `createSandbox`, a warm `exec` of an empty file and
  of each generator, a host `writeFile`, the consumer's memory per idle sandbox, the I6 numbers —
  and requirements §3 named as deferred with its backlog items.
- I10. Documented route: the README builds the template from `package.json` + lock with
  `produceDependencySnapshot` in plain Node (published `@riftydev/workbench`), registers it, and
  requires each of the four libraries from a sandbox run — the steps I3 runs (the carrier calls the
  workspace producer in vitest; the published package in plain Node: Decisions 2026-11-24).

## Challenge

challenge: 2026-11-25 — 2 problems (one fresh read-only critic with the final written-result check: the user's words, the manager's frame, requirements, the layer draft on main, probe evidence, the RED carrier; verified)

1. The Outcome claimed every next step keeps the contract; the live isolate cannot keep `exec`'s per-call `memoryLimitMb` nor «an idle sandbox holds no process or isolate» (live-sandbox I6) — Outcome and Decisions «contract stability» now name both; reported to the manager.
2. Dropping `exec`'s changed paths and the package list (requirements «Найдено дополнительно», the layer draft's I6 / I1) is the user's, not the agent's — kept as the agent's reversible default, raised with the manager as a fork.

Final-check findings resolved: I7 no longer promises live-sandbox I1's open capture clause; I10's producer evidence (published 0.11.0 in plain Node) restored; map traces corrected (I9 by `scripts/measure-template.mjs`); stale refs fixed (ROADMAP C, `template-lazy-read`, `fs-generated-sequence-divergences-from-node`, agent-tools goal); the read-only interim behavior named (map item 3). Route: the user's explicit choice of the simplest start — no cheaper route found. Stays `draft` until the forks (changed paths / package list, read-only scheduling, the partial contract promise) are answered (recheck 2026-11-25).

## Decisions

- 2026-11-25 — user, on the isolate-lifecycle fork: «Как будто можно начать с самого простого и дальше оптимизировать. Что в данном случае будет самым простым?»; then «ок» to the manager's «Начинаем с „библиотеки = файлы песочницы"? Да — оформляю это целью и запускаю реализацию; слой шаблона и живой изолят уходят в backlog следующими ступенями». What the user accepted (the manager's description, quoted): «Самое простое — библиотеки как обычные файлы песочницы, на том, что уже влито. Без слоя шаблона и без смены жизненного цикла… `createSandbox({ template })` означает „распаковать артефакт в файлы песочницы"… Цена: 0,6–1 с на `exec` и 88 МБ на песочницу; `maxFsBytes` поднять до 95+ МиБ; лимит памяти изолята на запуск от ~215 МиБ… Контракт для сервиса потом не меняется, оба следующих шага остаются открытыми… Что ты этим откладываешь: своё требование §3 „стоимость не зависит от размера шаблона"». → this goal (re-fitted from the ADR-0572 layer draft); requirements §3 declared deferred (Outcome); ADR-0572 stays Proposed (`distribution/isolate-host-sandbox-template-layer`); the lifecycle question stays the user's (`distribution/isolate-host-sandbox-live-isolate-per-turn`).
- 2026-11-25 — user, carried from the layer draft (unchanged by the route): «Я бы на самом деле поддержал оба варианта, чтобы можно было выбирать…» (writable and read-only; per sandbox — the agent's reading of «выбирать»; writable the default, the agent's); «ок» to «`/node_modules`, без `package.json` и lock — рекомендую»; a killed run's writes: «…оставим как есть» (rolled back, `distribution/isolate-host-sandbox-killed-run-partial-writes`); persistence: «сохранять все это не будем… песочницу уничтожаем» (`distribution/isolate-host-sandbox-template-snapshot`).
- 2026-11-24 — agent (kept from the layer draft): the producer stays `@riftydev/workbench`'s `produceDependencySnapshot`, documented as usable from Node CI: published `@riftydev/workbench@0.11.0` produced the four libraries' artifact in plain Node 24 (library probe, PR #430: 10–12 s, 19.9 MB gzip `frozen`, two runs byte-identical; `payload/node_modules` = the `npm ci` tree except `.bin` entries as plain files and no `.package-lock.json`, no shadow substitution); the repo's own `packages/workbench/dist` does not load in plain Node (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) — the packed package does (`tests/integration/workbench-packed-consumer.mjs`). Answers requirements «Производитель артефакта живёт в браузерном пакете».
- 2026-11-25 — agent: tier robust, as `isolate-host-live-sandbox` (state over runs, a process-wide registry, concurrency).
- 2026-11-25 — agent: API — `registerTemplate(artifact: Uint8Array) → Promise<{ id, version }>`; `createSandbox({ template: Uint8Array | { id, version } })`. Bytes handed to `createSandbox` register too (requirements §1 name both forms; one decode per artifact per process, I1); a registered template is kept for the process's life (no unregister: one template per deployment is the scenario; a consumer rotating templates passes bytes and holds ~1 template-size per registration — README).
- 2026-11-25 — agent: identity = `{ id: rifty/manifest.json templateId, version: snapshotId }` — `snapshotId` is the producer's own (`dep-snapshot-producer.ts`: sha256 of the decoded tar), recomputable from the artifact alone; `installArtifactIdentity` is a build constant, it identifies no template.
- 2026-11-25 — agent: one artifact reader — the envelope reader (`dep-snapshot-tar.ts`: ustar + PAX, envelope paths, manifest v4/v5) moves from `@riftydev/workbench` to `@riftydev/npm-client` internal, which workbench and isolate-host (bundled into `dist/codec.js`) both use; isolate-host may not import workbench (`tools/checks/arch-rules.cjs` tiers). Decompression in the consumer realm by `node:zlib` (gzip by magic, otherwise br).
- 2026-11-25 — agent: template file times are the tar's (`mtime` header / PAX; the producer writes 0 → the epoch), as extracting the artifact gives; npm's tarballs carry 1985-10-26, `npm ci` keeps it — the artifact does not (compat row).
- 2026-11-25 — agent: `snapshot()` over a template is a loud refusal (I8), not today's v1 blob of the whole state: the user dropped persistence, and a later layer's diff format would change what such a blob means (contract stability); lifting the refusal only adds.
- 2026-11-25 — agent (reversible default; raised with the manager as a fork, the user owns dropping a row): out of this goal, each with a record — the template's package list (`epics/isolate-host-agent-tools` reads it; requirements §1 ask only identity), `exec`'s changed-paths report (`distribution/isolate-host-exec-changed-paths`, requirements «Найдено дополнительно»), the end state taken outside the guest's realm (`distribution/isolate-host-sandbox-capture-outside-guest-realm`, back to `isolate-host-live-sandbox`: nothing here rewrites the capture).
- 2026-11-25 — agent, contract stability (the manager's promise «контракт для сервиса потом не меняется»), per observable property — a next step may only lower a number or lift a refusal: `createSandbox({ template })` / `registerTemplate` forms and errors — same; identity — same derivation; `/node_modules` content, writable semantics, read-only semantics — same (the layer's modes are these, ADR-0572 §1); `maxFsBytes` — the template counts at most its codec budget, the error names the budget, a layer counts less (only lowers the named minimum); `memoryLimitMb` — the README's minimum only falls (a layer or lazy read copies less); limit errors — same codes; host ops over `/node_modules` — same results, cheaper; `snapshot()` — a refusal, liftable (above); a killed run — rolled back (F4); `exec`'s result — `RunCodeResult` + `stateRefused`, unchanged. Not stable, named: the timing and memory figures (the deferred §3, meant to fall); and one property the live-isolate step cannot keep as is — `exec`'s per-call `memoryLimitMb` bounds that run's own fresh isolate (ADR-0568 §6), while a live isolate holds the sandbox's files and every run in one isolate whose limit is fixed at its creation (isolated-vm) — and «an idle sandbox holds no process or isolate» (live-sandbox I6, ADR-0568 §2) — a live isolate is held between runs by definition; forks for that step, recorded in its item, not this goal's.
- rejected route: the consumer lays `node_modules` out with the internal codec and passes `createSandbox({ snapshot })` (library probe, PR #430) — violates I3 (public API only) and I1 (no conversion on the consumer's side).
- rejected route: a second artifact reader inside isolate-host beside workbench's — violates the Outcome's «named error» parity with the producer's own reader (two readers drift on what is broken); one reader, Decisions above.
