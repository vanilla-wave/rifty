---
kind: epic
status: ready
title: Sandbox agent solves tasks on weak, cheap models — embedder-supplied model catalog with mid-session switching and images, pi-parity compaction and retry, honest turn hygiene, a measured baseline and re-run
created: 2026-09-27
value: A developer pointing the playground or an embedded @riftydev/agent at cheap or weak endpoints (Flash-class API, GPT-6 Luna class, a 32k-context local server) hands the session a catalog of models with their parameters, switches model mid-session when one fails, sends images, and gets a loop that survives context overflow and transient provider failures like the pi CLI, fails edits and repeated calls loudly with locating detail, and a bench that records how each endpoint fares before and after these mechanisms — instead of today's one hardcoded strong-model setting and a saturated bench.
user_story: As a developer connecting my own models to the sandbox agent, I want to give it a list of models with thinking, limits, sampling and compat, switch between them in a session (a 429 on one → offer another), send images, and have the loop survive long tasks and flaky providers, but today one model is built with reasoning off, 8192 output tokens and a 128k window, there is no compaction, retry, switching or image input, edit failures say only "not found", and the bench has only ever run a frontier model.
tier: works
---

## Outcome

`@riftydev/agent` runs pi 0.85.1's loop (ADR-0424) over one `Model` whose
thinking, limits and compat are hardcoded for a fast frontier endpoint, behind
two exclusive transport forms and "no provider catalogue or model-selection
API" (ADR-0436 §2), with no compaction, no retry, text-only prompts, bare edit
failures and a 180 s budget. After this goal the embedder supplies a catalog
of pi-ai `Model` entries with their parameters and transports — the only way
to create a session (user: «хост даст список моделей с параметрами и даст
способ вызывать их»; «Убрать форму, только каталог»); the session selects one,
switches to another mid-session with its history intact («модель сможет
меняться в сессии … 429 отдаёт, предложили пользователю другую»), and accepts
images («возможность передавать картинки»), while other binary files go into
the project for the model to act on with project commands («остальное —
файлом в проект»); it compacts and retries the way the pi CLI does by default (user:
«Для всех, parity с pi»); a failed edit match, a repeated identical call and
the remaining budget are visible to the model in the tool result; Workbench
diagnostics follow every mutation; the prompt profile states the working
recipe; and agent-bench records the same five tasks on a weak endpoint before
the mechanisms land and again after, so the delta is measured, not assumed.
Faithful-runtime payoff: every mechanism is pi's own (`Models` registry,
`ImageContent`, `setModel`, compaction, retry) or an honest diagnostic;
nothing fuzzes, replays or hides a failure (ADR-0424 §6/§7 kept); input pi
0.85.1 cannot carry to a model (non-image binary data) throws
`NotImplementedError` and is listed compat ❌.

## User scenario

1. A developer opens playground Settings (or calls `createAgentSession({
   models, model, … })`) and enters two catalog entries: `gpt-6-luna` through
   a local proxy (1M window, thinking medium) and a 32k-context llama.cpp
   model (thinking off, `maxTokens` 4096, temperature 1.0 / top_p 0.95). Each
   entry states the pi-ai `Model` fields (`input`, `contextWindow`,
   `maxTokens`, `reasoning`, `compat` such as reasoning-effort support and
   reasoning-content replay) and names its transport; the exported trace shows
   the selected model's effective values with keys redacted.
2. They attach a screenshot and a PDF spec and ask for a multi-file change.
   The image reaches the model as pi `ImageContent` because the entry's
   `input` lists `image`; the PDF is written into the project through the
   Workbench project files API and its path is inserted into the prompt — the
   model works on it with project commands (`shell`), while `read_file` of a
   binary file fails loudly as today (`workbench-host.ts:13-16`). Every
   rifty tool result ends with the remaining budget (`callsLeft`, `msLeft`).
   When the retained history grows past `contextWindow − 16384` tokens, the
   session compacts before the next request as pi 0.85.1 does: older messages
   become a summary produced through the selected model's own transport, the
   chat shows a compaction marker, the trace records tokens before/after and
   keeps the full usage total, and the run continues.
3. The proxy answers 429 four times: pi's agent-level retry (3 retries after
   the original attempt, 2 s exponential base) is exhausted, each attempt an
   event in the trace, and the run ends with status `error` naming the
   provider failure. The chat offers the other catalog entry; the developer
   switches to the llama.cpp model and sends "continue": the retained history,
   including prior tool results, continues on the new model.
