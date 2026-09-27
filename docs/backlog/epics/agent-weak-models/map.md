# Map — agent-weak-models

Live plan: index, not store. Frontier = open children with `epic:` backlinks.
Goals run whole and in sequence: this goal → `epics/no-coi-agent-host-kit`
(PR #357) → `epics/agent-code-quality-evaluation` (PR #341); no cross-goal
item ordering (goal §Decisions "shared bench order").

## Items

5. `distribution/ai-agent-tool-feedback` — **tool feedback** — budgets,
   precise edit failures, native repetition steering, host mutation diagnostics
   and shared recipe (I7–I11). DEC-2 native end-event seam proven; ADR0475.
12. `distribution/ai-agent-weak-model-rerun` — **re-run** — same config,
    tasks and runs as item 4 after tool feedback lands; per-task comparison in the
    report — the smallest `report --compare` over two summary directories,
    absorbed later by `distribution/agent-eval-comparison-report` (PR #341);
    a ±1-pass delta on 3 runs is marked as within noise; no per-task pass
    regression (I13). Last.

## Open questions

- I5/I6 and remaining I4 reviewed b353ed8b0: Agent plus native utilities;
  audit receipts supply faithful compaction input (ADR0474). No remaining carrier question.
- Native request defaults resolved: streamSimple sends min(Model.maxTokens,
  native available-context ceiling); absent temperature/top_p are omitted. Native
  reasoning_content replay verified through the proxy. Evidence: catalog unit.
- Luna endpoint verified: temporary proxy on 10539, codexVersion 0.155.1;
  gpt-6-luna listed and real request returned OK. I12 recorded: 40/42 pass, two agent failures; source/artifacts frozen before mechanisms.
- Playground carrier resolved: file picker; native images to prompt, other
  bytes under /attachments with unique names and ProjectFiles CAS; advanced
  native catalog JSON plus simple entry controls. I3/I4 reviewed c288a9cc9.
- Rule-based pruning stage before the LLM summary — owner: agent — only if
  the I13 re-run shows overflow/VERIFY failures the pi compaction does not
  remove.

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
