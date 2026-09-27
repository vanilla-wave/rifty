# agent-weak-models — refine/FIT evidence (2026-09-27)

Goal: `docs/backlog/epics/agent-weak-models/`. Driver: Claude (refine session,
user present, 2026-09-19…27). Main at `99fdf6c91` (rebased 2026-09-27 from `7f8f4708e`; anchors below re-verified on the new main).

## Request (verbatim)

> Хочется развивать агента и сделать его более функциональным. Приоритет - качественное решение задач на слабых моедлях(уровень deeepseek v4 flash). Сделай ресерч и подробно /explain как замеряется уровень harness(насколько он способен и качественный) что уже есть для pi, и что вохможно построить чтобы получить топовый harness и какие у этого всего есть риски.

Follow-ups (verbatim, in order):

> Есть что-то что "полезно с высокой вероятностью без бенчей" чего у нас еще нет

> звучит ок. Только как будто еще параметры из первого пункта надо расхардкодить и дать настраивать при подключении своей модели/ендпоинта. Плюс компакт нужен не как средство оптимизации, а как средство выживания

> Итого по всему обсуждению, что предлагаешь делать сейчас

> На какой моедли текущие гонялись? Можем что-то от openai взять вместо deepseek flash?

> окей, чем можно заменить flash из моделей claude/cursor(желательно grok/composer)/glm Что ближе всего будет

> окей, оформляй эпик. Модели потом дообсудим

## User answers (AskUserQuestion; question text and chosen option verbatim)

1. Q: «Новые механизмы (agent-level retry, компакция, completion gate, поднятые
   бюджеты, рецепт в промпте) включаются по умолчанию для всех потребителей
   @riftydev/agent или только opt-in?» — options: Для всех, parity с pi
   (описание: pi CLI по умолчанию retry.enabled=true (3×),
   compaction.enabled=true; поведение 0.1.x меняется для всех (0.x semver,
   CHANGELOG + ADR); каждый механизм выключается явной опцией) / Opt-in.
   A: **Для всех, parity с pi**.
2. Q: «Когда запускать самопроверку перед завершением run'а?» — options:
   Только после мутаций / На каждый send. A (free text): **«давай пока без
   этого, как будто в обычных современных клиентах я такого не видел. Если я
   не прав, скажи»**. Driver's answer: the user is right about defaults —
   Claude Code has it only as an opt-in Stop hook / `/goal` evaluator, Cursor
   as a Judge role, DeepSeek Harness as a `goals` plugin; the +~10 pp figure
   comes from Terminus-KIRA, a research harness. Gate dropped → goal
   §Out of scope until re-run evidence.
3. Q (after critic finding 5): «Критик: выбор модели для первого записанного
   baseline (item B) — не «run input», а решение о том, какой класс отказов
   исследуем (слабое рассуждение vs хрупкий формат). Вы сказали «модели потом
   дообсудим». На чём гонять первый baseline?» — options: gpt-6-luna через
   прокси сейчас / Ждать выбора Flash-модели / Оба сразу: Luna + GLM-5.3-Flash.
   A: **gpt-6-luna через прокси сейчас**.
4. Q (after critic finding 6): «Критик: «для всех» не покрывает потребителей с
   собственным `streamFn` — там `settings` запрещён (types.ts:95), а
   компакция/retry зависят от contextWindow и классификации ошибок.
   Распространять новые дефолты и на них?» — options: Да, на все транспорты /
   Только settings-транспорт. A (free text): **«Смотри я ожидаю, что хост даст
   список моделей с параметрами и даст способ вызывать их. Например тут же
   возможность передавать картинки/другие бинарные данные. И Модель сможет
   меняться в сессии. Например поняли что одна 429 отдает, предложили
   пользователю другую. Такой сценарий должен быть поддержан и легко
   осуществим»** → the question's fork was replaced by an embedder-supplied
   model catalog (goal I1–I4; §Decisions "catalog", "images"). Driver's
   reading of «хост»: the embedding application that owns auth/transport
   (ADR-0424 §3/§4), not `AgentHost` (files/shell/preview) — recorded in goal
   §Decisions "catalog" for the user to correct.
5. Q (after final-check blocker 1): «Вы сказали «картинки/другие бинарные
   данные». pi-ai 0.85.1 принимает на вход модели только text + image
   (`Model.input`). Что делать с «другими бинарными» (PDF, архивы, аудио) в
   этом эпике?» — options: Только картинки в модель; остальное — файлом в
   проект (описание: картинки как pi ImageContent; другой бинарный файл
   playground кладёт в проект (VFS) и вставляет путь в промпт — модель читает
   его тулами; передача такого файла напрямую в модель — NotImplementedError +
   compat ❌; картинки из результатов тулов в модель остаются ❌) / Только
   картинки, без файловой загрузки / Картинки + картинки из tool-результатов.
   A: **Только картинки в модель; остальное — файлом в проект**.
6. Q (after final-check blocker 2): «Сегодняшняя форма `createAgentSession({
   streamFn })` не несёт описания модели (ADR-0436 §3: «unknown model») —
   компакции нечем считать окно, retry нечем классифицировать ошибки. Что с
   ней делать?» — options: Оставить как есть, новое — через каталог / Убрать
   форму, только каталог (описание: ломающее изменение 0.x: `streamFn`-форма
   удаляется, все потребители переходят на каталог с описанием модели. Один
   путь, нет legacy) / Применять дефолт 128k. A: **Убрать форму, только
   каталог**. Driver's reading: "один путь, нет legacy" removes the `settings`
   form too — a one-entry catalog with the OpenAI-compatible provider replaces
   it (goal I1; §Decisions "catalog") — recorded for the user to correct.

