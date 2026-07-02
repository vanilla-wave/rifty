---
kind: epic
status: in-progress
title: AI mode MVP — diagnostic quality bench for rifty as an AI coding environment
created: 2026-07-02
value: measured, classified answer to "where does rifty lose coding-agent quality vs a real local environment" — plus a hands-on AI mode anyone can try
user_story: As the rifty maintainer, I want a built-in AI mode over the playground plus an external bench running the same tasks in rifty and in a local reference environment, but today agent quality on rifty is anecdote — no agent, no realistic React preset, no harness, no measurement
items: [distribution/ai-mode-playground, distribution/agent-bench-harness]
---

## Outcome

A diagnostic stand, not a leaderboard. Three deliverables: (1) full AI mode in the
playground — chat over the real project/terminal/preview, usable by hand today;
(2) a realistic React+Vite preset — the main vibecoding scenario; (3) an external
bench that runs one task suite through two lanes — `rifty` (built-in AI mode) and
`local-reference` (local Pi, same model+prompts, real fs/Node) — and reports the
delta with a failure class per run: `agent / rifty-runtime / rifty-tooling /
ai-mode-ux / provider / task-bad`. If local Pi passes where rifty fails, the gap is
environment/tooling — exactly the signal M12 needs before building the product IDE.

## User scenario

Manual: open playground → pick react-vite preset → enable AI mode → type "add
search by title and keep filters in the URL" → agent edits files, runs shell,
checks preview → user watches diff/preview, exports the session trace.

Bench: runner opens playground `?agentBench=1`, seeds a task, sends the prompt into
the chat, waits for done (final message w/o tool calls) or budget-exceeded, judges
via preview DOM/HTTP/diff, 3 runs per task per lane → report: pass rate, rifty vs
local-reference delta, failure class + evidence per run.

## Items

- `distribution/ai-mode-playground` — the agent: chat + vibe views, Pi loop, tools, trace.
- ~~react-vite preset~~ — the arena: DELIVERED 2026-07-02 (`react-vite` preset +
  `tests/e2e/react-vite-preset.spec.ts`; unblocked by ADR-0192 esbuild-wasm; known
  preview-model gap recorded: `service-worker/preview-entry-subpath-loss`).
- `distribution/agent-bench-harness` — the measurement: runner, tasks, judge, report.

## Decisions (grilled 2026-07-02; ratified: ADR-0190 — Pi loop + AI-outside-runtime, ADR-0191 — bench design)

- MVP = measurement stand; product IDE (ai-ide-product-ui) comes after the numbers.
- Built on the existing playground, not a side lab; preview mandatory.
- Harness lives OUTSIDE rifty (`tools/agent-bench`); playground changes allowed but
  bench-only, marked, single namespace `__riftyAgentBench`, gated by `?agentBench=1`.
- Bench mode grants the agent nothing extra — observation hooks only; same runtime
  human hands touch.
- One task suite, two environment adapters; seeds portable (same source runs in
  local Vite unchanged).
- Report is diagnostic-first; score second; human failure-note allowed in v1
  (auto-classification would be overconfident).
- Suite: 4 React client tasks + 1 Node control (Hono/Express).
- Reset = cold start only (fresh browser context + re-seed); no in-place reset.
- 3 runs/task/lane, result = pass rate; limits (max tool calls, run timeout, tool
  timeout) in config; exceeding = `budget-exceeded`, distinct from fail.
- Prompt-baseline research for other agents (Codex/Claude Code style) deliberately
  deferred — remembered, not an item yet.
