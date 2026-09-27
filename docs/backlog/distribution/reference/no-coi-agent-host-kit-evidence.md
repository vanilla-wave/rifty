# no-COI agent host kit — refine/FIT evidence

Source: GitHub issue #345 "Embedding gaps for a non-COI sdk-toolchain + agent
host" (2026-09-17) + the maintainer triage comment (2026-09-17). User request
2026-09-19: research whether a layer is missing behind the declined asks and
what fits the plan; 2026-09-26: "оформляй эпик". Baseline: main `7f8f4708e`.
All commands run from the repo root on 2026-09-26 unless noted.

## Structural gap (why one epic, not five items)

COI path: `createSandbox` → `openWorkbench` (origin lease, health/progress,
project open/close, snapshot compare, storage-layout health, 12 error classes,
error-class re-attachment across the worker hop) → `@riftydev/workbench/playground`.
No-COI path: `createSandbox({ toolchain })` → host. Every lifecycle mechanism the
COI composition owns is absent on the SDK path, and `openWorkbench` cannot be
used there: `packages/workbench/src/workbench/open-workbench.ts:706-713` throws
`Workbench requires cross-origin isolation`; declined row
`docs/adr/README.md:619` forbids exposing the Workbench project surface to the
no-COI tier ("imports the COI owner/kernel topology").

Arch tiers (`tools/checks/arch-rules.cjs:15-18`): `[shell, terminal, npm-client,
ts-language-service] → [workbench] → [rifty] → [agent]` — the SDK already sits
above workbench, so the composition belongs in `packages/rifty`.

## False-on-main evidence per candidate invariant

### Second opener of the same namespace (issue item 2)

- `packages/vfs/src/opfs-replica-store.ts:36-76` `acquireGuard`: on
  `NoModificationAllowedError` retries `createSyncAccessHandle()` every 25 ms
  until `timeoutMs`; the caller passes
  `PERSIST_OPERATION_REPORT_TIMEOUT_MS = 30_000`
  (`packages/vfs/src/opfs-drain-scheduler.ts:78`); then
  `OpfsPreloadError('OPFS replica writer is unavailable or already occupied')`
  (`opfs-replica-store.ts:176-181`).
- No test asserts the second-opener outcome:
  `grep -rln "unavailable or already occupied" tests packages --include='*.ts'`
  → only `packages/vfs/src/opfs-replica-store.ts`.
- Physical exclusion itself is ADR-0425 D7 and stays.

### Typed errors from `@riftydev/sdk` (item 3)

- `grep -n "Error" packages/rifty/src/index.ts` → one doc-comment hit; zero
  exported classes. `packages/rifty/README.md:191`: inspect `name`/`message`
  "rather than class identity".
- Names crossing the boundary as bare strings: `SandboxToolchainBusyError`
  (`packages/workbench/src/workers/no-coi-toolchain-worker.ts:223,399`;
  `packages/runtime-js/src/worker-entry.ts:225,248,270`),
  `SandboxResidentToolBusyError` (`no-coi-toolchain-worker.ts:218`),
  `SandboxRestartBusyError` (`packages/rifty/src/sandbox.ts:432-435`),
  `SandboxPersistenceError` (`packages/runtime-js/src/worker-fs-rpc.ts:164`),
  `SandboxResidentPortOwnershipError`
  (`packages/workbench/src/workers/resident-node-entry.ts:39`).
- Workbench contrast: 12 classes in `packages/workbench/src/workbench/errors.ts`
  plus `serializeWorkbenchOwnerError`/`deserializeWorkbenchOwnerError`
  (`errors.ts:217-277`) — unexported, unused by the SDK.

### Applied-snapshot identity (item 4)

- `packages/workbench/src/workers/no-coi-snapshot-application.ts` (42 lines):
  fetch → identity/template/runtime match → apply → flush; writes no stamp or
  marker. `toolchain.open()` returns `void`
  (`packages/workbench/src/workers/no-coi-toolchain-worker.ts:150-154`).
- `grep -rn ensureSnapshot packages apps tools tests docs` → 0 hits.
- Compare logic exists only inside the COI acquisition authority
  (`packages/workbench/src/workers/package-acquisition-authority.ts:943-1080`;
  `packages/workbench/src/workbench/project-materialization.ts:7-106`), unexported.
- ADR-0420: "Same-ID input passes all validation again" — explicit apply stays
  explicit; an applied-identity skip is a distinct operation, not a change to
  `applySnapshot`.