In-thread decisions (user words): «параметры … расхардкодить и дать
настраивать при подключении своей модели/ендпоинта»; «компакт нужен не как
средство оптимизации, а как средство выживания»; «Модели потом дообсудим» —
the Flash-class lane model is deferred (the first baseline is settled by
answer 3).

«звучит ок» (2026-09-25) answered the agent's list of 2026-09-21, quoted here
so the attribution is checkable (critic finding 7). Agent's list, headings
verbatim: «Почти наверняка: это конфиг и корректность, а не новые механизмы»
— «Модель захардкожена под быстрый сильный endpoint» (reasoning: false,
maxTokens 8192, contextWindow 128k, no temperature/top_p/compat);
«Бюджеты 100 calls / 180 s»; «Retry на transient-ошибки запроса»;
«Диагностика отказа edit_file»; «Детектор циклов». «С высокой вероятностью:
дешёвые механизмы, сходящиеся свидетельства» — «Completion gate»;
«Verification feed»; «Рецепт в промпте»; «Сэмплинг по модели»; «Санитизация
Unicode-тегов и loud report для AGENTS.md/skills». «Проверить, не строить:
байт-стабильность system prompt между ходами». «Без бенча не трогать:
субагенты, параллельные тулы, компакция (…), слияние тулов,
edit-checkpointing, любой fuzzy-matching». The user's reply amended two
items (parameters configurable per endpoint; compaction as survival); the
completion gate was later dropped (answer 2); per-model sampling defaults
were dropped by the agent (goal §Decisions "sampling"); the Unicode item was
routed to the sibling epic's map.

## Versions

- `@earendil-works/pi-agent-core` / `pi-ai` 0.85.1 (workspace pin, ADR-0424);
  `@earendil-works/pi-coding-agent` 0.85.1 (agent-bench devDependency).
  Upstream latest 0.86.1 (2026-09-20). Node v24.16.0. codex-cli 0.157.0.
- Bench baseline on main: `tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol`
  — 42 runs, model `gpt-5.6-sol` through the user's `~/codex-proxy.mjs`
  (self-contained no-auth OpenAI-compatible shim over the Codex subscription,
  port 10530), 42/42 after judge repairs → saturated for a frontier model.

## Probe — what is hardcoded on main (read-only, file:line)

- `packages/agent/src/session.ts:35-49` builds the pi `Model` from `settings`:
  `reasoning: false` (:45), `contextWindow: 128_000` (:48), `maxTokens: 8192`
  (:49), `input: ['text']` (:46); no temperature/top_p/compat flags. `:52-53`
  defaults `maxToolCalls ?? 100`, `runTimeoutMs ?? 180_000`. `:124`
  `toolExecution: 'sequential'`. `:131` `streamSimple(...)` with no retry
  policy. Hooks in use: `prepareNextTurnWithContext` (:139), `beforeToolCall`
  (:145), `afterToolCall` (:154). Run outcome (:264-275): budget → `budget-exceeded`,
  stop → `aborted`, `agent.state.errorMessage` → `error` at once (a provider
  context-length error is an immediate `error`, not a budget spend — critic
  finding 9). `exportTrace` (:335-341) sums usage over retained assistant
  messages only.
- `packages/agent/src/types.ts:78-79` options carry only
  `maxToolCalls`/`runTimeoutMs`; `:114-121` common options incl. `initialMessages` (ADR-0466), `instructions`, `contextFiles`, `skills`; `:127-139` two exclusive transport forms
  (`settings` + optional `fetch` | `streamFn`, `settings?: never`); `:141`
  `AgentStatus` = idle | running | done | error | aborted | budget-exceeded
  (no context-exceeded); trace `config` (:162-173) records budgets only;
  `:189` `send(prompt: string)`, `:191` `reload()`; no `setModel`.
- Agent text tools reject binary: `workbench-host.ts:13-16` throws `Binary file is not supported by text tools` on a NUL byte, `read_file` is UTF-8 only (`tools.ts:130`); the Workbench project files API itself is byte-based (`session.files.readFile(path).bytes`, `workbench-host.ts:49`) — the playground can store any file, the agent reads text only. Native bench lane: `tools/agent-bench/src/lanes/local-reference.ts:94` writes `settings.json` `{ retry: { enabled: false } }` — pi compaction stays on by default there.
- `packages/agent/src/tools.ts:169,171` edit_file failures are
  `edit_file: string not found in <path>` / `edit_file: string is not unique in
  <path>` — no match count, line or hint; `:164` delegates the change to the
  host (`files.change`), no rollback of host write failures (ADR-0424 §7,
  ADR-0426 §1 non-transactional writes). `apply_patch` validation already
  reports hunk detail: `apply-patch.ts:216-221` "hunk <header> does not match
  the current content of <path>" / "hunk <header> matches N positions in
  <path> — ambiguous"; `tools.ts:208` is the write-stage failure after
  validation, reporting applied files (ADR-0424 §7) — critic finding 8.
  `tools.ts:386` tool image results throw
  `NotImplementedError('agent.tool-image-result')`. `text.ts:1` result cap
  16 KiB (`tools.ts:384-392` applies it).
