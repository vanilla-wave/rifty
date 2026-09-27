---
area: distribution
status: ready
title: Give native tool calls honest budgets, edit hints, repetition feedback and diagnostics, with a shared workflow recipe
created: 2026-09-28
why: Weak models need actionable tool outcomes and a visible remaining budget without changing exact execution semantics.
user_story: As a developer using a weak model, I want precise failed-edit hints, remaining budgets, visible repetition feedback and post-mutation diagnostics so the model can correct its work and verify it.
epic: agent-weak-models
sources: [docs/backlog/epics/agent-weak-models/goal.md, docs/adr/distribution/0424-headless-pi-agent-over-public-project-hosts.md, docs/adr/distribution/0440-load-pi-project-resources-through-rooted-agent-hosts.md]
code: [packages/agent/src/tools.ts, packages/agent/src/session.ts, packages/agent/src/prompt-profile.ts, packages/agent/src/workbench-host.ts]
---

## Context

Combines accepted I7–I11 after frozen I12 and reviewed I5/I6. Native Agent still
owns validation, execution and steering; existing hosts own writes/diagnostics.
DEC-2 real Pi/MemoryVfs probe establishes awaited tool_execution_end as the
shared receipt boundary, including native validation/missing-tool errors.

## Acceptance

1. Default timeout600000/calls100. Every Rifty-owned final tool result has a
   complete JSON envelope carrying callsLeft/msLeft for the current send;
   positive overrides and budget-exceeded remain. Admission keeps existing
   valid-call semantics; invalid/missing calls do not invent execution. → I9
2. Receipts cover success, host throw, validation/missing tool, admission
   exhaustion and skipped cancellation. Total UTF-8≤16KiB; JSON heading intact;
   unknown/applied effects retained. Consumer plain text unchanged; only a
   closed existing envelope grammar corroborated by details receives fields.
   → I9, ADR-0424 §6/7
3. Budget heading capacity is reserved before capping body; changing numeric
   widths cannot change the retained body. Model-facing counters are actual
   remaining values; every send resets budgets. → I8, I9
4. Exact edit failure lists all overlapping match count and first10 line
   positions; zero matches supplies a labelled whitespace-insensitive closest
   line hint (empty file explicitly has none). Nothing written; diagnostic
   computed inside the same host transform. Empty old remains invalid;
   apply_patch validation and partial-write provenance unchanged. → I7
5. Third consecutive same tool name + canonical JSON args + equal capped result
   body/metadata queues native steer naming the call/result and emits a visible
   repeated-call event. Exclude only top-level envelope budget fields; nested
   payload fields remain significant. All calls execute; fourth same call gets
   no extra notice. Changed signature/reset clears sequence; sends/model switches
   do not. → I8, ADR-0424 §6
6. Successful write/edit/patch appends changed-file diagnostics: count and
   bounded entries from existing Workbench host. No host→unavailable; bounded
   wait exceeded→pending; rejection→explicit diagnostic failure with successful
   mutation retained. Deleted paths explicit unavailable/deleted. Standalone
   diagnostics tool remains. → I10
7. Diagnostics use one bounded wait across changed paths; late completion cannot
   mutate an already returned result or become unhandled rejection. Stop still
   waits for admitted mutation settlement; no new cache/epoch/source. → I10, ADR-0424
8. One common workflow paragraph (locate, reproduce/inspect, change, rerun/verify,
   edge cases), new profile id, on by default. recipe:false removes only that
   paragraph; config.recipe records effective boolean. Existing paragraphs and
   resource ordering retained; native bench shares the default text. No task or
   model variants and no completion gate. → I11, ADR-0440 §4
9. Public chat defaults reflect600s; real Workbench mutation diagnostics and
   native steering/receipts reach the next actual model request. Existing image,
   model-switch, recovery, host policy and effect behavior remain. → I4, I7–I11

Envelope convention: shell heading has status (exited/cancelled/failed), exitCode
and optional worker/effects/error, with matching details; preview heading has only
statusCode matching details. Unknown keys or mismatched details mean consumer
text. Extra budget fields are assigned by this session, never trusted from input.
Diagnostics wait: one1000ms deadline across all changed files; at most10 entries,
inside the existing overall cap. No new public timing knob.

## Parity cases

- Real native Agent + MemoryVfs: end-event decoration reaches native history and
  next wire for valid/invalid/missing calls; steer after third does not skip fourth.
  → I8, I9
- Same real Workbench diagnostic source through standalone diagnostics and new
  mutation receipt; TypeScript error then repair. → I10
- Same default recipe paragraphs in Rifty and actual native CLI benchmark;
  caller opt-out omits only recipe. → I11

## Fault matrix

| Boundary / axis | Injection | Observable result | Authority |
|---|---|---|---|
| Native tool settlement / provenance-lie | Invalid/missing/blocked/cancelled calls | Budget receipt without invented execution; effects unchanged | → I9, ADR-0424 |
| Result formatting / lossy-aggregate | Long Unicode, long metadata, budget width changes | Complete bounded JSON, stable capped body, honest truncation | → I8, I9 |
| Exact edit / concurrent-same-key | Same host transform sees changed content | Counts/hints describe that read; no fuzzy write | → I7 |
| Tool sequence / sibling-drift | Same logical args reordered; changed nested budget-named value | Canonical args compare; only actual envelope budgets excluded | → I8 |
| Host diagnostics / unbounded-read | Delayed or never-settled external response | One deadline; pending, no late mutation/rejection | → I10 |
| Host diagnostics / false-fallback | Missing service, rejection, deleted patch path | Explicit unavailable/failure; completed write stays successful | → I10 |

## Challenge

challenge: 2026-09-28 — accepted goal; independent DEC-2 carrier probe, no scope fork.

## Decisions

ready-verdict: 2026-09-28 — Contract+RED @ a56659d4c — `reference/ai-agent-tool-feedback-contract-red.json`

- re-cut: 2026-09-28 — combine five feedback drafts, preserve I7–I11 — trace: none
- ADR0475 will record native receipt seam, consumer-envelope convention and narrow
  ADR0440 profile correction; I6-dependent fixture repair remains linked evidence.

## Out of scope

Fuzzy edits, tool suppression/replay, automatic fallback, new diagnostics source,
completion gate, subagents/planning tools, task/judge changes. I13 remains next.
