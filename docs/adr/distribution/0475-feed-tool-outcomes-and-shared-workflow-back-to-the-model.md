# ADR 0475: Feed tool outcomes and shared workflow back to the model

Status: Accepted
Date: 2026-09

> TL;DR: Native tool settlement carries budgets/repetition; mutation tools add host diagnostics; one shared recipe guides work.

## Context

Accepted agent-weak-models I7–I11 follow the frozen I12 baseline. Independent
DEC-2 Pi0.85.1/MemoryVfs probe proves before/afterToolCall omit invalid/missing
calls, whereas awaited tool_execution_end covers them and reaches history/wire.

## Decision

- Keep native dispatch and steering. Decorate owned results at tool_execution_end;
  decorate synthetic skipped results before publishing them. Preserve valid-call
  admission semantics and effects. No dispatcher, replay map, cache or epoch.
- Default timeout600000/calls100; complete bounded JSON receipt with callsLeft/
  msLeft. Reserve maximum budget-heading width before body capping. Consumer plain
  text stays untouched; recognize existing envelopes only by closed shell/preview
  metadata grammar corroborated by details, never arbitrary JSON-looking text.
- Compare last name/canonical args/capped result excluding only top-level envelope
  budgets. At third equal call queue native steer and emit repeated-call; execute
  all calls. Sequence spans sends/model switches; changed result/args or reset clears it.
- Exact edit diagnostics use the same host transform: overlapping count/first10
  lines, whitespace-insensitive hint for absent old text. No fuzzy application.
- Successful mutation tools know actual changed paths; append existing host
  diagnostics with one bounded wait. Missing/deleted unavailable, delayed pending,
  rejected explicit diagnostic failure; mutation success retained. No late result edits.
- Profile v2 adds one common workflow paragraph; recipe:false omits only it.
  config.recipe records effective boolean. Existing paragraphs/resource ordering
  remain; native benchmark uses identical default recipe. No completion gate.

This supersedes only ADR0440 §4's “Preserve profile id/paragraphs” clause.
ADR0424 §6/7 execution, settlement, effects, exact matching and16KiB cap remain.

## Consequences

One native settlement seam handles all result paths; real Workbench tests own
positive diagnostics proof. No public envelope marker/classifier API. Native hooks
alone are insufficient; a replacement dispatcher is unnecessary. I13 measures the
net effect using unchanged tasks/judges/config.