- `packages/agent/src/prompt.ts` (now also renders `<project_context>` and skills, landed goal) + `prompt-profile.ts` (id
  `pi-0.85.1+rifty-adapter-v1`): no workflow paragraph; the prompt is rebuilt
  every turn from capabilities + date.
- `apps/playground/src/ai/settings.ts:4-9,24-26`: fields baseUrl / model /
  apiKey; `maxToolCalls: 100` and `runTimeoutMs: 180_000` are constants in
  `loadSettings`, not editable; `AiChatPanel.tsx` has no model picker, attach
  or switch offer.
- `tools/agent-bench/src/config.ts:3-7,46`: `endpoint` = `{baseUrl, model,
  envKey}` only; `report.ts:14,25,69` per-run columns outcome / agentStatus /
  elapsedMs / toolCalls / failureClass / note (+ `usage` record). No retries,
  compactions, repeated-call, edit-failure or malformed-call columns; no
  comparison between two summaries.
- `grep -rn "compact\|retry\|repeat\|setModel\|images" packages/agent/src` →
  0 product hits.
- Bench timings (2026-09-13 report, gpt-5.6-sol without thinking): 27.2–312 s
  per task, one 541 s outlier (provider latency); max 33 tool calls
  (new-issue-form). The 180 s default would have cut 9 of 42 runs.
- ADR-0436 §2 (Decision): "`AgentSessionOptions` has two exclusive transport
  forms … No second callback, provider catalogue or model-selection API"; §3:
  custom transport uses pi's unknown model state. Both superseded by the
  item-1 ADR (goal §Decisions "public API and ADRs"); §1, §4–6 stay.

## Probe — what pi 0.85.1 already provides (installed dist, read-only)

- pi-ai `Models` registry (`pi-ai/dist/models.d.ts:92-158`): `createModels()`,
  `setProvider(provider)`, `getModel(provider, id)`, `streamSimple(model,
  context, options)`; `Model.input: ("text" | "image")[]` (`types.d.ts:728`),
  `ImageContent` (`:251`). `pi-agent-core` `Agent.prompt(input: string,
  images?: ImageContent[])` (`agent.d.ts:109`). No non-image binary prompt
  input exists in pi-ai 0.85.1. pi-ai does carry image blocks from tool
  results when `model.input.includes("image")`
  (`pi-ai/dist/api/openai-completions.js:1093-1103`) — the rifty ❌ at
  `tools.ts:386` is rifty's own.
- pi CLI `setModel(model, options)` (`pi-coding-agent/dist/core/agent-session.js:1254`)
  sets `this.agent.state.model = model` (:1260); the CLI's
  `prepareNextTurnWithContext` (:293-305) returns `model:
  this.agent.state.model` for the next turn — a switch applies from the next
  request, also inside an active run (final-check concern 1).
- `pi-agent-core/dist/index.d.ts:8` exports compaction:
  `shouldCompact(contextTokens, contextWindow, settings)`,
  `prepareCompaction(pathEntries: Entry[], settings)`, `compact(...)`,
  `compactWithRequest(preparation, options, request: SummaryRequest, context)`,
  `generateSummary(currentMessages: AgentMessage[], models, model,
  reserveTokens, …)`, `estimateTokens(message)`, `DEFAULT_COMPACTION_SETTINGS`
  (`harness/compaction/compaction.d.ts:59-125`). The CLI compacts inside
  `prepareNextTurnWithContext` via `_compactBeforeNextAssistantResponse`
  (`agent-session.js:293-297`).
- `harness/agent-harness.d.ts:617-635` `AgentHarnessOptions`: `models: Models`,
  `model`, `thinkingLevel`, `retry?: RetryPolicy`, `compaction?:
  CompactionSettings`, `steeringMode`, `toolExecution`. The low-level `Agent`
  (`agent.d.ts:5-25`) has `transformContext`, `beforeToolCall`/`afterToolCall`,
  `shouldStopAfterTurn`, `prepareNextTurnWithContext`, `steeringMode`,
  `thinkingBudgets`, `maxRetryDelayMs` — the agent-level retry policy lives in
  `AgentHarness`.
- `pi-ai/dist/types.d.ts:468-508` `OpenAICompletionsCompat`:
  `supportsReasoningEffort` (:474); "all replayed assistant messages must
  include an empty reasoning_content field when reasoning is enabled. Default:
  auto-detected from URL" (:487) — a proxy URL defeats the auto-detect;
  `thinkingTokenBudgetField` (:508). Request options: `temperature?` (:112),
  transport `maxRetries?` (:96).
- pi CLI defaults (upstream pi doc `settings.md` lines 118-120, 143-148):
  `compaction.enabled true`, `compaction.reserveTokens 16384`,
  `compaction.keepRecentTokens 20000`; `retry.enabled true`,
  `retry.maxRetries 3`, `retry.baseDelayMs 2000`, `retry.provider.maxRetries 0`.
  Upstream pi doc `compaction.md`: trigger `contextTokens > contextWindow -
  reserveTokens`, checked after tool results before the next assistant
  response; compaction runs inside the same agent run and resumes with
  summary + retained tail.
