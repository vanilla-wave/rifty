---
area: distribution
status: draft
title: After the third consecutive identical tool call with an identical result body, queue a visible steering message naming the repetition — execute every call, suppress nothing
created: 2026-09-27
why: Weak models repeat a failing call verbatim until the budget ends; the loop is invisible to the model and costs the whole run, while ADR-0424 §6 forbids deduplicating the model's deliberate requests.
user_story: As a developer running the agent on a weak model, I want a repeated identical call to be named to the model so it changes course, but today the loop runs silently to `budget-exceeded`.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-budget-visibility]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0424-headless-pi-agent-over-public-project-hosts.md]
code: [packages/agent/src/session.ts, packages/agent/src/tools.ts]
---

## Context

finding — goal slice 9 (I8); after slice 5 (budget fields exist and are
excluded from the comparison — critic finding 4).

- Ours: `session.ts:145` `beforeToolCall` counts calls for the budget only;
  no repetition detection; ADR-0424 §6: "the model's deliberate new request is
  not deduplicated by ID".
- Evidence (§Research): oh-my-pi / opencode loops with DeepSeek Flash on the
  same failing edit; idle-loop is a named failure class.
- After this slice: every call executes as before; after the third
  consecutive identical call (same tool name and serialized arguments) whose
  result body equals the previous result body — the envelope's `callsLeft` /
  `msLeft` (I9) excluded — the session queues a steering message through pi's
  steering queue (`steeringMode` one-at-a-time) naming the repeated call and
  result; the message is in history, events and trace; nothing is suppressed,
  retried or deduplicated. A legitimately repeated command (re-run tests after
  an edit) does not trigger: an intervening different call or a different
  result body resets the count.
- Carrier notes for PICKUP: compare on the capped result text minus the budget
  fields (`modelResultText`, `tools.ts:21`); the bench counts these notices
  per run (slice 4 column).

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (repeated-call guard, tier).
