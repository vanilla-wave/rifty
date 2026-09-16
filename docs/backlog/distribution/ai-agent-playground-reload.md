---
area: distribution
status: draft
title: Add /reload to the playground AI chat that re-reads project resources and shows what loaded
created: 2026-09-16
why: The goal fixes pi's once-per-session read cadence; without a visible reload the playground editor's own AGENTS.md edits would never apply and nothing shows which resources the agent saw.
user_story: As a developer editing AGENTS.md in the playground mid-session, I want `/reload` to apply it and list loaded files, skills and diagnostics like pi's `/reload`, but today the chat has no commands and no resource visibility.
epic: agent-pi-project-resources
blocked_by: [distribution/ai-agent-project-context-files]
sources: [docs/backlog/distribution/reference/agent-pi-project-resources-refine-evidence.md]
code: [apps/playground/src/ai/AiChatPanel.tsx]
---

## Context

finding — goal slice 3 (I4 UI half, I7 visibility).

- Oracle: pi TUI `/reload` re-runs the resource loader and prints a summary of
  reloaded resources (CHANGELOG 0.50.0, evidence file §Inventory).
- Ours: `apps/playground/src/ai/AiChatPanel.tsx` sends every input as a
  prompt; no command parsing; the session it creates passes no instructions.
- Carrier notes for PICKUP: `/reload` calls `session.reload()` and renders the
  loaded-resources report from slice 1 (files, skills, diagnostics, unsupported
  kinds); e2e proof on the playground with a fixture project (`tests/e2e/ai-mode.spec.ts` lane).

## Challenge

Premise checked at goal level (`epics/agent-pi-project-resources/goal.md` §Challenge, 2026-09-16); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions. Blocked by slice 1 (report shape); independent of slice 2.
