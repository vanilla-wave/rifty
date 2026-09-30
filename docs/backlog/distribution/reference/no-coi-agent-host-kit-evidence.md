# no-COI agent host kit — refine/FIT evidence

Source: GitHub issue #345 "Embedding gaps for a non-COI sdk-toolchain + agent
host" (2026-09-17) + the maintainer triage comment (2026-09-17). User request
2026-09-19: research whether a layer is missing behind the declined asks and
what fits the plan; 2026-09-26: "оформляй эпик". Baseline: main `7f8f4708e`.
All commands run from the repo root on 2026-09-26 unless noted.

## Dedup (rifty-to-backlog §2, 2026-09-19/26)

Searched `docs/backlog/**/*.md` titles/`code:`, goal `map.md` files, child
`epic:` links, `docs/process/traps.md` and `docs/adr/README.md` §Declined
concepts for: `ensureSnapshot`, snapshot identity, transcript, boot progress,
per-capability, per-turn, `migrateLegacyStorage`, `OpfsLayoutIssue`,
`SandboxOccupiedError`, `SandboxToolchainBusyError`, occupied, busy, embedder,
headless, conformance, verify, `#345`. No matching item, goal or declined row
for the kit as a whole; issue #345 left no trace in the repo before this
refine (no declined row dated after 2026-09-04). Partial overlaps kept as
related, not merged: `distribution/embed-host-vite-example` (COI reference
host, `embeddable-dev-loop`), `distribution/ai-sandbox-reference-demo` +
`epics/open-bolt-ai-sandbox-demo` (public demo persona, excludes the Pi
harness), `distribution/public-api-ai-agent-contract-snapshot-restore`
(whole-sandbox snapshot/restore/fork), `distribution/public-api-ai-agent-
preview-question` (preview; now `epics/no-coi-visual-debug`),
`distribution/reference/embedder-gaps-evidence.md` rows I1/I8 (2026-09-07
COI-era intake). Declined rows that bound carriers (all 2026-09-04): queue
overlapping calls, host-side admission boolean, package/project FIFO,
separate `onLifecycle`, public Workbench project surface for no-COI.

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
  Correction 2026-09-27 (critic 2): the sdk + agent + scripted-provider packed
  proof already runs in the default packed lane —
  `tests/integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts`
  via `workbench-packed-consumer.mjs:1253` → `no-coi-agent-browser-proof.mjs`;
  the surface-only closure excludes `@riftydev/agent`
  (`workbench-packed-consumer.mjs:193`) and that fixture has no scripted provider.
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

## Critic 2 (2026-09-27, widened kit) — verbatim verdict

