# Map — agent-weak-models

Live plan: index, not store. Frontier = open children with `epic:` backlinks.
Goals run whole and in sequence: this goal → `epics/no-coi-agent-host-kit`
(PR #357) → `epics/agent-code-quality-evaluation` (PR #341); no cross-goal
item ordering (goal §Decisions "shared bench order").

## Items

3. `distribution/ai-agent-playground-model-catalog` — **playground** —
   Native send(prompt, images), Settings catalog editor, chat model picker, attach control (image → prompt,
   other file → project via the project files API + path in prompt), switch
   offer after provider `error` (I3/I4). Catalog I1/I2 landed; former image item absorbed here. The `context-exceeded` offer
   and the compaction marker are item 7's UI half; the kit's transcript
   reducer (`distribution/agent-transcript-model`, PR #357) lands after this
   goal and covers these chat events.
4. `distribution/ai-agent-weak-model-baseline-lane` — **baseline** — bench
   `endpoint` as a catalog entry, report header + per-run metric columns,
   `context-exceeded` outcome, one recorded `gpt-6-luna` run of the existing
   tasks (I12). After 1; before 5–11 (§Decisions "bench lane order") and before
   the quality goal's `distribution/agent-eval-local-runner` (PR #341)
   restructures runner/config/report (§Decisions "shared bench order").
5. `distribution/ai-agent-budget-visibility` — **budgets** — defaults 100 /
   600 s, `callsLeft`/`msLeft` in every rifty tool envelope (I9). After 4.
6. `distribution/ai-agent-transient-request-retry` — **retry** — `retry`
   option (default on), pi 0.85.1 agent-level retry over the selected entry's
   transport, visible attempts, ADR-0424 §4 correction (I6). After 4.
7. `distribution/ai-agent-context-compaction` — **compaction** — `compaction`
   option (default on), pi 0.85.1 compaction over the retained history, trace
   tokens and full usage totals, `context-exceeded`, plus the playground chat
   marker and the `context-exceeded` switch offer (I5, I4 second half). After
   4; fault matrix.
8. `distribution/ai-agent-edit-failure-diagnostics` — **edit-diagnostics** —
   locating failure text for `edit_file` match failures, exact matching kept,
   apply_patch and host-write semantics unchanged (I7). After 4.
9. `distribution/ai-agent-repeated-call-guard` — **repeat-guard** — third
   identical call + identical result body → visible steering message (I8).
   After 5 (budget fields excluded from the comparison).
10. `distribution/ai-agent-verification-feed` — **verification** — Workbench
    diagnostics appended to mutation results, `diagnostics: pending` on a
    bounded wait, `diagnostics: unavailable` elsewhere (I10). After 4.
11. `distribution/ai-agent-prompt-recipe` — **recipe** — workflow paragraph,
    profile id bump, `recipe:false` switch, ADR-0440 §4 note (I11). After 4.
12. `distribution/ai-agent-weak-model-rerun` — **re-run** — same config,
    tasks and runs as item 4 after items 5–11 land; per-task comparison in the
    report — the smallest `report --compare` over two summary directories,
    absorbed later by `distribution/agent-eval-comparison-report` (PR #341);
    a ±1-pass delta on 3 runs is marked as within noise; no per-task pass
    regression (I13). Last.

## Open questions

- Compaction/retry carrier resolved by independent DEC-2 probe: retain Agent
  and public retryAssistantCall/prepareCompaction/compact; native Harness needs
  a new event/history/lane adapter. Implementation/proof remains after I12.
- Native request defaults resolved: streamSimple sends min(Model.maxTokens,
  native available-context ceiling); absent temperature/top_p are omitted. Native
  reasoning_content replay verified through the proxy. Evidence: catalog unit.
- Luna endpoint verified: temporary proxy on 10539, codexVersion 0.155.1;
  gpt-6-luna listed and real request returned OK. I12 measurement remains open.
- Playground attach: image sources (file picker, paste, preview screenshot)
  and the project folder for non-image files — owner: agent — item 3 carrier;
  pi accepts `ImageContent` only.
- Rule-based pruning stage before the LLM summary — owner: agent — only if
  the I13 re-run shows overflow/VERIFY failures the pi compaction does not
  remove.
- Playground Settings layout for catalog entries (advanced section, per-field
  validation) — owner: agent — item 3 carrier.

## Out of scope

- Completion self-check gate before ending a run — user, 2026-09-27
  («давай пока без этого»); revisit only with I13 data.
- Subagents (`distribution/ai-agent-subagent-orchestration` stays draft),
  parallel tool execution, tool merging, edit-commit checkpointing,
  planning/todo tools — no evidence independent of a bench; revisit after I13.
- Non-image binary data as model input — no pi-ai 0.85.1 carrier
  (`Model.input: ("text" | "image")[]`); `NotImplementedError` + compat ❌
  (I3); such files go into the project (I4, user answer 5).
- Tool image results to the model — rifty `tools.ts:386`
  `NotImplementedError('agent.tool-image-result')` (README compat ❌); pi-ai
  carries them (`openai-completions.js:1093-1103`), but the user's chosen
  option (answer 5) keeps them out of this goal.
- Automatic model fallback (the agent switching models on its own) — the
  scenario is "offer the user another" (user words); the embedder/UI offers,
  the user chooses (I2, I4).
- Fuzzy matching or line-number edits — ADR-0424 §7; rejected route in
  `goal.md`.
- Transport-level automatic retries and any action replay — ADR-0424 §4/§6.
- Per-model default tables (sampling, limits) inside the agent — rejected
  route "sampling".
- New bench tasks or a difficulty re-cut of the existing five — separate
  work after I13; this goal measures the existing set.
- Model selection for the Flash-class lane — user decision later («Модели
  потом дообсудим»); candidates recorded in the evidence file.
- Unicode-tag sanitization of project context files — captured as the
  question draft `distribution/ai-agent-context-file-unicode-tags` (the
  resources goal landed and closed on main `99fdf6c91`); user fork at its
  pickup.
- A per-turn `settings` function as a second model-selection mechanism —
  user 2026-09-27 («1 - a», three-goal review); the kit's item is removed,
  every consumer uses the catalog + `setModel`.
- The text-only message-content flag itself — the kit's
  `distribution/agent-text-only-content-transport` (PR #357), a per-entry
  flag of this catalog after item 1 (user «2 - a»).
