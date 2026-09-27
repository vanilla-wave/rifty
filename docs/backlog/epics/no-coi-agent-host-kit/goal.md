---
kind: epic
status: draft
title: no-COI agent host kit — an existing app wires connections only
created: 2026-09-27
value: A team embeds a no-COI rifty sandbox plus the rifty agent into its existing web app by supplying only connections — asset URLs, a storage namespace, an OpenAI-compatible endpoint, a project root — while every part that affects agent quality ships and is measured inside rifty.
user_story: As a developer embedding rifty into an existing non-COI product, I want `createSandbox` + `@riftydev/agent` to cover open → agent edit → build out of the box, but today I re-derive occupied/busy/progress state, splice two agent hosts for policy, write my own transcript reducer and a full Pi `streamFn` just to switch models and flatten message content.
tier: works
---

## Outcome

The no-COI composition (`createSandbox({ toolchain })` → `project` →
`createSandboxAgentHost` → `createAgentSession`) gains the lifecycle core that
`openWorkbench` owns on the COI path — typed outcomes, a visible wait, real
progress — and the agent parts an existing app cannot author without reaching
into Pi: per-capability policy, per-turn settings, text-only message content,
a transcript model. An in-repo reference host built from packed tarballs in CI
proves the kit and fixes the boundary: host code is connections; everything
that shapes agent behaviour lives in `@riftydev/sdk` / `@riftydev/agent` and is
exercised by rifty's own agent benchmark (`tools/agent-bench`; goal
`epics/agent-code-quality-evaluation`).

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
   counts. The host records "applied" in its own storage; later opens call
   `toolchain.open({ cwd })`. An apply onto non-empty payload targets without
   `force` settles as the typed snapshot-conflict outcome, never a silent
   overwrite.
5. The user pastes baseUrl / model / key. The app creates one agent host with
   distinct policies per capability (shell read-only, writes only through the
   file tools) and one session over `settings` + `fetch`. Prompt: "add a
   /health route". The chat renders from the exported transcript reducer
   (user / assistant / tool items, tool state running → success | error |
   cancelled). The user switches model before the next turn; history is kept.
   The endpoint accepts only string `content`; the session's text-only content
   mode makes it work without a consumer `streamFn` or a direct Pi dependency.
6. `project.run('npm run build')` streams stdout/stderr chunks; a second
   `run` issued during the build settles as the typed busy outcome and is
   retried after the first settles; `dist/index.html` is read through
   `project.fs`.
7. The same namespace opened in a second tab shows "waiting for storage
   writer" and settles as the typed occupied outcome; after the first tab
   closes, a retry succeeds.
8. The reference host in
   `tests/integration/fixtures/no-coi-packed-toolchain-consumer` runs 2–7
   against packed tarballs in CI with the scripted provider. Its source
   contains connections only: asset URLs, namespace, endpoint settings,
   project root and policy, DOM targets, the host-owned "applied" flag. No
   readiness polling, apply-state strings, busy flags, transport shaping,
   prompt or tool text.

## Invariants

<!-- Each checked false on main 7f8f4708e (2026-09-26/27); commands, paths
     and lines: ../../distribution/reference/no-coi-agent-host-kit-evidence.md
     §False-on-main. I1 — guard retry 25 ms until 30 s then generic
     OpfsPreloadError; no phase event; no test. I2 — SDK root exports zero
     error identifiers; README prescribes name/message matching. I3 —
     RuntimeEvent = ready|stdout|stderr|result|exit|diagnostic; toolchainReady
     internal. I4 — SandboxAgentHostOptions.project is one SandboxProjectOptions.
     I5 — settings fixed at construction (session.ts:22-40); ADR-0436 D2
     forbids a second callback. I6 — default transport = pi-ai
     openai-completions with content parts; no string-content option in
     Model.compat 0.85.1. I7 — reduction exists only in
     apps/playground/src/ai/AiChatPanel.tsx:17-253; cancelled unmodelled;
     capabilities/output events dropped. I8 — no in-repo host composes
     sdk+agent for embedders; packed fixture is test-shaped and re-derives
     state; only tools/agent-bench/src/no-coi-page.ts wires the composition. -->

1. I1. A second `createSandbox` on an occupied `storage.namespace` settles as
   an outcome identified as occupied — carrying the native cause and
   documented as retryable once the holder closes — never as a generic
   preload failure; while it waits, the opener observes a "waiting for storage
   writer" phase through `sandbox.runtime.on`. The wait itself (ADR-0428) and
   the physical guard (ADR-0425 D7) are unchanged.
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
   `allowedCommands` for the file tools and for the shell in one host (shell
   read-only while file tools may write); enforcement stays in the SDK
   project policy, no second policy engine.
5. I5. A session created over OpenAI-compatible `settings` resolves endpoint
   and model before each model turn when the consumer supplies them as a
   function, keeping the session history; ADR-0436 D2's "no model-selection
   API" clause is corrected by record for this form only.
6. I6. The OpenAI-compatible transport offers an opt-in text-only message
   content mode: an endpoint that accepts only string `content` completes the
   scenario turn over `settings` + `fetch`, without a consumer `streamFn` or a
   direct `@earendil-works/pi-ai` dependency.
7. I7. `@riftydev/agent` exports a framework-free transcript reducer over
   `AgentSessionEvent` — ordered user / assistant / tool items, streaming text
   apart from the finished message, tool state running → success | error |
   cancelled, dedup by `toolCallId`, a terminal budget-exceeded entry — and the
   playground chat renders from it instead of its own reduction.
