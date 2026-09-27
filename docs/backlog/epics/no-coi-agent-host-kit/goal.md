---
kind: epic
status: draft
title: no-COI agent host kit — an existing app wires connections only
created: 2026-09-27
value: A team embeds a no-COI rifty sandbox plus the rifty agent into its existing web app by supplying only connections — asset URLs, a storage namespace, an OpenAI-compatible endpoint, a project root and policy values — while every part that affects agent quality ships and is measured inside rifty; the agent installs dependencies when a registry is connected and sees command output in terminal order.
user_story: As a developer embedding rifty into an existing non-COI product, I want `createSandbox` + `@riftydev/agent` to cover open → agent edit → build out of the box, but today I re-derive occupied/busy/progress state, splice two agent hosts for policy, write my own transcript reducer and a full Pi `streamFn` just to switch models and flatten message content.
tier: works
---

## Outcome

The no-COI composition (`createSandbox({ toolchain })` → `project` →
`createSandboxAgentHost` → `createAgentSession`) gains the lifecycle core that
`openWorkbench` owns on the COI path — typed outcomes, a visible wait, real
progress — and the agent parts an existing app cannot author without reaching
into Pi: per-capability policy, per-turn settings, text-only message content,
a transcript model — plus two shell-fidelity repairs the audit surfaced:
`npm install <pkg>` works whenever the host connects a registry and fails
loudly when it does not (I9), and command output reaches the model in
terminal order (I10); other shell gaps the audit listed stay loud and are
named out of scope. An in-repo reference host built from packed tarballs in CI
proves the kit and fixes the boundary: host code is connections (URLs,
namespace, endpoint settings, root, policy *values*); everything that shapes
agent behaviour — policy enforcement, transport shaping, prompt and tool text,
transcript reduction — lives in `@riftydev/sdk` / `@riftydev/agent`, where
rifty's own benchmark measures it (`tools/agent-bench` today; the broader
`epics/agent-code-quality-evaluation` goal is PR #341, not yet on main).

Faithful-runtime payoff: no host heuristic (stopwatch, busy flag, string
match on `error.name`, invented marker) stands in for rifty state; each gap is
a typed loud outcome. Roadmap: M11 Embeddable and M12's "agent whose only
external dependency is an OpenAI-compatible endpoint", in the no-COI form.
Source: issue #345 and its triage; evidence
`../../distribution/reference/no-coi-agent-host-kit-evidence.md`.

## User scenario

1. An existing Vite web app without COOP/COEP installs `@riftydev/sdk` and
   `@riftydev/agent` (plus `@riftydev/workbench` for `dist/assets`) and copies
   `dist/assets` — no-COI toolchain worker and support probes — into its
   static directory. No bundler plugin, no service worker.
2. `checkSandboxSupport({ probeBaseUrl })` reports the no-COI composition as
   supported; the page ignores the service-worker rows as documented.
3. `createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true,
   toolchain: { workerUrl }, storage: { namespace, persistence: 'required' },
   startupTimeoutMs })`. While it boots the page renders the real phases it
   receives on `sandbox.runtime.on` (worker spawned → storage admitted →
   toolchain ready), not a stopwatch.
4. First open: `toolchain.applySnapshot({ cwd: '/project', snapshot })` into
   an empty target; the page shows fetched bytes, entries written and flushed
   counts; the app writes its own sources afterwards. The host records the
   applied `snapshotId` in its own storage; later opens call
   `toolchain.open({ cwd })`; a deploy with a new `snapshotId` re-applies with
   `force`, which replaces the payload targets — including dependencies the
   agent added in step 6 — so the host's recipe reconciles them afterwards
   (map fog, item 7). An apply onto non-empty payload targets (`package.json`,
   `package-lock.json`, `node_modules`) without `force` settles as the typed
   snapshot-conflict outcome, never a silent overwrite.
5. The user pastes baseUrl / model / key. The app creates one agent host over
   the project root with no restrictions beyond it — the agent reads and
   writes files and runs the project's own commands (`npm run build`, `node`)
   as on a developer machine; per-capability policy values stay an opt-in for
   hosts that want them (I4), never the reference default — and one session
   over `settings` + `fetch`. Prompt: "add a /health route". The chat renders from the exported transcript reducer
   (user / assistant / tool items, tool state running → success | error |
   cancelled). The user switches model before the next turn; history is kept.
   The endpoint accepts only string `content`; the session's text-only content
   mode makes it work without a consumer `streamFn` or a direct Pi dependency.
