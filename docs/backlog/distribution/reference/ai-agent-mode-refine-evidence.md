# AI agent mode + agent-bench — refine evidence, 2026-09-12

Goal: `docs/backlog/epics/ai-agent-mode-and-bench/`. Entry: `rifty-refine`, user in session.

## Original request (verbatim)

> Хочу вот эту историю воскресить https://github.com/vanilla-wave/rifty/pull/111
> Но с тех пор много чего поменялось - точно надо будет пересобирать по мотивам, а не чинить. Глянь что думаешь. Основные мысли те же остались что и были

First-round answers (verbatim):

> - должно быть возможно использовать при использовании workbench
> - no COI works. Скорее в формате "агент правит исходники, а потом из них можно что-то собрать"
> - без апрува

Second round (after the critic, `AskUserQuestion`):

- UI surface → «Headless + playground «+chat» (Recommended)»
- no-COI hands-on → «Только библиотека + e2e в tests/no-coi»
- no-COI agent capability → «Давай тут обсудим. Кажется проблема шире этого вопроса» → discussion:
  «Не понял, насколько юзабельным шел получится, что будет можно и что нельзя. Интуиция подсказывает - шел можно давать если агент что-то там сможет сделать, если нет, то будет чаще ошибаться. Хочется сейчас какой то бейзлайн прикинуть в который мы верим, а когда будет вся инфра по eval готова тестить конкретику» → «Не понял почему именно не даем shell в no COI» → «а прямо сейчас шела нет в non COI? Посмотри свежий main» — resolved by fact: ADR-0418 (2026-09-10) ships `sandbox.project().run(line)` over the real shell; one tool surface in both hosts (§Baseline).
- API key → «Ждем ендпоинта без авторизации»

Third round (after the final check, `AskUserQuestion`): no-COI bench lane in v1 → «Да, no-COI lane в v1 (Recommended)».

## PR #111 → main (verified 2026-09-12, main @ acf594da9)