- Host-side cost per issue #345: re-apply ≈ 16 s vs open ≈ 1 s on every
  reopen when the identity bookkeeping is wrong (host measurement; not
  reproduced in-repo).

### Storage-layout signal (item 5)

- `packages/runtime-js/src/worker-entry.ts:143-150`: `layoutIssue` becomes
  `post({ type: 'stderr', chunk: '[rifty] The legacy per-file OPFS layout was not restored; old native files remain.\n' })`.
- `OpfsLayoutIssue` exported only from `packages/vfs/src/internal/index.ts:31`;
  `packages/rifty/src/vfs.ts` re-exports the public `@riftydev/vfs` root; no
  `@riftydev/sdk/vfs/internal` subpath (`packages/rifty/package.json:30-44`).
- `tests/no-coi/no-coi-layout-notice.spec.ts` asserts the stderr string only.
- ADR-0425 D8 (`docs/adr/vfs/0425-*.md:59-65`): "Never hydrate legacy per-file
  project bytes … no migration or export prompt" — user decision 2026-09-01.

### Boot / apply progress (item 9)

- `RuntimeEvent` (`packages/runtime-js/src/host.ts:62-70`):
  `ready | stdout | stderr | result | exit | diagnostic`; no phase or count.
- `toolchainReady` is a bare promise on `ToolchainRuntimeController`
  (`packages/runtime-js/src/host.ts:117`), internal only.
