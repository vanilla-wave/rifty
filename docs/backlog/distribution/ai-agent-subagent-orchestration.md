---
area: distribution
status: draft
title: M12 — subagent / task orchestration over the embeddable Pi loop
created: 2026-06-13
why: the one genuine opencode-richer feature that survives the browser ceiling — agents dispatching focused sub-tasks with isolated context
user_story: As a dev embedding the rifty AI-IDE, I want my agent to dispatch a focused sub-task via a `task` tool running a nested `runAgentLoop` with its own fresh `InMemorySessionRepo`/tool-subset and `Promise.all` parallelism, but today no such AgentTool exists — no context isolation, depth/cost caps, or `onUpdate` nested progress.
sources: [M12, ADR-0190]
---

## Context

A `task` tool = a tool that runs a NESTED `runAgentLoop` with a fresh
`InMemorySessionRepo` (its own context window) + a tool subset + a sub-prompt, returning
its final message to the parent. Pure loop-level recursion — no spawn — so it works in
the browser, unlike opencode's process-spawning subagents. Parent context compaction is
already in Pi core.

## Options or Next

- `task` AgentTool over the M12 harness loop; context isolation via a fresh repo.
- Parallel dispatch (`Promise.all`); OPTIONAL Worker isolation per subagent via the kernel.
- Depth + step + cost caps (runaway guard); cascade the parent `AbortSignal`.
- Surface nested progress to the UI via the loop's `onUpdate` hooks.

## Reversibility

REVERSIBLE — built on the harness's own public loop; adds no rifty surface. Folds under
the harness ADR.