| #111 pillar | main | status |
|---|---|---|
| ADR-0192 esbuild-wasm 0.27.7 host shim | ADR-0226 (0.28.0 upstream-derived, PR #134/#141; PR #125 facade rejected) | landed, different |
| ESM-of-CJS namespace cache fix | ADR-0226 D3 | landed |
| react-vite preset, 4 rough edges | PR #300 (2026-09-02, "PR #111 was a quarry") | landed |
| AI mode `apps/playground/src/ai` (26 files), ADR-0190 | none | this goal |
| `tools/agent-bench` (2 lanes, 5 tasks), ADR-0191 | none | this goal |
| `app-context.ts` seams: terminal-manager, owner-rpc-fs, git-owner-port, ts-ls-client, node-program-lifecycle, preview-bridge-wiring | all gone; sealed `@riftydev/workbench` (ADR-0263) + no-COI `sandbox.project()` (ADR-0418) | rewrite |

Branch `origin/ai-mode-mvp` (15 commits, 131 files, fork 2970faaa1) remains the quarry.

## Pi 0.85.1 browser spike (disposable, /tmp)

```
npm view @earendil-works/pi-agent-core version   → 0.85.1 (modified 2026-09-05)
npm i --registry=https://registry.npmjs.org @earendil-works/pi-agent-core@0.85.1 @earendil-works/pi-ai@0.85.1 esbuild@0.25.0
# (user-level mirror npm.yandex-team.ru had not synced 0.85.1 → ETARGET)
entry.ts: import { Agent } from '@earendil-works/pi-agent-core'; import { Type } from '@earendil-works/pi-ai'; import * as oc from '@earendil-works/pi-ai/api/openai-completions';
esbuild entry.ts --bundle --platform=browser --format=esm --splitting --outdir=out --metafile=meta.json
  → 1 chunk, 1,238,955 B unminified; inputs 1019; externals: node:fs; node builtins as inputs: none
esbuild --minify … | gzip -c | wc -c → 120174
static graph packages: typebox 820 KB, pi-agent-core 597 KB, yaml/browser 280 KB, pi-ai 231 KB, openai 363 KB, diff 79 KB; @earendil-works/chord (deps: esbuild — NOT in graph), pi-telemetry (deps: none, no fetch/http in dist)
pi-ai api files static: lazy.js constrained-sampling.js github-copilot-headers.js openai-prompt-cache.js simple-options.js transform-messages.js openai-completions.js — no anthropic/google/aws inputs
node:fs importer: @earendil-works/pi-ai/dist/utils/provider-env.js (Bun-only /proc/self/environ fallback behind `typeof process`), imported by dist/api/openai-completions.js
pi-agent-core: no node builtin imports. pi-coding-agent@0.85.1 bin: pi
node v24.16.0, esbuild 0.25.0
```

## Baseline (believed before the bench; facts from main 2026-09-12)

Legend: ✅ proven by tests on main · ⚠️ path exists, this case unproven · ❌ absent, loud.

| Agent action | COI Workbench (`ProjectTerminal.run`, same path as the user terminal) | no-COI `sandbox.project()` (ADR-0418) |
|---|---|---|
| read/write/edit files | ✅ `ProjectFiles` (versioned) | ✅ `project.fs` (rooted, readonly policy); ❌ while a resident lives |
| search (`grep`/`find`/`ls`/`cat`/`head`/`tail`/`wc`, globs, `$VAR`) | ✅ shell built-ins | ⚠️ same shell; no `tests/no-coi` spec runs them (only `echo`/`pwd`/`npm run build`/`vite build`) |
| `node x.js` | ✅ (`node -e/-p` ✅ `m0-curious-first-15min.spec.ts`) | ✅ (`node -e/-p` ⚠️ unproven; loud subset: `--input-type=module`, TS, preload, `-p -- <entry>`) |
| `npm install` / `npm run <script>` | ✅ | ✅ (`toolchain.install` / shell `npm run`) |
| `vite build` / installed `.bin` | ✅ | ✅ (`tests/no-coi/no-coi-agent-installed-cli.spec.ts`) |
| `tsc --noEmit` via `.bin` | ⚠️ (`.bin` path proven for prettier/eslint/vite; `tsc` unproven) | ⚠️ same |
| ts diagnostics == Problems panel | ✅ `PlaygroundTypeScript` | ❌ no ts-LS |
| dev server + preview | ✅ `npm run dev` + `PlaygroundPreview` | ⚠️ host `startBin` resident only; agent reads `previewUrl` |
| own `server.js` + preview | ✅ | ❌ (`project.run('node server.cjs')` lives until Stop, no preview bridge) |
| `git status/diff/commit` | ✅ shell `git` (isomorphic porcelain subset) | ⚠️ same shell (`builtins.ts` registers `git`); no `tests/no-coi` spec runs it |
| SCM diff for trace | ✅ `PlaygroundScm` | ❌ (shell `git diff` only) |
| vitest/jest | ⚠️ not in compat matrix | ⚠️ same |
| foreground `\|` / `<` | ✅ (`m0-curious-first-15min.spec.ts` `cat pipe.txt \| grep beta`) | ⚠️ same shell, unproven there |
| `\|`/`<` inside a background job; `sed`/`awk`/`sort`/`xargs`; `npx` | ❌ `shell.pipe`/`shell.input-redirect` (background jobs only); no such commands; `npx` → nudge | ❌ same |
| concurrent commands | ✅ terminal sessions | ❌ one call; busy → loud |
| stdin, background `&` | ⚠️ partial / ✅ trailing `&` | ❌ / ❌ rejected |
| Stop mid-command | ✅ `ProjectTerminalRun.stop` | ✅ `stop()`; after 1 s Worker replaced, effects reported uncertain |
| project fs / commands while dev server lives | ✅ | ❌ `sandbox.toolchain.resident-concurrency` (also `project-fs`); raw `sandbox.fs`/`runtime.eval` still work but bypass root/readonly policy |

Consequence recorded in the goal: one tool surface; `diagnostics`/`scm` are
host capabilities (absent in no-COI → not offered, named in the prompt);
in no-COI preview mode `project.fs`/`shell` surface the host's loud error. Bench tasks:
4 React tasks reachable in both hosts (edit → build/preview); `node-endpoint`
COI-only.

## Challenge (fresh read-only critic, general-purpose subagent, 2026-09-11 wall clock per critic; verbatim verdict)

```
challenge: 2026-09-11 — 6 problems
- P1 fork 3 recommendation (`run_bin`) inverts the user's literal answer "агент правит исходники, а потом из них можно что-то собрать"; ask with the words, do not default.
- P2 omitted choice: API key persisted in plaintext localStorage "as in #111" has no user record (`epics/ai-mode-mvp.md` Decisions silent; `open-bolt-ai-sandbox-demo.md` says in-memory only).
- P3 omitted choice: "no COI works" has no hands-on surface — `apps/playground/src` has zero no-COI code; fork 2 must be re-posed as none | bolt page | playground no-COI mode.
- P4 fork 4 (tier) is agent-fitted per AGENTS.md/§Tier, not a user stop; drop it from the interview.
- P5 bolt re-base residual: no-COI `startBin/runBin` accepts only `node_modules/.bin` entries (`host.ts:665-666`) — Express `server.js` preview stays unreachable in no-COI.
- P6 ADR-0190/0191 never merged (cannot be "superseded"); git/ts-language-service are unpublished, so "publishable like" mis-states the baseline.
```

Critic also noted: "+chat AND vibe" is a REV-7 candidate; `diagnostics`/SCM live only on the playground companion → capability-optional tools; `packages/rifty` absent from arch TIERS (carrier); Pi `node:fs` stub must be unreachable or loud.

Resolutions: P1 → asked with the user's words; superseded by fact (ADR-0418 shell in no-COI; §Baseline). P2 → asked; «Ждем ендпоинта без авторизации» → key optional, not persisted. P3 → asked; «Только библиотека + e2e в tests/no-coi». P4 → dropped; tier fitted at FIT. P5 → recorded in `ai-agent-no-coi-host` Out of scope and `agent-bench` Decisions. P6 → wording fixed in goal Decisions (new ADRs replace never-merged branch ADRs; publication confirm-first).

## Final check of the written result (RDY-6)

Pass 1 (fresh read-only reviewer, general-purpose subagent, on the working tree @ acf594da9; verbatim verdict):

```
final-check: 2026-09-12 — 6 problems
1. map.md:18 — "no-COI bench lane … — user, 2026-09-12" has no user words behind it; the user's recorded intent is the opposite (…). Fix: return the fork to the user (STOP-1a) or re-attribute.
2. ai-agent-no-coi-host.md:21, ai-ide-pi-agent-harness.md:30,70, agent-bench.md:36, evidence :62 — "`node -e/-p` ❌ loud in no-COI" is false: no-coi-project-command.ts:216 `case 'eval'` → executeNode; classifier node-entry-resolve.ts:105-161 maps `-e`/`-p <expr>` (CJS) to eval; only `--input-type=module`, TS, preload, `-p -- <entry>` throw. Fix: mark ⚠️, name the real loud subset.
3. evidence :72 + harness :70 — "`|`, `<` ❌ both hosts" is false: those throws live only in startBackgroundJob (shell.ts:533,539); foreground pipes proven (m0-curious-first-15min.spec.ts:71). Fix: ✅ foreground (COI proven, no-COI ⚠️), ❌ only in background jobs.
4. ai-agent-no-coi-host.md:23-25 vs :29, goal.md:58, evidence :60 — the guard (no-coi-toolchain-worker.ts:283-296) rejects `project-fs` too while residentPort !== null; with a resident alive the agent as mapped has no file or shell tool. Fix: state honestly; raw `sandbox.fs` fallback = agent design choice → Decisions/fog.
5. evidence :69, :61 — git / search built-ins in no-COI marked ✅ but no tests/no-coi spec runs them. Fix: ⚠️ or cite a test.
6. goal.md:60 — "user: … «+chat» only → no vibe" — the recorded answer is «Headless + playground «+chat» (Recommended)»; "only"/no-vibe is the agent's REV-7 cut. Fix: quote verbatim, attribute the cut to the agent.
```

Resolutions: 1 → asked; user: «Да, no-COI lane в v1» → lane `rifty-no-coi` added (goal/map/agent-bench). 2–5 → tables and drafts corrected as stated. 6 → reworded with verbatim quote + agent attribution.

Pass 2 (fresh read-only reviewer, clean context, working tree @ acf594da9; verbatim verdict):

```
final-check: 2026-09-12 — 3 problems
1. map.md:17 — `"vibe" layout; approve gate; chat persistence … — user, 2026-09-12 / carried #111` attributes the vibe cut to the user, contradicting goal.md:61 (agent cut, REV-7); fix: split the line.
2. agent-bench.md:35-37 — "Mock-model smoke must run end-to-end on both lanes" is pre-third-round wording; the suite now has three lanes; fix: name the lanes the smoke covers.
3. harness.md:31, no-coi-host.md:22, evidence:64 — loud subset lists "`-p <file>`", but node-entry-resolve.ts classifies `-p <arg>` as eval (runs; `-p -- <entry>` → printProgram throws); fix: write "`-p -- <entry>`".
```

Pass 2 confirmed problems 1–6 of pass 1 resolved (file:line cited), every `user:` line matched to the verbatim answers, every baseline ✅ cell backed by a test on main, no §Declined/Fidelity conflict, gates green. Advisory: `startBin` enters preview mode, `restart` leaves it (one direction). Resolutions of the 3 wording problems applied as stated (no scope change, no new answer → no third pass).

## Plan validation against a real integrator (user, 2026-09-12)

Source: the user's own session wrap-up «Уточнения к плану AI в Rifty исходя из
текущего проекта» (reference: a Tracker frontend integration on rifty 0.7 with a
sandbox agent — app-level tools `build_plugin`/`save_to_tracker`, an SDK brief in
its system prompt, a `ChatCompletionTransport` abstraction with a same-origin
CSRF transport and a local-model transport, a turn runner that appends history
only after a whole turn). Framing stated by the user: «качественная универсальная
реализация Rifty; текущий проект служит референсом потребностей. Реализация
специально под Tracker не является целью» and «рекомендации по итогам анализа,
а не уже согласованные изменения PR».

Recommendations (condensed, the user's wording kept where decisive):

1. «Расширения интегратора должны быть частью публичного интерфейса» — small
   interface for extra tools, project instructions and available capabilities;
   app actions go through the same loop, history, events and trace; domain
   knowledge stays with the integrator; no `build_plugin`/`save_to_tracker` in
   rifty.
2. «Настройки endpoint не заменяют подключаемый транспорт» — public transport /
   stream-function hook, preferably Pi's own extension; OpenAI-compatible stays
   default; auth and backend specifics belong to the consumer. Open in the file:
   is Pi's seam enough or is a thin adapter needed.
3. «Восстановление после частичной ошибки — критерий качества ядра» — five
   criteria: completed tool calls/results survive a failed next request; after
   Stop the history remains continuable and partial calls have a defined
   outcome; cancellation reaches the active command; Worker replacement
   uncertainty is visible in result and events; continuation never repeats an
   action only because it was lost from history. Not chat persistence.
4. «No-COI: определить полный переход между edit и preview» — sequential model
   fits; fix the owner of edit → build → preview → edit, how the agent learns a
   capability change, prove the full cycle with one e2e; exclude the raw
   `sandbox.fs` fallback from the standard adapter.
5. «Проверки встраивания дополняют benchmark» — deterministic scenarios: fixed
   deps/no registry; custom tool + transport; absent diagnostics/preview → no
   dead tools offered; failed build → fix → build; provider error after a write →
   correct continuation; Stop → next command. Bench caveat: same model + Pi
   version ≠ tool/context equivalence; interpret the delta, never auto-attribute.

Responsibility split recommended (rifty core vs integrator): loop, history,
cancellation, budgets, events, trace, transport/tool seams, declared host
capabilities, generic file/shell/preview tools — vs — UI, SDK instructions,
domain actions, auth/CSRF/backend, permissions/dependency set, artifact
delivery/verification.

Verification in this session (Pi 0.85.1 `.d.ts` from the spike install; Tracker
files read locally):

```
pi-agent-core/dist/agent.d.ts:9   streamFn: StreamFn
pi-agent-core/dist/types.d.ts:13  StreamFn = (model, context, options?) => AssistantMessageEventStream | Promise<…>
pi-agent-core/dist/types.d.ts:292 systemPrompt: string   :298 set tools(tools: AgentTool[])
pi-agent-core/dist/types.d.ts:349 execute(toolCallId, params, signal?, onUpdate?)  :351 replay?: "never" | "safe"
pi-agent-core/dist/agent-loop.js:142-143 tool results pushed into context before the next call; :227-233 stream error → assistant message appended
pi-ai/dist/types.d.ts:62          ProviderRequestOptions.fetch?: FetchFunction
Tracker: executeSandboxTool.ts (build_plugin/save_to_tracker; errors returned as text), chatCompletionStream.ts (ChatCompletionTransport.request), runSandboxAgentTurn.ts (produced returned at turn end), agentEffects.ts (transcript appended after the turn)
tests/integration/no-coi-agent-browser-proof.mjs: failed command → next ✓, Stop → next ✓, overlap → failed ✓; failed vite build → rebuild and a preview round-trip: not covered
```

Answer to recommendation 2's open question: Pi's seam is sufficient — `fetch`
injection covers a same-origin/CSRF transport that still speaks OpenAI chat
completions; `streamFn` covers any other wire shape. No rifty adapter needed.

User confirmation (`AskUserQuestion`, 2026-09-12): items 1–3 → «3. Контракт
восстановления, 2. Подключаемый транспорт, 1. Расширения интегратора»; items 4–5
→ «4. no-COI: хост владеет переходом, 5. Сценарии встраивания + оговорка bench».
All five folded into goal Decisions, map, and the core / no-COI / bench drafts.

Pass 3 (fresh read-only reviewer, clean context, working tree on fe61fa103; verbatim verdict):

```
final-check: 2026-09-12 — 4 problems
1. ai-agent-no-coi-host.md:27,56; goal.md:64,78; map.md:5 — `restart` does NOT leave preview mode: sandbox.ts:561-568 re-runs startBin(residentRequest) whenever a resident was ever started; host.ts:551 sets residentRequest and nothing clears it; SandboxResidentBin has no stop; ADR-0377 D3 "restart the resident request". The promised full-cycle e2e is unreachable on main's public API. Fix: state the fact, record the gap loudly (host-side resident exit = new public API → ADR at pickup) — agent-owned.
2. goal.md:77 "carried by … per-tool replay: never|safe" — Pi 0.85.1 only declares the field (types.d.ts:351) and reports it as telemetry; no loop code consumes it. Fix: "declared by Pi, enforced by rifty's continuation/adapter".
3. ai-ide-pi-agent-harness.md:67-68 still states "subpath only … reconfirmed" while Decisions re-cuts it; map.md:22 "OpenAI-compatible only" reads as excluding the streamFn seam. Fix: wording.
4. goal.md:75 "confirmed «1,2,3,4,5»" in guillemets is not what the user said. Fix: drop the guillemets or quote the labels.
```

Pass 3 verified every new Pi/rifty/Tracker citation, the four answer rounds, §Declined/Fidelity consistency, gates green. Resolutions: 1 → fact stated in goal/map/no-COI child; resident exit recorded as open substrate (fog + child Decisions), ADR at pickup. 2–4 → wording fixed as stated. No scope change and no new answer → no pass 4 (RDY-6: review-record additions and corrections of transcription do not invalidate the check).