8. I8. An in-repo no-COI reference host built from packed tarballs in CI runs
   scenario steps 2–7 end to end; its source contains only connections (step
   8's list) and wires the same `@riftydev/agent` composition that
   `tools/agent-bench` measures — nothing quality-relevant is host-authored.

## Challenge

<!-- Fresh read-only critics: 2026-09-26 on the narrow "no-COI project host"
     draft (issue, triage, evidence, forks); a second pass on the widened kit
     after the user's 2026-09-27 answers. Final written-result checks (RDY-6)
     are recorded in ledger.md. -->

challenge: 2026-09-26 — 6 problems (narrow draft; each re-entered the interview; resolution per line)

- P1 fast second-opener rejection collides with ADR-0428 / ADR-0402 D6 and
  re-opens declined `page-locks` — user chose typed occupied + visible wait (I1).
- P2 applied-identity marker + skip = the install stamp ADR-0417 forbids (user's
  own 2026-09-01 words) — user dropped identity checking entirely; typed
  conflict only (I2), host owns the "applied" flag (I8).
- P3 ensure-on-mismatch must force or fail — moot after P2; apply keeps
  ADR-0417/0420 conflict policy.
- P4 typed `OpfsLayoutIssue` on the SDK contradicts ADR-0432; no host value —
  user dropped legacy migration for 0.x (out of scope).
- P5 a CI-executed headless SDK host already exists (packed fixture); new
  `examples/` dir = wiring for discoverability only — carrier decision: promote
  the fixture (I8); host stays private/in-repo.
- P6 error classes vs exported names + predicates — agent-owned; map fog.

## Decisions

- 2026-09-27 — user: A «ок» — destination widened from "no-COI project host"
  (SDK lifecycle only) to the kit: SDK lifecycle + agent parts + reference host.
- 2026-09-27 — user: 1 «ок» — occupied: wait retained, typed outcome + visible
  phase (I1). rejected route: fast rejection via namespace-keyed lease /
  heartbeat — violates ADR-0428 ("no steal, lease transfer, extra owner or new
  public knob"), ADR-0402 D6 (no namespace-keyed lease) and re-opens the
  declined `page-locks` row; user chose (a).
- 2026-09-27 — user: 2 «ок» — progress covers boot and snapshot application (I3).
- 2026-09-27 — user (item 4): «можно развернуть в пустоту или получить
  ошибку/сигнал, если там не пустота. Остальное проект должен менеджить сам,
  никакой проверки идентичности не нужно. Это может ломать среду» — no
  SDK-held applied identity, no `ensure`, no producer metadata sidecar;
  `applySnapshot` keeps ADR-0417/0420 semantics; the signal is the typed
  conflict outcome (I2); the host keeps its own "applied" flag (I8, scenario 4).
  Agent interpretation, flagged for the final check: "не пустота" = the payload
  targets the snapshot writes (existing conflict policy), not the whole `cwd`,
  so seeding source files before apply stays valid.
- 2026-09-27 — user (item 5): «мне кажется не нужно продумывать механизма
  миграции для 0 мажора» — legacy layout migration / read path out; ADR-0425 D8
  and ADR-0432 stand; no policy note.
- 2026-09-27 — user: B «ок» — ADR-0436 D2 corrected by record (DEC-2) for
  per-turn `settings` (I5); text-only content is a seam addition on ADR-0436 →
  short ADR citing it at pickup (I6).
- 2026-09-27 — user: C «пока не делаем. Отдельный эпик про визуальный дебаг» —
  preview out of this goal; captured as draft `epics/no-coi-visual-debug`.
  Baseline stays `startBin` → `previewUrl` (ADR-0377) with the caller-owned
  `mode()` (ADR-0426); the kit's host runs in `commands` mode only.
- 2026-09-27 — user: D «только headless чат» — transcript reducer only (I7);
  no UI component (stays `distribution/ai-ide-product-ui`, M12).
- 2026-09-27 — user: «хочется чтобы качество агента проверялось на стороне
  rifty. То есть чтобы на стороне клиента только подключения были, а не
  значимые части, которые влияют на качество» — I8 "connections only" and
  "same composition as `tools/agent-bench`"; every quality-relevant part
  (policy, transport shaping, prompt/tool text, transcript reduction) is a
  rifty package obligation covered by `epics/agent-code-quality-evaluation`.
- 2026-09-27 — agent: 5 — reference host = the promoted packed fixture
  (`tests/integration/fixtures/no-coi-packed-toolchain-consumer`), driven by
  `tests/integration/workbench-packed-consumer.mjs --surface-only`. rejected
  route: new `examples/no-coi-host` — needs workspace/arch/vitest/CI wiring and
  a packed re-install for discoverability alone; violates Outcome clause
  "proves the kit … in CI" no better than the fixture.
- 2026-09-27 — agent: E — no composition entry (`createSandbox`+host+session in
  one call) is seeded; REV-7: after I1–I7 the host's residual wiring is
  connections; if the reference host still carries mechanism, a child appears
  by re-chart, never pre-emptively.
- tier: works (2026-09-27, agent) — honest happy path + typed loud outcomes;
  the physical guards (ADR-0425 D7, ADR-0428) and apply fault proofs already
  exist; children touching persistence/concurrency owe DoD `## Fault matrix`
  rows at pickup.
- rejected route: serialise `run()`/project fs inside the SDK — violates
  ADR-0376 D1 (declined row "Queue overlapping no-COI toolchain calls");
  scenario 6 keeps the loud busy outcome.
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