- pi CLI retry implementation (`agent-session.js`): `_isRetryableError(message)`
  → pi-ai `isRetryableAssistantError` (:2248-2252); `_prepareRetry` gives up
  when `_retryAttempt > settings.maxRetries` — i.e. 3 retries after the
  original attempt — with delay `baseDelayMs * 2 ** (attempt − 1)` and
  `auto_retry_*` events (:2286-2301); the critic's probe reported the
  classifier admitting a retryable error after partial text
  (`partialTextRetryable: true`) — goal I6 follows pi, not a stricter rule.
- pi-ai transport retry (`pi-ai/dist/utils/provider-retry.js:78-92`): with `retriesRemaining <= 0` the error is thrown at :86 before `getRetryDelayMs` reads a provider `Retry-After`; the CLI agent-level retry uses the fixed delay `baseDelayMs * 2 ** (attempt − 1)` (`agent-session.js:2297`) — a `Retry-After` header is never honoured under pi defaults (final-check pass 4 probe with `Retry-After: 30` and `90`: error preserved, still retryable).
- ADR-0434 §Corrections (2026-09-18): ADR-0440 supersedes decision 3's unchanged-assembled-prompt clause; ADR-0440 §4 "Preserve profile id/paragraphs" is the active constraint the recipe paragraph amends. Skills enter the prompt as metadata only (`prompt.ts:44-50`); bodies are read with `read_file`.
- `pi-agent-core/dist/agent-loop.js:411` `validateToolArguments` already
  returns an error result for malformed tool arguments → no separate
  "tool-call repair" item is needed; the model sees the validation error.

## Probe — endpoint reality for the first baseline