6. Second prompt: "format uptime with `ms`". The agent runs `npm install ms`
   in its shell. With the host's registry connection configured the package
   lands in `package.json`, the lockfile and `node_modules` through the same
   installer the host's `toolchain.install` uses. A host that connected no
   registry — a valid configuration — sees the same command fail loudly with
   an outcome naming the missing registry; the agent reports it instead of
   pretending, and its instructions never claim installs are the host's job
   when a registry is connected.
7. `project.run('npm run build')` streams stdout/stderr chunks; the shell
   tool's text to the model keeps them in terminal order; a second `run`
   issued during the build settles as the typed busy outcome and is retried
   after the first settles; `dist/index.html` is read through `project.fs`.
8. The same namespace opened in a second tab shows "waiting for storage
   writer" and settles as the outcome identified as occupied — whichever
   deadline fires first, the guard's or `startupTimeoutMs`; after the first
   tab closes, a retry succeeds.
9. The reference host — the packed lane's Vite consumer app
   (`tests/integration/fixtures/workbench-vite-consumer`, the persona of step
   1) — runs 2–8 against packed tarballs in CI with the scripted provider, in
   both configurations of step 6 (registry connected / none). Its source
   contains connections only: asset URLs, namespace, endpoint settings,
   optional `registryUrl`, project root and policy values (enforcement is
   rifty's), DOM targets, the host-owned applied `snapshotId` — plus exactly
   three pieces of display-only host code that shape nothing the model sees:
   an ANSI/CR line normalizer for the page, the trace download helper, one
   promise chain serialising the host's own calls. No readiness polling,
   apply-state strings, busy flags, transport shaping, prompt or tool text.

## Invariants

<!-- Each checked false on main 7f8f4708e (2026-09-26/27); commands, paths
     and lines: ../../distribution/reference/no-coi-agent-host-kit-evidence.md
     §False-on-main and §Additional facts. I1 — guard retry 25 ms until 30 s
     (ioReportTimeoutMs) then OpfsPreloadError; default startupTimeoutMs 10 s
     fires first as a handshake timeout naming no cause; no phase event; no
     test. I2 — SDK root exports zero error identifiers; README prescribes
     name/message matching. I3 — RuntimeEvent = ready|stdout|stderr|result|
     exit|diagnostic; toolchainReady internal. I4 — SandboxAgentHostOptions.
     project is one SandboxProjectOptions. I5 — settings fixed at construction
     (session.ts:22-46); ADR-0436 D2 forbids a second callback. I6 — default
     transport = pi-ai openai-completions; user content is built and sent as
     parts; Model.compat 0.85.1 has no string-content flag. I7 — reduction
     exists only in apps/playground/src/ai/AiChatPanel.tsx:17-253 (isError
     only; capabilities/output events dropped). I8 — the sdk+agent packed
     proofs (workbench-vite-consumer/src/{no-coi-project-proof,
     sandbox-agent-proof}.ts) and tools/agent-bench/src/no-coi-page.ts are
     test-shaped drivers that poll readiness, keep apply-state strings and
     accumulate output by hand; no connections-only host exists. I9 — no-COI
     shell `npm install` throws NotImplementedError('sandbox.project.
     npm-install') (npm-shell-command.ts:287-291 via no-coi-project-command.
     ts:182); prompt.ts:26-28 tells the model dependency policy belongs to the
     host; toolchain.install is host-only with no package list. I10 —
     tools.ts:319 builds the shell tool text as stdout then stderr. Evidence
     §Fidelity audit rows 1, 2, 17, 21. -->

1. I1. A second `createSandbox` on an occupied `storage.namespace` settles —
   whichever deadline fires first, the replica guard's or `startupTimeoutMs`
   — as an outcome identified as occupied through an exported discriminator,
   carrying the native contention cause and documented as retryable once the
   holder closes; while it waits, the opener observes a "waiting for storage
   writer" phase through `sandbox.runtime.on`. The wait and its
   `OpfsPreloadError` identity on guard expiry (ADR-0428) and the physical
   guard (ADR-0425 D7) are unchanged.
2. I2. Busy (`run`/`install`/project fs during an in-flight operation),
   occupied, snapshot-application conflict and mismatch, restart-busy and
   persistence failures are discriminable through identifiers exported from
   the `@riftydev/sdk` root without matching `error.name` strings, and the
   SDK README states which of them are retryable and when.
3. I3. `sandbox.runtime.on` delivers boot phases (worker spawned → storage
   admitted → toolchain ready) and snapshot-application counts (fetched
   bytes / declared total, entries written / total, flush persisted / total)
   as real counts of one operation, never a whole-open percent, with no
   separate progress callback.
4. I4. `createSandboxAgentHost` accepts distinct `readonlyPaths` /
   `allowedCommands` values for the file tools and for the shell in one host
   (e.g. a shell that may not write while file tools may) as an opt-in;
   unset = unrestricted, which is what the reference host and the benchmark
   run; enforcement stays in the SDK project policy, no second policy engine.
5. I5. A session created over OpenAI-compatible `settings` resolves endpoint
   and model before each model turn when the consumer supplies them as a
   function, keeping the session history; ADR-0436 D2's "no model-selection
   API" clause is superseded for this form only (`DEC-2`).
6. I6. The OpenAI-compatible transport offers an opt-in text-only message
   content mode: an endpoint that accepts only string `content` completes the
   scenario turn over `settings` + `fetch`, without a consumer `streamFn` or a
   direct `@earendil-works/pi-ai` dependency.
7. I7. `@riftydev/agent` exports a framework-free transcript reducer over
   `AgentSessionEvent` — ordered user / assistant / tool items, streaming text
   apart from the finished message, tool state running → success | error |
   cancelled, dedup by `toolCallId`, a terminal budget-exceeded entry — so a
   renderer built on it shows cancelled tools, capability changes and command
   output that today's ad-hoc reductions drop.
8. I8. An in-repo no-COI reference host built from packed tarballs in CI runs
   scenario steps 2–8 end to end in both registry configurations, and its
   source contains only connections plus the three display-only pieces step 9
   names (ANSI/CR line normalizer, trace download helper, one promise chain):
   no readiness polling, apply-state strings, busy flags, transport shaping,
   prompt or tool text — nothing quality-relevant is host-authored; and
   rifty's benchmark (`tools/agent-bench` no-COI lane)
   boots this host's composition module, so the measured configuration is the
   kit's reference configuration (unrestricted root, session defaults) and
   the kit's opt-in modes are toggles of that same module.
9. I9. In the agent's shell `npm install [<pkg>…]` runs through the same
   installer as the host's `toolchain.install` when the host configured a
   registry connection (where that connection lives — sandbox option or
   per-call — is item 8's ADR): `package.json`, the lockfile and
   `node_modules` change as npm would, and a host operation overlapping the
   install is rejected busy exactly as today; with no registry connected the command fails loudly
   with an outcome naming the missing registry — a valid configuration — and
   the injected instructions describe installs truthfully for the active
   configuration instead of steering the model away from dependencies.
10. I10. The shell tool's text to the model presents stdout and stderr in the
   order the command produced them — as the streaming `output` events and a
   terminal do — after the status line ADR-0436 D4 requires, never
   stdout-then-stderr.

## Challenge

<!-- Fresh read-only critics: 2026-09-26 on the narrow "no-COI project host"
     draft; 2026-09-27 on the widened kit after the user's answers. Final
     written-result checks (RDY-6) are recorded in ledger.md. -->

challenge: 2026-09-26 — 6 problems (narrow draft; each re-entered the interview; resolution per line)

- P1 fast second-opener rejection collides with ADR-0428 / ADR-0402 D6 and
  re-opens declined `page-locks` — user chose typed occupied + visible wait (I1).
- P2 applied-identity marker + skip = the install stamp ADR-0417 forbids (user's
  own 2026-09-01 words) — user dropped identity checking entirely; typed
  conflict only (I2), host owns the applied `snapshotId` (scenario 4).
- P3 ensure-on-mismatch must force or fail — moot after P2; apply keeps
  ADR-0417/0420 conflict policy.
- P4 typed `OpfsLayoutIssue` on the SDK contradicts ADR-0432; no host value —
  user dropped legacy migration for 0.x (out of scope).
- P5 a CI-executed headless SDK host already exists — carrier decision: build
  the reference host on the packed lane's existing consumer (corrected by the
  2026-09-27 critic: the sdk+agent+scripted proof is
  `workbench-vite-consumer`, not the surface-only fixture); host stays
  private/in-repo.
- P6 error classes vs exported names + predicates — agent-owned; map fog.

challenge: 2026-09-27 — 8 problems + 8 advisory (widened kit; resolution per line)

- P1 I8 "same composition as `tools/agent-bench`" ≠ what the kit host runs —
  user: (a) «да. Проверяем качество на том, что отдаем»; I8 now requires the
  bench to boot the reference host's module; the reference configuration
  itself is unrestricted (user, below).
- P2 carrier premise wrong: the surface-only packed fixture excludes
  `@riftydev/agent` and has no scripted provider; the sdk+agent proof is
  `workbench-vite-consumer/src/sandbox-agent-proof.ts` — carrier switched
  (scenario 9, item 7, evidence corrected).
- P3 I1 unreachable under defaults (`startupTimeoutMs` 10 s < guard 30 s) —
  I1 reworded: identified as occupied whichever deadline fires first.
- P4 DEC-2 form: partial overturn of ADR-0436 needs a decision subagent and a
  superseding ADR named by the §Corrections note — item 5 and Decisions fixed.
- P5 «не пустота» is settled by authority (ADR-0417: force = conflicting
  payload targets; 2026-09-01 record: "not whole-project reset"), and
  `package.json`/lock are payload targets — Decisions cite it; the "seeding
  stays valid" sentence dropped; scenario 4 writes sources after the apply.
- P6 attribution: user lines carried agent derivations; "policy" listed both
  as host connection and rifty obligation — split into `user:` / `agent:`
  lines; policy values = connection, enforcement = rifty.
- P7 `epics/agent-code-quality-evaluation` is not on main (PR #341) — cited as
  pending; `tools/agent-bench` named as the current owner.
- P8 ROADMAP M12 "AI lives outside rifty" contradicts ADR-0424/0436 and the
  kit — sentence updated in this PR (CHANGELOG line).
- A1 I4 vs ADR-0426 D1 (one project handle) — item 4's pickup ADR names D1.
- A2 I1 "never a generic preload failure" vs ADR-0428 expiry identity — I1
  keeps `OpfsPreloadError` identity + discriminator.
- A3 Model fields stay rifty-fixed — item 6 records that other endpoint
  compat needs re-enter through `streamFn`.
- A4 host applied flag keyed by `snapshotId` + `force` on change — scenario 4.
- A5 I7 "playground chat renders from it" is a carrier — moved to Decisions;
  I7 states the observable.
- A6 grep as acceptance oracle — item 7: the CI run closes acceptance, the grep
  is a ratchet.
- A7 ledger "1a, 2b" were not user words; fork/issue numbering mixed; fork-5
  non-answer missing — fixed (ledger, Decisions).
- A8 cheaper route for I5 (new session per turn) — `rejected route:` added.

fidelity audit: 2026-09-27 — 26 rows (evidence §Fidelity audit); routed by the
user's answers: agent `npm install` → I9 (item 8); tool-text order → I10
(item 9); README allowlist defect → item 4; caps/budgets → quality goal
question; env/npm vars, `spawn('npm')`, `node -p`, `npx` nudge → finding
drafts outside the kit; recorded ceilings stay out of scope.

## Decisions

- 2026-09-27 — user: «A - ок» — destination widened from "no-COI project
  host" (SDK lifecycle only) to the kit: SDK lifecycle + agent parts +
  reference host.
- 2026-09-27 — user: fork 1 «ок» (recommended option: wait retained, typed
  occupied + visible phase) → I1. rejected route: fast rejection via
  namespace-keyed lease / heartbeat — violates ADR-0428 ("no steal, lease
  transfer, extra owner or new public knob"), ADR-0402 D6 (no namespace-keyed
  lease) and re-opens the declined `page-locks` row.
- 2026-09-27 — user: fork 2 «ок» (recommended option: boot + snapshot
  application) → I3.
- 2026-09-27 — user: fork 3 (issue item 4) «можно развернуть в пустоту или
  получить ошибку/сигнал, если там не пустота. Остальное проект должен
  менеджить сам, никакой проверки идентичности не нужно. Это может ломать
  среду».
- 2026-09-27 — agent (from fork 3): no SDK-held applied identity, no
  `ensure`, no producer metadata sidecar; `applySnapshot` keeps ADR-0417/0420
  semantics; the signal is the typed conflict outcome (I2). "Не пустота" =
  conflicting payload targets, by authority: ADR-0417 (generic payload
  conflict preflight; `force` selects overwrite) and the 2026-09-01 refine
  record `no-coi-project-open-refine.md:92` ("Force means conflicting payload
  targets … not whole-project reset") and `dep-snapshot-application.ts:33-46` (`package.json`,
  `package-lock.json`, `node_modules`). Consequence: the host applies first
  and writes sources afterwards; the host-owned applied `snapshotId` and the
  `force`-on-new-id recipe are host policy the reference host demonstrates.
- 2026-09-27 — user: fork 4 (issue item 5) «мне кажется не нужно продумывать
  механизма миграции для 0 мажора» — legacy layout migration / read path out;
  ADR-0425 D8 and ADR-0432 stand; no policy note.
- 2026-09-27 — user: fork 5 «вообще не понял в чем проблема» — no scope
  answer; carrier (where the reference host lives) decided by the agent below.
- 2026-09-27 — user: «B - ок» — per-turn `settings` (I5) and text-only content
  (I6). agent: ADR-0436 D2 is partially overturned → `DEC-2`: decision
  subagent + short superseding ADR naming D2, dated §Corrections note on
  ADR-0436 pointing at it (item 5's PR); text-only content is a seam addition
  on ADR-0436 → short ADR citing it (item 6's PR).
- 2026-09-27 — user: «С - пока не делаем. Отдельный эпик про визуальный
  дебаг» — preview out of this goal; captured as draft
  `epics/no-coi-visual-debug`. agent: baseline stays `startBin` →
  `previewUrl` (ADR-0377) with the caller-owned `mode()` (ADR-0426); the
  kit's host runs in `commands` mode only.
- 2026-09-27 — user: «D - только headless чат» — transcript reducer only
  (I7); no UI component (stays `distribution/ai-ide-product-ui`, M12).
- 2026-09-27 — user: «хочется чтобы качество агента проверялось на стороне
  rifty. То есть чтобы на стороне клиента только подключения были, а не
  значимые части, которые влияют на качество».
- 2026-09-27 — agent (from the quality answer): I8 "connections only";
  policy *values* are connections, policy *enforcement*, transport shaping,
  prompt/tool text and transcript reduction are rifty package obligations.
  The playground chat consumes the exported reducer (dogfood; carrier, not an
  invariant clause).
- 2026-09-27 — user (critic-2 P1, bench vs kit configuration): «Ответ на
  вопрос - да. Проверям качество на том, что отдаем» → (a): the bench lane
  boots the reference host's composition module (item 7); the quality goal
  may re-cut lanes later.
- 2026-09-27 — user (on the draft's "shell read-only, the agent cannot run
  `npm run build` to self-verify"): «вот это вообще не ок. Опять откуда-то
  ограничения взялись. Отправь агента проверить сценарий "nonCOI + agent" на
  fidelity» — the reference configuration is unrestricted: the agent runs the
  project's own commands and writes files as on a developer machine; a
  read-only fidelity audit of the no-COI + agent path was launched, its
  findings land in the evidence file and re-chart this map before `ready`.
- 2026-09-27 — agent (from the fidelity answer): per-capability policy (I4,
  issue #345 item 6) stays an opt-in capability with unrestricted defaults —
  the host's ask is kept, the restriction never becomes the reference; flagged
  for the final check as an agent derivation.
- 2026-09-27 — user (agent `npm install`, after the fidelity audit):
  «разрешаем, но оно может падать, если к песочнице не подключен npm
  registry(такое должно быть валидно с точки хрения конфигурации)» → I9,
  scenario 6, item 8.
- 2026-09-27 — agent (from the install answer): the registry is a host
  connection whose location (sandbox-level option vs today's per-call
  `install({ registryUrl })`, `protocol.ts:90-98`) is a public-API fork for
  item 8's ADR; the agent's `npm install` reuses the installer behind
  `toolchain.install` (no second installer) and overlapping host operations
  stay busy-rejected (ADR-0376 D1; D2's host-side input validation applies to
  a shell-originated install running inside an admitted `run`); the
  no-registry outcome is typed (I2); the injected prompt text follows the
  configuration (audit row 21); seam addition on ADR-0418 D4 → short ADR
  citing 0418 D4 and 0376 D2 at item 8 pickup. rejected route: a
  rifty-specific "install" tool instead of the real `npm install` command —
  violates I9 (the agent types the command it would type on a machine).
- 2026-09-27 — agent: routing of the remaining audit rows (path, `RDY-5`;
  user authority covers only the audit request and the install answer):
  I10 tool-text order (item 9); README `allowedCommands` example that breaks
  `npm run` → item 4 obligation; 16 KiB cap and 100/180 s budgets stay
  ADR-0424 D7 until measured → question draft
  `distribution/agent-tool-text-cap-and-run-budgets-measure` for the quality
  goal; empty command env + npm lifecycle vars, `spawn('npm'|'.bin/*')`,
  `node -p`/`--input-type` on no-COI, `npx` nudge → finding drafts outside the
  kit; background jobs, drain cap, preview-mode tool removal → visual-debug
  epic fog; `platform='rifty'`, shell features, net ceilings → existing items.
- 2026-09-27 — agent: fork 5 carrier — the reference host is built on the
  packed lane's Vite consumer (`tests/integration/fixtures/workbench-vite-
  consumer`, whose `no-coi-project-proof.ts` / `sandbox-agent-proof.ts` already
  run sdk + agent + scripted provider from packed tarballs), refactored into a
  readable connections-only `host.ts` plus the existing proof drivers.
  rejected route: the surface-only fixture
  (`no-coi-packed-toolchain-consumer`) — its closure excludes `@riftydev/agent`
  (`workbench-packed-consumer.mjs:193`). rejected route: a new
  `examples/no-coi-host` — workspace/arch/vitest/CI wiring and a packed
  re-install for discoverability alone; proves the kit no better than the
  consumer already in the lane.
- 2026-09-27 — agent: no one-call composition entry is seeded; REV-7: after
  I1–I7 the host's residual wiring is connections; if the reference host
  still carries mechanism, a child appears by re-chart, never pre-emptively.
- bounded destination (fit.md 1, 2026-09-27, agent): closes when I1–I10 hold on
  main and the reference host runs the scenario in the packed-consumer lane;
  no standing invariant is carried — the quality boundary is checked by I8's
  CI run, not by a policy.
- mechanism sweep (fault-classes §Class-kill, 2026-09-27, agent): no new
  coordination mechanism — no lease, queue, ledger or epoch guard; progress
  rides the existing `runtime.on` channel, occupied keeps the existing guard
  and retry (ADR-0425 D7, ADR-0428), busy keeps the existing slot (ADR-0376).
- tier: works (2026-09-27, agent) — honest happy path + typed loud outcomes;
  the physical guards (ADR-0425 D7, ADR-0428) and apply fault proofs already
  exist; children touching persistence/concurrency owe DoD `## Fault matrix`
  rows at pickup.
- rejected route: serialise `run()`/project fs inside the SDK — violates
  ADR-0376 D1 (declined row "Queue overlapping no-COI toolchain calls");
  scenario 7 keeps the loud busy outcome.
- rejected route: a new session per model turn instead of per-turn `settings`
  — loses the Pi-owned history (ADR-0424 D2); violates I5 "keeping the
  session history".
- rejected route: published conformance/test-fixture package
  (`@riftydev/verify`, `@webcontainer/test`-style) — user triage 2026-09-17;
  I8's in-repo CI host carries the upgrade confidence; revival needs new
  evidence and an ADR (declined row).
- rejected route: ANSI/line/severity helpers or `downloadTrace()` in packages —
  user triage 2026-09-17 (ADR-0198, D-002 host scope); the reference host
  carries the ~10-line normalizer and the download helper as host code.
- rejected route: fold into `epics/open-bolt-ai-sandbox-demo` — different
  persona (public demo + launch), excludes the Pi harness and preview-gated;
  it may later build on this kit.
