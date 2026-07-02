---
area: distribution
status: draft
title: agent-bench — external validation harness, two lanes, diagnostic report
created: 2026-07-02
why: without measurement the AI mode is anecdote; the bench must separate "rifty environment loses quality" from "model can't code"
user_story: As the rifty maintainer, I want to run one task suite through built-in AI mode AND a local Pi reference and get per-run failure classes, but today there is no runner, no tasks, no judge, no report
epic: ai-mode-mvp
blocked_by: [distribution/ai-mode-playground, playground/react-vite-preset]
sources: [docs/backlog/epics/ai-mode-mvp.md, tests/e2e/helpers/playground.ts]
code: [playwright.config.ts]
---

## Context

Lives in `tools/agent-bench/` — outside `packages/*`, never product API. Grilled
decisions, all resolved:

- **Layout**: `runner/` (Playwright driver, both lanes), `tasks/<slug>/`
  (`prompt.md` — exactly what a user would type into chat, no tool docs; `seed/` —
  files over the react-vite preset; `judge.ts` — Playwright-API checks: preview
  DOM/HTTP, git diff, terminal; no DSL — 5 tasks don't pay for one), `reports/`
  (JSON traces + summary).
- **Two adapters, one suite**: `rifty` (playground + built-in AI mode via chat) and
  `local-reference` (temp dir, `npm i`, local Vite, local Pi agent — same model,
  same prompts, pinned version — the ceiling; delta isolates environment, not
  harness/prompt noise). Agent never sees `seed/`/`judge.ts`.
- **Hooks**: judge-facing only, behind `?agentBench=1`, single namespace
  `globalThis.__riftyAgentBench` (`exportTrace`, session/task metadata), each marked
  `// agent-bench hook: external validation harness only. Not public API.` Agent
  gains nothing in bench mode — same runtime a human uses.
- **Reset**: cold start only — fresh browser context + re-seed per run.
- **Runs**: 3 per task per lane, result = pass rate (0/3..3/3); 1-run fast mode for
  harness debugging. Suite v1: 4 React tasks + 1 Node control (Hono/Express).
- **Limits**: max tool calls + run wall-clock + per-tool timeout, all in config,
  recorded in report; exceeding = `budget-exceeded`, never conflated with fail.
- **Report**: diagnostic-first — per run: pass/fail, elapsed/turns/tool calls,
  terminal tail, final diff, preview probes, failure class (`agent /
  rifty-runtime / rifty-tooling / ai-mode-ux / provider / task-bad`) + optional
  human note (v1 classification is human); per task: rifty vs local-reference
  delta; header: model, prompt profile, task-set version, endpoint, limits.