4. The model calls `edit_file` with a non-unique `old`: nothing is written, the
   result says `2 matches: lines 14, 87 — include more context`; with a string
   absent only by whitespace the result names the closest line as a hint. The
   model repeats the same failing call three times: after the third identical
   result a steering message names the repeated call and result; nothing is
   suppressed, the run continues or ends on budget.
5. On a Workbench host each successful `edit_file` / `write_file` /
   `apply_patch` result appends the host diagnostics for the changed files
   (`1 error: TS2304 src/x.ts:12 …`); on a sandbox host the result says
   `diagnostics: unavailable`.
6. On the 32k model the retained tail plus prompt no longer fit even after
   compaction: the run ends with status `context-exceeded`, never a loop of
   provider errors, and the chat offers the larger entry.
7. They run `pnpm agent-bench run --config luna.json` whose `endpoint` is a
   catalog entry with the same fields. The report header records them; each
   run row adds input/output tokens, retries, compactions, repeated-call
   notices, edit failures, malformed tool calls; `context-exceeded` is its own
   outcome. The recorded summary under `reports/summaries/` names the endpoint
   and model. After the mechanism slices land, the same config and tasks are
   re-run and the report compares both runs per task.

## Invariants

<!-- Each false on main `99fdf6c91` (rebased 2026-09-27); evidence:
     `docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md`
     §False on main (file:line per invariant). -->

1. I1. `createAgentSession({ models, model, … })` is the only session form:
   `models` is an embedder-supplied catalog of pi-ai `Model` entries (id,
   provider, `api`, `baseUrl`, `input`, `contextWindow`, `maxTokens`,
   `reasoning`, `compat`, cost) with per-entry request defaults (thinking
   level, temperature, top_p) and the transport that serves each provider (the
   built-in OpenAI-compatible fetch path or a pi `Provider` / `StreamFn`
   registered for that provider); `model` is the initial selection.
   `contextWindow` and `maxTokens` are stated per entry (pi-ai `Model`
   shape) — no rifty default window; optional fields take the documented
   defaults (§Decisions "entry defaults"). The 0.1.0 `settings` and `streamFn`
   forms are removed (user: «Убрать форму, только каталог»); the other session
   options (host, tools, `instructions`, `contextFiles`, `skills`,
   `initialMessages` per ADR-0466, budgets) are unchanged. The exported trace
   `config` records the selected entry's effective values with any key
   redacted.
2. I2. `session.setModel(id)` selects another catalog entry: the next model
   request uses it — also inside an active run, as pi 0.85.1 applies
   `agent.state.model` at the next `prepareNextTurnWithContext` — the retained
   history is kept and converted for the new provider as pi's `setModel` does,
   and the event stream reports the switch. After a run that ended in `error`
   from an exhausted retry, `send` on the newly selected model continues the
   retained history including prior tool results.
3. I3. `send(prompt, images?)` passes images to a model whose `input` lists
   `image` as pi `ImageContent`; for a text-only entry the call fails before
   any request with an error naming the entry. Non-image binary data is never
   sent to a model: passing it to `send` throws
   `NotImplementedError('agent.prompt-binary-input')` and the agent compat
   list shows ❌; the playground's path for such files is I4. Tool image
   results stay ❌ (`agent.tool-image-result`, `tools.ts:386`).
