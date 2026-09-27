---
area: distribution
status: draft
title: Resolve OpenAI-compatible settings before each model turn when the consumer supplies them as a function (supersedes ADR-0436 D2 for this form)
created: 2026-09-27
why: AgentSessionOptions.settings is fixed for the session lifetime, so a user switching models between turns forces the host onto a full Pi streamFn and a direct @earendil-works/pi-ai dependency pinned in lockstep
epic: no-coi-agent-host-kit
sources: [ADR-0424, ADR-0436, docs/process/rules/decisions.md, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts]
---

## Context

Finding. `createAgentSession` reads `settings` once (`packages/agent/src/
session.ts:22-46`) and builds one `Model<'openai-completions'>`; the default
`streamFn` closes over it (`:93-102`). ADR-0436 D2: "No second callback,
provider catalogue or model-selection API"; its §Alternatives deferred a model
picker as "not required for the headless edit/build flow". The user decided
2026-09-27 (goal Decisions, «B - ок») that the kit requires per-turn
resolution.

Goal obligation: I5 — `settings` supplied as a function is resolved before
each model turn, session history is kept, trace `config` reflects the actual
endpoint/model per turn.

## Out of scope

- A provider catalogue, model list or rifty-specific transport abstraction (ADR-0436 §Alternatives).
- Changing the custom `streamFn` form.

## Decisions

- `DEC-2` partial overturn: this unit's PR runs the decision subagent and
  lands a short superseding ADR naming ADR-0436 D2 (the "no second callback /
  model-selection API" clause, this form only) plus a dated §Corrections note
  on ADR-0436 pointing at it; the rest of ADR-0436 stays active.
- rejected route: a new session per model turn — loses the Pi-owned history
  (ADR-0424 D2); violates I5.
