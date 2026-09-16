---
area: distribution
status: draft
title: Load the project's AGENTS.md/CLAUDE.md context files into the agent prompt as pi's project_context block, with reload and opt-out
created: 2026-09-16
why: The sandbox agent ignores project instructions regular pi loads; this slice owns the resource loader, pi custom-prompt order, reload and the loaded-resources report.
user_story: As a developer with an AGENTS.md in my repo, I want the playground/embedded agent to follow it like pi does, but today only a consumer-passed `instructions` array reaches the prompt and the playground passes none.
epic: agent-pi-project-resources
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-pi-project-resources-refine-evidence.md]
code: [packages/agent/src/prompt.ts, packages/agent/src/session.ts, packages/agent/src/types.ts]
---

## Context

finding — goal slice 1 (I1, I3, I4 session half, I5 instructions half, I6, I7).

- Oracle (evidence file §Probe): pi 0.85.1 `loadProjectContextFiles` picks the
  first of `AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD`
  per directory, global file first, then root-most ancestor → cwd; the prompt
  wraps them as `<project_context>` / `<project_instructions path="…">`. The
  custom-prompt branch orders: custom prompt → append → project context →
  skills → `Current working directory`. Resources are read once per loader
  `reload()`, never per turn.
- Ours: `packages/agent/src/prompt.ts:31-34` ends with cwd, date, then
  `instructions`; `session.ts:76-90` refreshes capabilities/tools before every
  turn; no resource loader, no `reload()` on `AgentSession`. The host has one
  root (`types.ts:48`) = cwd → the walk-up yields the root's file only;
  descendants never load (goal `## Decisions` "cwd").
- Order after this slice (I3): profile (incl. date) → `instructions` →
  `<project_context>` → skills → `Current working directory` last — the tail
  order changes for every consumer; profile paragraphs untouched.
- Carrier notes for PICKUP: the walk-up is CLI-only code (node fs) → semantic
  copy in `@riftydev/agent` under an ADR + differential suite vs the CLI on
  a fixture tree; new public options (`contextFiles`, user-level instruction
  slot) and `reload()` + a loaded-resources event ride the same ADR. Null case
  first: a tree without context files keeps today's prompt text.
- Unsupported kinds (`.pi/extensions`, `.pi/prompts`, `.pi/SYSTEM.md`,
  `.pi/APPEND_SYSTEM.md`, `.pi/settings.json`) present → reported by name in
  the loaded-resources report; compat ❌ in the agent README (I7).
- Preview-only host (no file access): prompt states resources were not read
  (I6); how `reload()` behaves after a later mode switch is agent fog on the
  goal map.

## Challenge

Premise checked at goal level (`epics/agent-pi-project-resources/goal.md` §Challenge, 2026-09-16); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (scope, trust, prompt, refresh, user-level, tier, reference). Carrier questions live on the goal map §Open questions.
