---
area: distribution
status: draft
title: Raise the default run timeout to 600 s and report the remaining call/time budget in every rifty tool-result envelope
created: 2026-09-27
why: The 180 s default was tuned for a fast frontier model without thinking (a weak model with thinking hits it and ends budget-exceeded instead of finishing), and the model never learns how much budget is left.
user_story: As a developer running the agent on a slow, cheap model, I want the run to have room to finish and the model to see its remaining budget so it stops exploring in time, but today the timeout is 180 s and tool results carry only status/exit/error.
epic: agent-weak-models
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/tools.ts]
---

## Context

finding — goal slice 5 (I9); after slice 4 (baseline first).

- Ours: `session.ts:52-53` defaults `maxToolCalls ?? 100`, `runTimeoutMs ??
  180_000`; `tools.ts:21` `modelResultText` prefixes rifty-owned results with a
  JSON envelope (status/exit/error/worker/effects) and nothing about the
  budget; `budget-exceeded` is a distinct `AgentStatus` (`types.ts:141`).
- Evidence: the 2026-09-13 run (gpt-5.6-sol, no thinking) took 27–312 s per
  task with a 541 s outlier; 9 of 42 runs exceeded 180 s; max 33 tool calls.
  Weak models with thinking are slower per turn (evidence §Research).
- After this slice: `runTimeoutMs` default 600 000, `maxToolCalls` default
  100 unchanged; every rifty-owned tool envelope carries `callsLeft` and
  `msLeft` for the current `send`; consumer tools are wrapped by `wrapTool`
  (`tools.ts:380`) and receive the same envelope fields only if they already
  use the rifty envelope — otherwise unchanged (their text is theirs).
- Carrier (goal §Decisions "budget carrier"): the envelope, never the system
  prompt — a per-turn prompt change would break the cached prefix.
- Bench: limits stay explicit in bench config (40 / 600 s today); the default
  change affects consumers and the playground constant.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (defaults, budget carrier, tier).