- Workbench progress rides `WorkbenchHealth` (`ADR-0413`: "Persistence counts
  describe one drain, never whole-open percent") — the honest-progress rule any
  SDK progress must keep.
- Declined row `docs/adr/README.md:630`: separate `onLifecycle` subscription
  duplicates `runtime.on` — phases must be `RuntimeEvent` kinds.

### Reference host / declined host glue (items 1, 10, 12)

- No `examples/` entry imports `@riftydev/sdk`, `@riftydev/agent` or
  `@riftydev/workbench` (grep over `examples/`, node_modules excluded → 0).
- Closest SDK-only hosts: `tools/agent-bench/src/no-coi-page.ts` (70 lines),
  `tests/integration/fixtures/workbench-vite-consumer/src/no-coi-project-proof.ts`
  (128), `tests/no-coi/fixtures/no-coi-snapshot-page.ts` (98),
  `tests/no-coi/fixtures/no-coi-warm-open-page.ts` (92, polls
  `runtime.isReady()` every 10 ms), packed surface fixture
  `tests/integration/fixtures/no-coi-packed-toolchain-consumer/src/*.ts` (588,
  esbuild bundle of packed tarballs, driven by
  `tests/integration/workbench-packed-consumer.mjs --surface-only`).
- Only ANSI/CR line normalizer in the repo: inside a spec
  (`tests/no-coi/no-coi-sandbox-build-loop.spec.ts:24-34`).
- `run()` output shape: decoded strings per `process.stdout.write` boundary
  (`packages/rifty/src/sandbox-project.ts:19-22`,
  `packages/workbench/src/workers/no-coi-project-command.ts:86-97`).
- Playground duplicates of the same glue: transcript reducer
  `apps/playground/src/ai/AiChatPanel.tsx:17-253`, `glue/download.ts` (12),
  `glue/project-open-progress.ts` (31), `glue/slow-progress.ts` (36).
- Scripted provider for network-free agent turns exists:
  `tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts`
  (used by `sandbox-agent-proof.ts:8-28`).

## Recorded decisions that bound the route

- ADR-0376 D1 + declined rows `docs/adr/README.md:622-624`: busy rejection, no
  FIFO/queue, one admission owner.
- ADR-0437 D3 / ADR-0438: requiredness follows composition operations;
  `page-locks` composed host-side (`docs/public/sandbox-support.md` §Compose).
- ADR-0198: display plane is a lossy string by design; no severity model.
- ADR-0426: caller's `mode()` is the sole mode authority; no auto-switch.
- ADR-0436:30-31: "No second callback, provider catalogue or model-selection
  API" — bounds issue item 7 (out of this epic).
- Maintainer triage 2026-09-17 (issue #345 comment): items 1, 2b, 3a, 10, 12
  declined as package surface; host-side recipes instead.

## External reference (2026-09-19, web)

- `@webcontainer/test` 0.3.0: Vitest browser-mode plugin with `webcontainer`,
  `preview`, `setup` (snapshot) fixtures — tests apps inside WebContainers,
  does not verify WebContainers itself.
- `@webcontainer/snapshot` 0.1.0: server-side folder → binary for `mount()`;
  identity bookkeeping is host-side there too.
- WebContainer API: no boot-progress events; "Only a single instance of
  WebContainer can be booted concurrently" until `teardown()`;
  `spawn().output` is a decoded `ReadableStream<string>`.

## Additional facts (2026-09-27)

- Second-opener wait is deliberate: ADR-0428 (`docs/adr/vfs/0428-*.md`) —
  "retry only NoModificationAllowedError, every 25 ms … No memory fallback,
  steal, lease transfer, extra owner or new public knob … Calling terminate or
  reaching a reporting timeout never proves release"; Chromium 148 keeps a
  terminated Worker's guard ~2 s. ADR-0402 D6: "no namespace-keyed lease or
  namespace registry".
- Install-status posture: ADR-0417 (`0417:25-26`) "Host chooses when to invoke
  it, without keeping an install stamp. Ordinary open does not … infer
  freshness"; user words 2026-09-01
  (`no-coi-project-open-refine.md:86`): «Среда не должна знать статус
  установки - ровно как и в реальной экосистеме. Если не получается поставить
  вываливается ошибка. Максимум - флаг форса».
- Layout diagnostics: ADR-0432 §Decision — "Generic no-COI has no Workbench
  project-layout predicate … captures startup stderr … via existing
  `options.logger`; no public protocol/API addition".
- ADR-0436 D2 (`0436:30-31`): "No second callback, provider catalogue or
  model-selection API"; §Alternatives: "Delay publication for chat restore,
  model picker or cross-origin DOM preview: rejected; none is required for the
  headless edit/build flow".
- pi-ai 0.85.1 `Model.compat` (`packages/agent/node_modules/@earendil-works/
  pi-ai/dist/types.d.ts:465-500`): provider flags exist, no string-content
  flag; rifty passes none (`grep -n compat packages/agent/src/session.ts` → 0).
- Bench composition: `tools/agent-bench/src/no-coi-page.ts:28-45` =
  `createSandbox` → `sandbox.project` → `install` → `createAgentSession({
  host: createSandboxAgentHost({ sandbox, project, mode }), settings,
  maxToolCalls, runTimeoutMs })`.
- Agent quality goal: PR #341 (`origin/t3code/sandbox-agent-eval-infrastructure`)
  `docs/backlog/epics/agent-code-quality-evaluation/goal.md` — Rifty vs native
  Pi vs Codex over `tools/agent-bench`, "Both existing Rifty paths remain:
  actual COI +chat and packed no-COI SDK".
- Packed no-COI fixture: `tests/integration/fixtures/no-coi-packed-toolchain-
  consumer/{build.mjs,src/main.ts,src/agent-scenarios.ts,…}` (588 lines),
  esbuild 0.28.0 bundle, selected by `workbench-packed-consumer.mjs
  --surface-only` (`:53-58`).

## User answers (2026-09-27, verbatim)

Round 1 — 1 «ок»; 2 «ок»; 3 «Не очень понял, но мысль такая - можно развернуть
в пустоту или получиить ошибку/сигнал, если там не пустота. Остальное проект
должен менеджить сам, никакой проверки идентичности не нужно. Это может ломать
среду»; 4 «мне кажется не нужно продумывать механизма миграции для 0 мажора»;
5 «вообще не понял в чем проблема» (carrier; agent decided: promote the
fixture).
Round 2 — «A - ок / B - ок / С - пока не делаем. Отдельный эпик про визуальный
дебаг / D - только headless чат»; «И еще расширение предыдущей мысли - хочется
чтобы качество агента проверялось на стороне rifty. Тоесть чтобы на стороне
клиента только подключения были, а не значимые части, которые влияют на
качество». Earlier framing: «мы про существующие проекты, а не "с нуля"».

## Critic 1 (2026-09-26, narrow draft) — verbatim verdict

verdict: 6 problems — P1 fast rejection vs ADR-0428/0402 D6 (+ re-opens 2b);
P2 applied-identity marker = ADR-0417 install stamp (user's own words); P3
ensure-on-mismatch must force or fail; P4 typed OpfsLayoutIssue vs ADR-0432,
no host value under (a); P5 packed fixture already is the CI headless host,
`examples/` = wiring for discoverability; P6 classes vs names+predicates
(advisory). Resolutions: goal.md §Challenge.