4. I4. Playground Settings hold the catalog (entries with the I1 fields,
   prefilled as today's values, persisted like Base URL and model today); the
   chat has a model picker and an attach control: an image attaches to the
   prompt (I3), any other file is written into the project through the
   project files API (path shown and inserted into the prompt; agent text
   tools keep rejecting binary content as today); when a run ends in `error`
   from a provider failure — and, once I5 lands, in `context-exceeded` — the
   chat offers switching to another entry and continuing.
5. I5. When the retained history exceeds `contextWindow − reserveTokens` of
   the selected entry (pi 0.85.1 defaults: reserve 16384, keep recent 20000,
   unless configured through the `compaction` option this invariant adds), the
   session compacts before the next model request as pi 0.85.1 does: older
   messages are replaced by a summary generated through the selected entry's
   transport, the summary stays in history, a compaction event with tokens
   before/after is emitted, shown in the playground chat and kept in the
   trace; the run continues; trace usage totals keep the compacted-away
   messages and the summary requests. A request that cannot fit even after
   compaction ends the run with the distinct status `context-exceeded`, never
   a repeated provider error. `compaction: { enabled: false }` disables it like
   pi's `compaction.enabled=false`; the default is on.
6. I6. An assistant response that pi-ai classifies as a retryable error
   (`isRetryableAssistantError`: network error, HTTP 429/5xx, provider-requested
   retry delay) is retried as pi 0.85.1's agent-level retry does — up to
   `retry.maxRetries` 3 retries after the original attempt, delay
   `baseDelayMs` 2000 doubling per attempt, a provider `Retry-After` not
   consulted (pi-ai `provider-retry.js:86` throws before reading it when
   transport retries are 0) — including when the failed response streamed
   partial text, which is discarded as pi does; every attempt is an event in
   history/trace. A response whose tool calls were dispatched is never re-sent
   and no tool executes twice (ADR-0424 §6). Transport-level retries stay 0
   (ADR-0424 §4, amended by a dated §Corrections note admitting the agent-level
   policy). The `retry` option this invariant adds defaults to on;
   `retry: { enabled: false }` disables.
7. I7. An `edit_file` whose `old` string is absent or not unique writes
   nothing and its result names the match count and the line of each match
   (capped), or for zero matches the closest line by whitespace-insensitive
   comparison marked as a hint; host write failures keep ADR-0424 §7 /
   ADR-0426 semantics (applied/unknown effects reported); `apply_patch` keeps
   its existing hunk-level detail (header, position count). Matching stays
   exact — no fuzzy application.
8. I8. The session executes every tool call the model issues (ADR-0424 §6: no
   deduplication). After the third consecutive identical call (same name and
   arguments) whose result body — excluding the budget fields of I9 — equals
   the previous result body, it queues a steering message naming the repeated
   call and result; the message is visible in history, events and trace;
   nothing is suppressed or retried on the model's behalf.
9. I9. Default `runTimeoutMs` is 600 000 (was 180 000); default `maxToolCalls`
   stays 100; the JSON envelope of every rifty-owned tool result carries
   `callsLeft` and `msLeft` for the current run; `budget-exceeded` stays a
   distinct status.
10. I10. On a Workbench host, after a successful `edit_file`, `write_file` or
    `apply_patch`, the tool result appends the host diagnostics summary for the
    changed files (count and first entries, inside the 16 KiB cap), or states
    `diagnostics: pending` when the host has not produced them within the
    bounded wait; on a host without diagnostics the result states
    `diagnostics: unavailable`.
11. I11. The prompt profile gains one workflow paragraph — locate, reproduce or
    inspect, change, re-run or verify, check edge cases — under a new profile
    id, on by default; `recipe: false` removes the paragraph and the trace
    `config` records it; agent-bench contracts assert the default paragraphs
    (ADR-0440 §4 "Preserve profile id/paragraphs", amended by a dated
    §Corrections note; ADR-0434 §3 already carries the 2026-09-18 note).
12. I12. agent-bench `endpoint` accepts a catalog entry with the I1 fields and
    records the effective values in the report header; each run row adds
    input/output tokens, retries, compactions, repeated-call notices, edit
    failures, malformed tool calls; `context-exceeded` is a separate outcome
    like `budget-exceeded`. One recorded run of the existing five tasks on
    `gpt-6-luna` through the user's codex-proxy (user, 2026-09-27) lands under
    `reports/summaries/` with manual failure classes before items 5–11 land
    and before any new task or task re-cut; every column shows each lane's
    actual events — browser lanes have no retry/compaction yet, the native pi
    CLI lane compacts by pi default and has retry disabled by the lane
    (`local-reference.ts:94`), edit and argument failures exist in all lanes.
13. I13. After items 5–11 land, the same config, tasks and run count are re-run
    and recorded; the report compares both runs per task (pass, budget,
    context-exceeded, tokens, seconds, tools); no task has fewer passes than
    the baseline — a regression is a defect fixed before CLOSE or an explicit
    user amendment (`RDY-6`), never a re-cut of this invariant.

## Challenge

challenge: 2026-09-27 — 10 problems (fresh read-only `codex exec` critic; verdict verbatim in the evidence file §Critic)

1. I10-only baseline could hold while quality worsens → I13 (mandatory re-run + no per-task regression).
2. I5 "writes nothing" overpromised apply_patch atomicity → I7 limited to `edit_file` match failures; apply_patch and host write failures keep ADR-0424 §7.
3. Retry ≠ pi 0.85.1 (3 retries after the original; partial text retryable; ADR-0424 §6 forbids action replay, not partial-response retry) → I6 rewritten to pi semantics.
4. Repeat guard vs changing `callsLeft`/`msLeft` → I8 compares result bodies excluding budget fields.
5. Baseline model chosen silently → user question 3: «gpt-6-luna через прокси сейчас» (I12).
6. `streamFn` consumers under "for all" defaults → user question 4 answered with the catalog requirement; user question 6 («Убрать форму, только каталог») removes both legacy forms (I1).
7. «звучит ок» attribution lacked the quoted list → evidence §User answers quotes the agent's list verbatim.
8. False-on-main overstated apply_patch bareness → corrected (I7, evidence).
9. Context-length error is immediate `error`, 1M-file example wrong (16 KiB cap) → scenario 6 and evidence corrected.
10. Compaction vs usage accounting → I5 keeps full totals incl. summary requests.

Final written-result check pass 1 (evidence §Final check): 4 blockers → user question 5 (binary data: images to the model, other files into the project), user question 6 (legacy `streamFn`: removed), I7 limited to match failures, retry/compaction options moved to I5/I6 so I12 records the baseline before them; 4 concerns applied (mid-run `setModel` fact recorded, I10 `pending`, README row, tool-image authority).

Pass 2: 1 blocker → scenario 2 no longer promises `read_file` on a PDF (binary rejected by text tools, `workbench-host.ts:13-16`; the file lands in the project via the project files API, I4); 3 concerns applied (I12 columns show each lane's actual events, native lane compaction on / retry off; §Decisions "defaults" names which mechanisms carry switches; the `context-exceeded` offer and compaction marker UI belong to item 7, I4 says "once I5 lands").

Pass 3: 1 blocker → I11 gains the `recipe: false` switch (answer-1 option text); 2 concerns applied (the Unicode fog now lives in `distribution/ai-agent-context-file-unicode-tags` because `epics/agent-pi-project-resources` landed and closed on main `99fdf6c91`; playground item title no longer names `context-exceeded`). Rebased onto `99fdf6c91`; anchors re-verified (evidence §False on main).

Pass 4: 1 blocker → I6 no longer promises `Retry-After` handling (pi: fixed exponential backoff, transport retries 0); 3 concerns applied (playground draft cites the landed `/reload` under ADR-0440 instead of the deleted sibling item; the Unicode draft distinguishes context-file bodies from skill metadata; the recipe constraint is ADR-0440 §4, not the superseded ADR-0434 §3 clause).

## Decisions

- catalog: 2026-09-27 — user: «хост даст список моделей с параметрами и даст способ вызывать их … Модель сможет меняться в сессии. Например поняли что одна 429 отдает, предложили пользователю другую»; «Убрать форму, только каталог» — the catalog is supplied by the embedder (the application that owns auth and transport, ADR-0424 §3/§4), not by `AgentHost` (files/shell/preview); the playground's Settings is that catalog for the playground (I1, I2, I4); the 0.1.0 `settings` and `streamFn` forms are removed — a breaking 0.x minor with CHANGELOG + ADR. Carrier: pi-ai `Models` registry (`createModels`, `setProvider`, `getModel`, `streamSimple`) and pi's `setModel` semantics; no rifty-invented model schema.
- setModel timing: 2026-09-27 — pi 0.85.1 sets `agent.state.model` in `setModel` (`agent-session.js:1260`) and reads it at `prepareNextTurnWithContext` (`:293-305`), so a switch applies from the next request of the active run; I2 states pi's behavior.
- images: 2026-09-27 — user: «возможность передавать картинки/другие бинарные данные»; «Только картинки в модель; остальное — файлом в проект» — images via pi `ImageContent` on entries whose `input` lists `image` (I3); other binary files are written into the project by the playground and referenced by path in the prompt (I4), because pi-ai 0.85.1 `Model.input` is `("text" | "image")[]` only; passing them to a model throws `NotImplementedError('agent.prompt-binary-input')` + compat ❌ (`AGENTS.md` §Fidelity). Tool image results stay ❌: pi-ai carries them (`openai-completions.js:1093-1103`), the limit is rifty `tools.ts:386`; the user's chosen option keeps them out of this goal.
- defaults: 2026-09-27 — user: «Для всех, parity с pi» — every mechanism defaults to on for every catalog entry the moment its item lands: compaction (reserve 16384 / keep recent 20000, I5), agent-level retry (3 retries, 2 s base, I6), budgets 100 calls / 600 s (I9), recipe paragraph (I11); retry, compaction and the recipe paragraph carry explicit off switches (I5, I6, I11 — answer-1 option text «каждый механизм выключается явной опцией»), budgets are values the consumer sets (I9); item 1 ships the catalog only, so the I12 baseline is recorded before them.
- entry defaults: 2026-09-27 — `contextWindow` and `maxTokens` are required per entry (pi-ai `Model`; pi's `models.json` requires them for custom models) — no rifty default window (final-check blocker 2); `reasoning` false, `input: ['text']`, thinking off, `compat` empty when omitted; `temperature`/`top_p` unset are not sent (provider default; item 1 probe). The playground form prefills 128 000 / 8192 (today's values) for a new entry.
- sampling: 2026-09-27 — no per-model default table inside the agent (Simplicity, `REV-7`); DeepSeek's agentic recommendation (temp 1.0 / top_p 0.95) is consumer guidance in the evidence file, set per entry through I1.
- completion gate: 2026-09-27 — user: «давай пока без этого …» — not built; Out of scope until I13 data (map).
- first baseline endpoint: 2026-09-27 — user: «gpt-6-luna через прокси сейчас» — I12 names it; the proxy needs `--codex-version` ≥ 0.155.1; the Flash-class lane model stays deferred («Модели потом дообсудим»); candidates: evidence §Model candidates.
- bench lane order: 2026-09-27 — item 4 records the baseline right after item 1 and before items 5–11 land; item 12 re-runs after them (I13); no new tasks in this goal.
- compaction reference: pi 0.85.1 — `pi-agent-core` compaction (`prepareCompaction` / `compactWithRequest` / `shouldCompact`, `DEFAULT_COMPACTION_SETTINGS`) and pi CLI trigger semantics (upstream pi doc `compaction.md`: check after tool results, compact inside the run — `agent-session.js:293-297` `_compactBeforeNextAssistantResponse`); summary through the selected entry's transport; carrier (AgentHarness adoption vs `Agent.transformContext` + entry adapter) is item 7 fog.
- retry semantics: 2026-09-27 — pi 0.85.1 agent-level retry as implemented in the CLI (`agent-session.js` `_isRetryableError` → pi-ai `isRetryableAssistantError`; `_prepareRetry`: attempt ≤ `maxRetries`, fixed delay `baseDelayMs · 2^(attempt−1)`, `auto_retry_*` events; a provider `Retry-After` is never read because pi-ai `provider-retry.js:86` throws before its delay logic when transport retries are 0 — final-check pass 4); pi CLI `retry.provider.maxRetries 0` is the transport default we keep; ADR-0424 §4 gets a dated §Corrections note (`DEC-2`) at item 6 PICKUP naming the declined "automatic retry during no-COI recovery" (ADR-0376/0377, host command recovery) as a different seam.
- repeated-call guard: 2026-09-27 — threshold 3 consecutive identical calls with identical result bodies (budget fields excluded); steering via pi's steering queue (`steeringMode` one-at-a-time); execution never blocked (ADR-0424 §6).
- budget carrier: 2026-09-27 — remaining budget travels in the tool-result JSON envelope (`callsLeft`, `msLeft`), not in the system prompt: a per-turn prompt change would invalidate the cached prefix every turn.
- verification feed: 2026-09-27 — Workbench `capabilities.diagnostics` only; sandbox hosts have none (ADR-0426) and say so (I10); a bounded wait ends in `diagnostics: pending`, never a silent omission; no new diagnostics source.
- prompt recipe: 2026-09-27 — one paragraph in `prompt-profile.ts`, profile id bumped, `recipe: false` switch (answer 1); the active constraint is ADR-0440 §4 "Preserve profile id/paragraphs" (ADR-0434 decision 3's prompt clause is already superseded by its 2026-09-18 §Corrections note) — ADR-0440 receives a dated §Corrections note at item 11 PICKUP (`DEC-2`).
- re-run criterion: 2026-09-27 — I13 "no task with fewer passes" is the goal's own acceptance target (`RDY-2` 2: a value measurable only after implementation); three cold runs per task as today; noise is reported, not averaged away.
- tier: works — compaction and retry are pi-parity mechanisms with their own honest outcomes (fault rows on items 6/7 per `AGENTS.md` §DoD); other reachable faults loud-throw; the agent holds no persistence, so no crash/reload invariant.
- public API and ADRs: 2026-09-27 — the catalog as the only session form, `setModel`, `send(prompt, images)`, the mechanism options and the `context-exceeded` status are a cross-package public API change (`DEC-1` 1) → one ADR at item 1 PICKUP (`pnpm adr:new distribution`) superseding ADR-0436 §2 (two exclusive forms, "no provider catalogue or model-selection API") and §3 (unknown-model state for custom transport) — `DEC-2`: dated §Corrections note in 0436 pointing at the successor; §1, §4–6 stay; later items cite the new ADR.
- rejected route: fuzzy matching in `edit_file`/`apply_patch` — violates ADR-0424 §7 and I7.
- rejected route: completion self-check gate — user 2026-09-27 (answer 2); violates §Decisions "completion gate".
- rejected route: opt-in defaults for retry/compaction/budgets/recipe — user 2026-09-27 (answer 1); violates §Decisions "defaults".
- rejected route: keeping `settings` / `streamFn` as one-entry catalogs or a descriptor-less transport with a default 128k window — user 2026-09-27 (answer 6); violates I1 and §Decisions "entry defaults" (no honest window value).
- rejected route: non-image binary data as model input — violates §Decisions "images" (no pi-ai 0.85.1 carrier); user 2026-09-27 (answer 5) chose files into the project (I4).
- rejected route: a rifty-owned model schema or provider abstraction above pi-ai `Models` — violates §Decisions "catalog" carrier and ADR-0424 §4 ("no provider SDK or domain-action abstraction above these native seams").
- rejected route: catalog on `AgentHost.capabilities()` — violates §Decisions "catalog" (auth/transport are the embedder's, ADR-0424 §3/§4; hosts know files/shell/preview).
- rejected route: shipping retry/compaction options with item 1 — violates I12 (baseline before the mechanisms) — final-check blocker 4.
- rejected route: subagents, parallel tool execution, tool merging, edit-commit checkpointing, planning/todo tools before the re-run — violates Outcome clause "measured, not assumed" and I13; `distribution/ai-agent-subagent-orchestration` stays draft.
- rejected route: rule-based pruning stage before the LLM summary (arXiv 2609.20804) — deviates from pi 0.85.1 compaction (Outcome "as the pi CLI does"); revisit only with I13 data (map fog).
- rejected route: remaining budget in the system prompt — violates §Decisions "budget carrier" (cache prefix).
- rejected route: transport-level automatic retries (`pi-ai` `maxRetries`) — violates I6 last clause and ADR-0424 §4.
- rejected route: stricter-than-pi retry (never after partial text) — violates §Decisions "defaults" (pi parity) and I6; critic finding 3.
- cross-goal reconciliation: 2026-09-27 — user (three-goal review with
  `epics/no-coi-agent-host-kit`, PR #357, and
  `epics/agent-code-quality-evaluation`, PR #341): «1 - a» the catalog +
  `setModel` is the only model-selection mechanism for every consumer, the
  kit included — its per-turn `settings` item is removed and its reference
  host creates the session from a one-entry catalog; the item-1 ADR is the
  only supersession of ADR-0436 §2/§3. «2 - a» the kit's text-only
  message-content mode is a per-entry flag of this catalog
  (`distribution/agent-text-only-content-transport`, after item 1), so `send`
  with images to a flagged entry fails before any request like a text-only
  `input` entry (I3); no session-level toggle. «3 - a» the 600 s default (I9)
  stands; the kit's measure-first question narrows to the 16 KiB cap. «5 -
  ок» three cold runs stay; a ±1-pass delta on 3 runs is marked as within
  noise in the comparison table — I13's regression rule still applies (fix or
  explicit user amendment). «6 - ок» the kit's transcript reducer
  (`distribution/agent-transcript-model`) lands before items 3 and 7, whose
  chat UI halves (picker, attach, switch offer, compaction marker) extend it.
- shared bench order: 2026-09-27 — agent (user: «сделай так, чтобы разработка
  была проще») — `tools/agent-bench` is shared with PR #341 and PR #357:
  item 1 (catalog endpoint, lanes migrated) and item 4 (per-run metric
  columns, `context-exceeded`, recorded baseline) land before the quality
  goal's runner/report restructuring (`distribution/agent-eval-local-runner`),
  which then carries them; item 12 ships the smallest `report --compare` over
  two summary directories of one config and the quality goal's report owner
  (`distribution/agent-eval-comparison-report`) absorbs it — no second
  comparison design; the kit's no-COI lane swap
  (`distribution/no-coi-agent-reference-host`) follows item 1's lane
  migration. Cross-branch order is recorded in text, not `blocked_by` (the
  backlog checker resolves links within one tree).