- `~/codex-proxy.mjs:53668` `CLIENT_VERSION = "0.111.0"`; override flag
  `--codex-version` (:53747). The Codex backend gates GPT-6 models by client
  version ≥ 0.155.1 ([litellm-mysubs #2](https://github.com/eduardopessin/litellm-mysubs/issues/2),
  2026-09-25). The subscription no longer serves `gpt-5.6-*`; it serves
  `gpt-6-luna`, `gpt-6-sol`, `gpt-6-astra`, `gpt-5.5` (retires 2026-10-14)
  ([OpenAI changelog](https://learn.chatgpt.com/docs/changelog)). The
  2026-09-13 baseline model cannot be re-run through the proxy.
- Not executed: booting the proxy to list served models (it prints them);
  item 4 does this at run.

## Research digest (web, 2026-09-19…26; "self" = vendor-reported)

Harness measurement:

- Leaderboards score model+harness pairs; minimal harnesses isolate the
  model: SWE-bench Verified bash-only board (mini-swe-agent), Terminal-Bench
  2.x with Terminus 2 (Harbor; 89 tasks, k=5; 101 agents / 23 scaffolds —
  [Snorkel TB 2.1](https://snorkel.ai/leaderboard/terminal-bench-2-1/),
  [efficient benchmarking, arXiv 2603.23749](https://arxiv.org/abs/2603.23749)).
- Same model, different harness: GPT-5.5 Codex CLI 83.4 vs Terminus 2 76.4 on
  TB 2.1 ([codex.danielvaughan](https://codex.danielvaughan.com/2026/06/11/terminal-bench-2-1-june-2026-benchmark-landscape-codex-cli-harness-engineering-model-scores/));
  Opus 4.5 Claude Code 55.4 vs SEAL 45.9 on SWE-bench Pro, HAL swings to
  ~48 pp ([arXiv 2605.23950](https://arxiv.org/abs/2605.23950)); Opus 4.5
  57.8 @ 3.9M vs 52.1 @ 256.9M input tokens on TB 2.0; pass-rate spread
  between OSS harnesses 0–8 pp but 40× tokens per solved task
  ([Scaffold Effect, arXiv 2607.22585](https://arxiv.org/html/2607.22585));
  OpenClaw adapter minimal 19.1 vs full 73.4, model variance 29.4 pp vs harness
  27.4 pp ([Claw-SWE-Bench, arXiv 2606.12344](https://arxiv.org/pdf/2606.12344)).
- Metrics beyond pass@1: tokens/$ per solved task; failure taxonomy REASON /
  VERIFY / MAX_TURNS / idle-loop / TIME; per-tool success (OpenHands fsWrite
  29 % Qwen3-8B → 97.7 % 480B); coherence collapse — 60–69 % of failures had
  reached the right code ([arXiv 2603.24631](https://arxiv.org/abs/2603.24631));
  trajectory reviews ([AgentLens, arXiv 2607.06624](https://arxiv.org/abs/2607.06624)).
- Component-level ablation (Sept 2026, 176 settings, 4 models): context
  management pays mainly by preventing overflow, staged rule-based removal
  before LLM summary is most efficient, recoverability adds no accuracy;
  planning is an accuracy scaffold for weaker models, a cost saver for
  stronger; predefined tools help weak-bash models
  ([arXiv 2609.20804](https://arxiv.org/abs/2609.20804)).
- Long-horizon, same weak model: DeepSeek V4 Flash on LHTB (46 tasks) —
  Terminus-2 0.451 (90 min) / 0.455 (3 h, 5/46 solved) vs Geass harness 0.602
  (90 min, 14/46) ([LHTB](https://github.com/zli12321/LHTB)).
- Completion gate: Terminus-KIRA (research harness) +~10 pp from checklist
  self-verification ([Krafton](https://krafton-ai.github.io/blog/terminus_kira_en/));
  Anthropic evaluator/generator 20× tokens
  ([harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
  Not a default in shipped clients → out of scope here (user answer 2).
- Auto-evolved harnesses: AHE 69.7 → 77.0 on TB 2.0 for GPT-5.4
  ([arXiv 2604.25850](https://arxiv.org/abs/2604.25850)); Meta-Harness;
  Harbor BO — need a bench first.
- Multi-agent: helps when single-agent < ~45 % and the task decomposes; hurts
  on sequential tasks; 4–15× tokens
  ([Nature MI / arXiv 2512.08296](https://arxiv.org/abs/2512.08296)).
  DeepSWE: mini-swe-agent ≥ native harnesses on n=10.

Weak-model techniques and failure modes:

- Edit formats: unified diff worst for weak models (−2…−4 pp, "context tax");
  search/replace failures are anchor ambiguity; malformed edits must fail with
  a precise reason; Aider feedback loop
  ([Aider edit formats](https://aider.chat/docs/more/edit-formats.html),
  [Diff-XYZ, arXiv 2510.12487](https://arxiv.org/pdf/2510.12487)).
- Tool calling: reliability is a training property; fewer disjoint tools;
  parse-repair via error feedback; grammar over-constraint hurts
  ([local tool calling guide](https://llmconfigurator.com/en/guides/coding-agents/tool-calling-local-models)).
- DeepSeek Flash wire failures seen in harnesses: answer only in
  `reasoning_content` ([opencode #49673](https://github.com/anomalyco/opencode/issues/49673));
  infinite loop on finish=unknown / custom stop sequences
  ([opencode-cmd-provider #211](https://github.com/rashidrazak/opencode-cmd-provider/issues/211));
  HTTP 400 when `reasoning_content` is not replayed
  ([codex-router #809](https://github.com/duolahypercho/codex-router/issues/809));
  truncated edit payloads under output-token pressure
  ([oh-my-pi #10555](https://github.com/can1357/oh-my-pi/issues/10555));
  streaming tool-call detector corruption, test non-streaming
  ([HF discussion](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/discussions/37));
  provider fallback loses cache (4¢ vs 0.1¢ per turn); pi with thinking high +
  retry 5 ran 123 turns cleanly
  ([Schmalbach](https://www.vincentschmalbach.com/pi-deepseek-v4-1-flash-openrouter-setup/)).
- DeepSeek agentic sampling recommendation: temperature 1.0, top_p 0.95
  ([V4 Flash 0731 release](https://huggingface.co/blog/ResterChed/deepseek-v4-flash-official-release)).

Pi ecosystem: 0.86.x adds prompt-cache warming, per-model compaction budgets,
transcript-aware prompt/tool updates ([releases](https://github.com/earendil-works/pi/releases));
extensions are Node-only (jiti + `node:*`) → compat ❌ in the browser
(`epics/agent-pi-project-resources` I7).

Security (for the sibling epic, routed as fog): AGENTS.md/SKILL.md load as
operator-level instructions; ClawHub audit 36.8 % flawed / 76 malicious
skills; invisible Unicode tag characters (U+E0000–E007F) patched in Claude
Code 2026-02-10 ([CSA note](https://labs.cloudsecurityalliance.org/research/csa-research-note-skill-md-agent-context-poisoning-20260506/)).

## Model candidates for the weak lanes

| Model | $/M in / out | Context | Agentic (self unless noted) | Access from `@riftydev/agent` |
|---|---|---|---|---|
| DeepSeek V4.1 Flash (2026-09-10) | 0.15–0.30 / 0.60–1.20 | 1M | TB 2.1 90.6, DeepSWE 74.2; TB 3.0 30 | OpenAI-compatible, key; alias `deepseek-v4-flash` → 4.1 |
| GLM-5.3-Flash (2026-08-26, MIT weights) | 0.15 / 0.50 (promo ×0.5) | 1M / 128k out | TB 2.1 84.3, DeepSWE 63.4 | OpenAI-compatible + Anthropic API, key; Coding Plan limited to listed tools |
| GPT-6 Luna (2026-09-22) | 0.10 / 0.50 | 1.05M / 128k out | 5.6 Luna LiveBench agentic coding 48.4 (independent) | free through the user's codex-proxy (needs `--codex-version` ≥ 0.155.1) |
| grok-code-fast-1 | 0.20 / 1.50 | 256k | SWE-V 70.8 (Aug 2025) | xAI key; deprecated on Oracle May–Aug 2026 |
| Cursor Composer 2.5 | 0.50 / 2.50 | 200k | SWE-Multilingual 79.8 | no API outside Cursor — unusable here |
| Claude Haiku 4.5 | 1 / 5 | 200k | SWE-V 73.3, TB 2.0 41 (Terminus 2) | Anthropic API; Haiku 5.5 announced, no date |

Two weak profiles: format-fragile but capable (DeepSeek/GLM Flash) and
format-reliable but weak reasoning (GPT-6 Luna, Haiku). First recorded
baseline: `gpt-6-luna` (user answer 3); the Flash-class lane model is deferred.

## False on main (`99fdf6c91`)

- I1 — `session.ts:45,48,49` hardcode reasoning/context/maxTokens; `types.ts:127-139` two exclusive transport forms, no catalog; ADR-0436 §2 forbids a catalog; trace `config` (:162-173) lacks model values.
- I2 — no `setModel` on `AgentSession` (`types.ts:185-197`); grep `setModel` → 0.
- I3 — `send(prompt: string)` (`types.ts:189`); `input: ['text']` (`session.ts:46`); no image path; no binary rejection (a caller cannot pass one at all).
- I4 — `apps/playground/src/ai/settings.ts:4-9,24-26` one baseUrl/model/apiKey, budgets constant; `AiChatPanel.tsx` no picker/attach/switch offer.
- I5 — no compaction code; `AgentStatus` (:141) has no `context-exceeded`; provider context-length error → immediate `error` (`session.ts:269-271`); `exportTrace` (:335-341) drops usage of messages not retained.
- I6 — `session.ts:131` `streamSimple` without retry; ADR-0424 §4 "zero automatic retries"; grep `retry` → 0.
- I7 — `tools.ts:169,171` bare edit_file match-failure strings (apply_patch detail exists, `apply-patch.ts:216-221`, and is kept).
- I8 — no repeated-call detection; `beforeToolCall` (:145) only counts calls.
- I9 — `runTimeoutMs ?? 180_000` (:53); tool envelopes carry status/exit/error only (`tools.ts:21` `modelResultText`).
- I10 — diagnostics only as the separate `diagnostics` tool (`tools.ts:330`); edit results are `edited <path>` (:174).
- I11 — `prompt-profile.ts` paragraphs intro/guidance/recovery/verification; no workflow paragraph.
- I12 — `config.ts:3-7` endpoint fields; `report.ts` columns; no weak-model summary under `reports/summaries/`.
- I13 — no second summary and no comparison rendering in `report.ts`.

## Critic (fresh read-only premise check, §Challenge; verdict verbatim)

`codex exec -s read-only` (codex-cli 0.157.0), prompt `/tmp/awm/critic-prompt.md` (request, answers 1–2, goal/map/first draft set, authority files), 2026-09-27:

`challenge: 2026-09-27 — 10 problems`

1. [value] `goal.md:128`, `map.md:54`: I10 требует только baseline **до** улучшений; повторный замер оставлен fog. Все инварианты могут выполниться при ухудшении качества решения задач. Нужны обязательное сравнение после изменений и критерий результата.
2. [value] `goal.md:100`: I5 «a failing … apply_patch writes nothing» обещает атомарность любых ошибок. `packages/agent/src/tools.ts:195,208` допускает частичные записи при сбое host; ADR-0424 §7 сохраняет applied/unknown effects. Ограничить обещание ошибками проверки patch либо обосновать новую атомарность.
3. [evidence] `goal.md:92,139`: описанный retry не равен pi 0.85.1. `retry.maxRetries=3` означает исходную попытку плюс три повтора; CLI `_prepareRetry` также повторяет transient error после частичного текста (`pi-coding-agent/dist/core/agent-session.js:2248,2286`). Выполненный probe классификатора подтвердил `partialTextRetryable: true`; ADR-0424 §6 запрещает повтор действия, не частичного ответа.
4. [value] `ai-agent-repeated-call-guard.md:31` сравнивает полный capped result, но I7 (`goal.md:112`) добавляет изменяющиеся `callsLeft/msLeft` каждому результату. Одинаковые ошибки перестанут считаться одинаковыми; I6 не обнаружит заявленный цикл. Сравнение должно исключать бюджетные поля.
5. [omitted-choice] `goal.md:149`: запуск baseline молча выбирает GPT-6 Luna, хотя пользователь сказал «Модели потом дообсудим» (`evidence.md:22`). Выбор определяет исследуемый класс отказов — evidence:228 различает слабое reasoning и хрупкий формат. Ответа, разрешающего выбрать Luna без обсуждения, нет; «run input, not scope» — решение агента.
6. [omitted-choice] `goal.md:72,139`: существующий consumer с `streamFn` получает новые defaults «для всех», но параметры доступны через `settings`, запрещённые этой ветке API (`packages/agent/src/types.ts:95`). Компакция по неподходящему default window либо обязательная передача новых model metadata существенно меняют работу custom endpoint. Ни ответ пользователя, ни ADR-0424 §4 не выбирают эту политику.
7. [attribution] `agent-weak-models-refine-evidence.md:44` приписывает «звучит ок» согласие на конкретный список механизмов, но исходное предложение со списком не приведено. Цитата настоящая; её предмет подтверждён только пересказом автора. Нельзя проверить атрибуцию verification feed, loop detector и прочих пунктов.
8. [evidence] «False on main», `agent-weak-models-refine-evidence.md:240`, неверно обобщает `apply_patch` как bare failure: `packages/agent/src/apply-patch.ts:217,221` уже сообщает файл, hunk header с диапазонами и число неоднозначных совпадений. `tools.ts:208` относится к другой стадии — сбою записи после проверки.
9. [evidence] `agent-weak-models-refine-evidence.md:238`: context-length error не обязан появляться «after the budget is spent» — `session.ts:230` сразу завершает run с `error`. Пример `goal.md:57` с чтением 1M токенов также не воспроизводит заявленную причину: `tools.ts:392` ограничивает результат 16 KiB.
10. [advisory] `goal.md:85,125`: замена истории summary взаимодействует с экспортом и метриками — сейчас usage суммируется из retained messages (`session.ts:284`), поэтому удалённые сообщения перестанут учитываться. Зафиксировать сохранение полного учёта, включая summary-запросы, и проверку browser/native lanes; существующий ADR-0424 §7 уже требует export usage, нового пользовательского выбора здесь нет.

Resolution: 1 → I13 + item `ai-agent-weak-model-rerun`; 2, 8 → I7 limited to
`edit_file` match failures, apply_patch detail and §7 partial-effects report
kept; 3 → I6 rewritten to pi semantics (verified `_prepareRetry` /
`_isRetryableError` lines above); 4 → I8 excludes budget fields, item 9 after
item 5; 5 → user answer 3 (I12 names `gpt-6-luna`); 6 → user answer 4 →
catalog design (I1–I4, items 1–3), then user answer 6 removed the legacy
forms; 7 → agent's list quoted above; 9 → scenario 6 and probe text
corrected; 10 → I5 keeps full usage totals.

## Final written-result check (`RDY-6`, fit.md 8)

Fresh read-only `codex exec` (codex-cli 0.157.0), prompt
`/tmp/awm/final-check-prompt.md` (request, all answers, this file, goal / map
/ ledger, the twelve seeded drafts, README rows, sibling-map fog line,
authority files and installed pi typings); no author context.

- Pass 1 — `final-check: 2026-09-27 — FAIL — 4 blockers, 4 concerns` (verbatim):
  1. `goal.md:192` — «other binary input has no honest carrier → NotImplementedError». Ответ 4 явно включает «картинки/другие бинарные данные». Отправить иной бинарный файл или получить отказ — материально разные результаты. Ограничение pi доказывает технический пробел, но не согласие пользователя исключить запрошенное; Fidelity требует честного отказа, не разрешает закрыть вопрос scope.
  2. `goal.md:193` — «user answer 4 replaced the `streamFn` fork with "every entry carries its descriptor"». Пользователь этого не сказал. I1 сохраняет старый `streamFn`, которому descriptor не передавался (`types.ts:86–100`); новые defaults требуют его. Продолжать с вымышленным window 128k, требовать миграцию или сохранять прежнее поведение — нерешённый материальный выбор. ADR-0436 §3 прямо сохраняет неизвестную модель. Finding 6 критика не закрыт.
  3. `goal.md:136` — «A failing `edit_file` writes nothing». Обещание охватывает host/write failures, хотя ADR-0424 §7 сохраняет applied/unknown effects, ADR-0426 §1 — нетранзакционные записи. `tools.ts:164` делегирует изменение host; rollback отсутствует. Дочерний `ai-agent-edit-failure-diagnostics.md` обещает отсутствие записи только при ошибках совпадения. Ограничить I7 этими ошибками: текущая формулировка добавляет неподтверждённую атомарность.
  4. `ai-agent-model-catalog.md:42` — «compaction on … agent-level retry on» уже после среза 1. Но I12 требует baseline до механизмов, а `ai-agent-weak-model-baseline-lane.md:38` — нулевые счётчики ещё отсутствующих механизмов; retry/compaction отложены до срезов 6/7. Противоречие порядка: baseline либо уже включает изменения, либо срез 1 принимает неработающие настройки. Разделить описание будущих defaults и реально поставляемое поведение.
  Concerns: (1) `map.md:62` «I2 follows pi's answer» stale — CLI `agent-session.js:293–305` updates model before the next turn; (2) `ai-agent-verification-feed.md:31` «diagnostics: pending» vs unconditional I10; (3) `README.md:40` «retry before any assistant output» contradicts I6; (4) `map.md:83` tool image results excluded as «no pi 0.85.1 carrier» — wrong basis, pi-ai `openai-completions.js:1093–1103` handles them, the limit is rifty `tools.ts:386`.
  Resolution: B1 → user answer 5 (images to the model, other files into the project — I3/I4, §Decisions "images"); B2 → user answer 6 (legacy forms removed — I1, §Decisions "catalog"); B3 → I7 limited to match failures, host-write semantics named; B4 → `retry`/`compaction` options moved to I5/I6 (items 6/7 after the baseline), item 1 ships the catalog only, §Decisions "defaults" reworded; C1 → fog closed, §Decisions "setModel timing" with the verified lines; C2 → I10 admits `diagnostics: pending`; C3 → README row rewritten; C4 → map Out of scope names `tools.ts:386` as the authority and the user's answer 5.
- Pass 2 (after the pass-1 edits and answers 5–6) — `final-check: 2026-09-27 — FAIL — 1 blockers, 3 concerns` (verbatim):
  1. `goal.md:50` — «the model reads it with `read_file`». Сценарий обещает чтение PDF, но `read_file` читает UTF-8 (`packages/agent/src/tools.ts:130`); Workbench отвергает бинарные данные (`workbench-host.ts:11–15,49`). I4 и дочерний playground-draft обеспечивают только загрузку и путь. Ответ 5 разрешает файловый путь, но не подтверждает новую способность читать PDF. Сценарий противоречит доступному инструменту; требуется исправить обещание либо явно урегулировать дополнительную обработку.
  Concerns: (1) `goal.md:182` «their columns read 0 there» — edit/argument failures exist before the mechanisms; native compaction is already on, `local-reference.ts:94` disables only retry; (2) `goal.md:211` «each has an explicit off switch» — I9/I11 carry no switch; trace answer 1; (3) `ai-agent-playground-model-catalog.md:22–31` promises `context-exceeded` offer and compaction markers whose events appear in slice 7.
  Resolution: B1 → scenario 2 and I4 reworded: the file lands in the project through the Workbench project files API (bytes), agent text tools keep rejecting binary (`workbench-host.ts:13-16` NUL check, `read_file` UTF-8 `tools.ts:130`), the model acts on it with project commands — no new read capability promised; C1 → I12 and the baseline draft describe each lane's actual events (native lane: pi compaction on, retry off by `local-reference.ts:94`); C2 → §Decisions "defaults" names which mechanisms carry switches and records the deviation from the answer-1 option text for the user; C3 → the `context-exceeded` offer and compaction marker moved to item 7 (I4 "once I5 lands"), playground draft says so.
- Pass 3 (after the pass-2 edits) — `final-check: 2026-09-27 — FAIL — 1 blockers, 2 concerns` (verbatim):
  1. `goal.md:219` — «the recipe paragraph has no switch». Ответ 1 явно обещал «каждый механизм выключается явной опцией» (evidence:26–32). Потребитель больше не может отключить рецепт. ADR-0434 §3 этого ограничения не требует; запись «deviation … recorded here for the user» не означает согласия. Вернуть выключатель либо получить ответ пользователя. Исправление pass 2 C2 не закрыто.
  Concerns: (1) `map.md:102` «belongs to `epics/agent-pi-project-resources`» — on `origin/main` (`99fdf6c91`) that goal and its children are already deleted after implementation; the fog line points at a closed carrier; evidence checked the old `7f8f4708e`; (2) `ai-agent-playground-model-catalog.md:4` title still promises «or context-exceeded».
  Resolution: B1 → I11 gains `recipe: false` (trace `config` records it), §Decisions "defaults"/"prompt recipe" updated, item 11 draft updated — matches the answer-1 option text, no new user choice; C1 → branch rebased onto `99fdf6c91` (WIP commit + `git rebase origin/main`; conflicts: the sibling map edit dropped with the deleted file, README rows re-added), all file:line anchors above and in the drafts re-verified on the new main (session.ts model block :35-49, budgets :52-53, hooks :139/:145/:154, error outcome :269-271, usage :335-341; types.ts common options :114-121 incl. `initialMessages` per ADR-0466, transport forms :127-139, `AgentStatus` :141, config :162-173, `send` :189), the Unicode finding captured as the question draft `distribution/ai-agent-context-file-unicode-tags` and the goal map points there; C2 → title fixed.
- Pass 4 (after the rebase and pass-3 edits) — `final-check: 2026-09-27 — FAIL — 1 blockers, 3 concerns` (verbatim):
  1. `goal.md:145` — «provider-requested delays honoured up to the configured cap». Противоречит выбранной parity с pi при transport retries = 0: `pi-ai/dist/utils/provider-retry.js:86` возвращает ошибку до обработки `Retry-After`; CLI `agent-session.js:2297` назначает фиксированный exponential backoff. Probe с `Retry-After: 30` и `90` подтвердил: исходная ошибка сохраняется, остаётся retryable. Исправить I6 и связанную строку `ai-agent-transient-request-retry.md:49`; нынешнее обещание требует поведения сверх принятого oracle.
  Concerns: (1) `ai-agent-playground-model-catalog.md:21` «owned by `distribution/ai-agent-playground-reload`» — item deleted on current main; (2) `ai-agent-context-file-unicode-tags.md:18` «files byte-for-byte into … `<available_skills>`» — skills pass metadata only (`prompt.ts:46`), bodies via `read_file`; (3) `ai-agent-prompt-recipe.md:21` «without changing its default assembled prompt» — already superseded: ADR-0434:69 → ADR-0440.
  Resolution: B1 → I6 and the retry draft state pi's fixed exponential backoff and that `Retry-After` is not read (provider-retry.js:86 fact above), §Decisions "retry semantics" updated; C1 → playground draft cites the landed `/reload` (ADR-0440, `chat-command.ts`); C2 → Unicode draft distinguishes context-file bodies (byte-for-byte) from skill metadata + `read_file` bodies; C3 → I11, §Decisions "prompt recipe", recipe draft and README row name ADR-0440 §4 as the active constraint.
- Pass 5 (after the pass-4 edits) — `final-check: 2026-09-27 — PASS — 0 blockers, 2 concerns` (verbatim): (1) `map.md:45` «ADR-0434 §3 note» — stale reference, goal I11 and the recipe draft already name ADR-0440 §4; (2) `ai-agent-context-compaction.md:48` «summary request fails … run ends with the provider error» — pi threshold compaction (`agent-session.js:1867–1889`) reports the error and returns `false`, the hook (`:274–286`) continues the next request with the unchanged history; align at PICKUP (carrier note, no trace — `RDY-3` concern). Both applied inline (map item 11 wording; compaction draft fault note now follows pi). Reviewer: fresh `codex exec` (codex-cli 0.157.0), read-only; `backlog:check` and `refs:check` PASS.

Reviewed revision: the commit carrying this file. Status flipped to `ready` after pass 5.