verdict: 8 problems (+8 advisory) — P1 I8 "same composition as
tools/agent-bench" ≠ the kit host's configuration (bench: no policy, static
settings, content parts) → user fork; P2 surface-only fixture excludes
`@riftydev/agent`, sdk+agent+scripted proof is `workbench-vite-consumer/src/
sandbox-agent-proof.ts`; P3 I1 unreachable under defaults (`startupTimeoutMs`
10 s < guard 30 s; ADR-0428 "outer SDK startup timeout remains authoritative
when shorter"); P4 DEC-2 needs decision subagent + superseding ADR, not a
§Corrections note alone; P5 «не пустота» settled by ADR-0417 + 2026-09-01
record, `package.json`/lock are payload targets (`dep-snapshot-application.
ts:33-46`); P6 attribution mixing in user lines, "policy" both connection and
obligation; P7 `epics/agent-code-quality-evaluation` not on main (PR #341);
P8 ROADMAP:114 "AI lives outside rifty" overtaken by ADR-0424/0436. Advisory
A1 I4 vs ADR-0426 D1; A2 I1 vs ADR-0428 expiry identity; A3 fixed Model
fields; A4 applied flag keyed by snapshotId; A5 I7 playground clause is a
carrier; A6 grep is not an acceptance oracle; A7 ledger letters / numbering /
fork-5 non-answer; A8 rejected route new-session-per-turn. False-on-main
verified for I1–I8 by the critic (I6: pi-agent-core `agent.js:263-268` builds
user content as parts; pi-ai `openai-completions.js:926-953` sends them as
parts). Resolutions: goal.md §Challenge (2026-09-27 block); P1 open, owner:
user.

Verified by the driver 2026-09-27: `workbench-packed-consumer.mjs:193`
(`if (!surfaceOnly) pending.push('@riftydev/agent')`), `:1253`
(`provePackedAgent`); `host.ts:170` default startup timeout, `:433` handshake
timeout message; `dep-snapshot-application.ts:33-46` payload files;
`decisions.md` DEC-2 wording; ROADMAP:114.

## User answers (2026-09-27, later)

- Critic-2 P1: «Ответ на вопрос - да. Проверям качество на том, что отдаем».
- On "shell read-only, the agent cannot run `npm run build` to self-verify":
  «вот это вообще не ок. Опять откуда-то ограничения взялись. Отправь агента
  проверить сценарий "nonCOI + agent" на fidelity».
- On "сообщения сплющены в текст": «не понял что это значит» — explained in
  session: OpenAI chat `content` may be a string or an array of typed parts;
  Pi sends the array; some OpenAI-compatible endpoints accept only the string,
  so the parts are joined into one string (wire format only, text-only
  conversations lose nothing).

## Fidelity audit — "non-COI + agent" (2026-09-27, read-only subagent; top rows verified by the driver)

Standard: agent behaves as on a developer machine (Pi + Node 24); gaps loud.
Class: ceiling | policy-default | invented-limit | silent-divergence | parity.

| # | where | agent hits | real machine | class | recorded | tests |
|---|---|---|---|---|---|---|
| 1 | `packages/workbench/src/glue/npm-shell-command.ts:287-291` via `no-coi-project-command.ts:182` | `npm install [pkg]` → `NotImplementedError('sandbox.project.npm-install','use toolchain.install')`; `toolchain.install({cwd, registryUrl})` is host-only, takes no package list | `npm install lodash` works | invented-limit / policy-default — the installer runs in the same Worker (`no-coi-toolchain-worker.ts:116-150`); COI shell wires `createNpmShellCommand` | ADR-0418 D4 lists bins/node/`npm run`; nothing records excluding install | none (no-COI) |
| 2 | `packages/shell/src/shell.ts:225-231,851-856` | `npx`/`yarn`/`pnpm` → 127 + nudge "try: npm install …" which itself throws (#1) | `npx vite build` works | silent-divergence (misleading text) | none | none |
| 3 | `no-coi-project-command.ts:59-63,162-166`; `packages/agent/README.md:50` | `allowedCommands` asserted on every stage incl. nested `npm run` scripts; README's `['npm','node']` makes `npm run build` → `EACCES Command is prohibited: vite` | no allowlist | policy-default; README reference config breaks the primary scenario | ADR-0418 D4; kit: unset = unrestricted | allowlist + `npm run` untested |
| 4 | `packages/rifty/src/sandbox-project.ts:119` (`env ?? {}`), `sandbox-host.ts:66` "fresh environment" | every command's `process.env` = `{}`; adapter exposes no env | full user env | silent-divergence | ADR-0418 D2 (SDK); adapter gap unrecorded | env passthrough only |
| 5 | `npm-shell-command.ts:510` `runPackageScript` | `npm run` injects no `npm_lifecycle_event` / `npm_package_*` / `npm_config_*` / PATH | npm injects them | silent-divergence | none | none |
| 6 | `shell.ts:359-360` `allowBackground:false` | `cmd &` → `NotImplementedError('shell.background')`; dev server only via host `startBin` | works | invented-limit (loud) | ADR-0418 D4 | `agent-scenarios.ts:124` |
| 7 | `no-coi-project-command.ts:123` `awaitDrain({capMs:600_000})` | command holding refs > 10 min → Worker replaced | runs forever | invented-limit (loud, value unrecorded) | none | cap untested |
| 8 | `sandbox-host.ts:50-59`, `no-coi-toolchain-worker.ts:283-296` | preview mode removes file+shell tools; `resident-concurrency` NIE | edit + HMR while dev server runs | recorded one-Worker choice | ADR-0377 D1, ADR-0426 D2; kit: commands-only (user C) | `no-coi-pi-agent.spec.ts:183-197` |
| 9 | `no-coi-toolchain-worker.ts:397-402` | host op concurrent with agent command → busy | concurrent ok | recorded | ADR-0376 D1, ADR-0418 D3 | `agent-scenarios.ts:166` |
| 10 | `runtime-js/src/builtins/process-identity.ts:21-30` | `platform='rifty'`, `arch='wasm'` | linux/darwin | recorded honesty | ADR-0026; `runtime-js/process-versions-node-honesty` | unit |
| 11 | `runtime-js/src/builtins/child_process.ts:323-325,461-466` | `spawn('npm'|'vite'|'git')` → ENOENT 127; only `node <script>` | any binary | ceiling for natives; invented gap for `npm` / `.bin` (shell could serve) | `child_process-ceiling.test.ts` | unit |
| 12 | `packages/net/src/https.ts:77`, `net.ts:302` | `https.request`, `net.connect` → NIE; fetch/http = browser fetch, CORS | unrestricted | ceiling (loud) | ADR-0152 family | unit |
| 13 | `no-coi-project-command.ts:203-215` | `node -p`, `--input-type=module -e`, `-r` → NIE; `node -e` ok | work | invented-limit (loud; COI has M11 `node -e/-p`) | none | none (no-COI) |
| 14 | `packages/shell/src/tokenize.ts:70`, `builtins.ts:45-75` | `$(…)` NIE; no `sed/awk/sort/uniq/xargs/cut/tr/diff/curl/tar/test/[`, no if/for/heredoc → 127 | present | invented-limit (loud, JS-implementable) | shell backlog | shell unit |
| 15 | `packages/agent/src/text.ts:1` `TOOL_RESULT_CAP_BYTES = 16 KiB`, `tools.ts:130` | all tool text capped 16 KiB head/tail | Pi: read 50 KB / 2000 lines, bash tail 50 KB | invented-limit (3× tighter than Pi) | ADR-0424 D7 | cap vs real `vite build` output untested |
| 16 | `tools.ts:10,58,244` | list/glob/grep hard-exclude node_modules/.git/dist; 2000-entry walk; 500 matches | Pi: .gitignore-driven | invented-limit (mild) | none | none |
| 17 | `tools.ts:319` `${outcome.stdout}${outcome.stderr}` | shell tool text = stdout then stderr, interleaving lost (streaming `output` events keep order) | interleaved terminal | silent-divergence | none | events tested, text not |
| 18 | `session.ts:47-48` | defaults `maxToolCalls 100`, `runTimeoutMs 180 s` → `budget-exceeded` | Pi: none | invented-limit | ADR-0424 D7 | `session.test.ts`; bench 40 / 600 s |
| 19 | `session.ts:104` `maxRetries:0` | one 429/5xx → run `error` | Pi CLI retries | policy-default (recorded) | ADR-0424 D4 | — |
| 20 | `session.ts:30-45` | fixed Model (`reasoning:false`, ctx 128k, maxTokens 8192, no `compat`), content parts | provider-true | policy-default (recorded) | ADR-0436; kit items 5/6 | — |
| 21 | `prompt.ts:26-28`, `sandbox-host.ts:66-67` | injected "No sudo, apt, brew … dependency policy belong to the host", `Project policy: {json}`, 16 KiB notice | Pi prompt: none | invented text (steers away from adding deps) | ADR-0424 D3 generic | prompt.test |
| 22–25 | Stop semantics, `change`/`edit_file`, per-call cwd, exit codes 127/126/130 | — | same | parity | ADR-0418 D5, ADR-0426 D1 | pi-agent / agent-scenarios |
| 26 | `workbench-host.ts:112-145` | no-COI lacks vs COI: TS diagnostics, SCM diff, CAS writes, persistent cwd/env, PTY, shell `npm install`, background jobs | — | gap list | ADR-0426 "absent stay absent" | asserted absent |

Top findings: (a) #1+#2+#21 — the agent has no way to add a dependency; not a
ceiling (same Worker installs). (b) #3 — README's reference policy silently
breaks every `npm run` script. (c) #4+#5 — empty env, no npm lifecycle vars.
(d) #6+#7+#8 — no dev-server loop for the agent (preview epic). (e)
#15/#17/#18 — build output reaches the model capped, de-interleaved, under a
180 s default budget. (f) #13/#14 — `node -p`, `$(…)`, coreutils missing
(loud). Driver-verified rows: 1, 3, 4, 15, 17, 18, 21 (source read
2026-09-27). Not verified by the audit: whether `model.maxTokens` caps output;
real `vite build` output size vs 16 KiB; Pi CLI default retries.

## User answer on agent install (2026-09-27, verbatim)

«разрешаем, но оно может падать, если к песочнице не подключен npm
registry(такое должно быть валидно с точки хрения конфигурации)». The
routing of the remaining audit rows is the agent's path (goal Decisions).
