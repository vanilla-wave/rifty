# ADR 0191: agent-bench: external two-lane validation harness over the playground

Status: Active
Date: 2026-07

> TL;DR: agent quality on rifty is measured by an external harness in
> `tools/agent-bench/` driving the real playground UI through Playwright; the only
> product-side surface is observation hooks behind `?agentBench=1` under the single
> namespace `globalThis.__riftyAgentBench`; a `local-reference` lane (Pi CLI, real
> Node/fs, same model + prompts) isolates the environment variable.

## Context

Epic `ai-mode-mvp`: "where does rifty lose coding-agent quality vs a real local
environment" needs a measured, classified answer, not anecdote. The measurement must
not change what it measures: if the bench grants the agent extra capabilities or
lives inside product packages, the numbers stop describing what a human user gets.
And a rifty-only pass rate cannot separate "model can't code" from "rifty
environment loses quality" — that split is the whole point (it gates M12 product
IDE investment).

## Decision

- **Location**: `tools/agent-bench/` — a workspace tool, never product API, never
  imported by `packages/*`/`apps/*`. Runner drives a real browser via Playwright
  (own config; NOT part of the CI e2e lanes — it costs real model tokens and its
  pass rate is a diagnostic, not a regression gate).
- **Two adapters, one suite**: lane `rifty` = playground + built-in AI mode through
  the same chat a human uses; lane `local-reference` = temp dir, `npm i`, local
  Vite, Pi CLI (`@earendil-works/pi-coding-agent`, pinned to the same Pi version,
  same model, same prompt profile — ADR-0190). The delta between lanes isolates
  environment/tooling; same-loop-both-sides removes harness/prompt noise.
- **Harness-facing hooks only**: playground changes for the bench are
  judge/setup-facing (`seed` — pre-run file overlay, `exportTrace`, session/task
  metadata), gated by `?agentBench=1`, live under the single namespace
  `globalThis.__riftyAgentBench`, and are each marked
  `// agent-bench hook: external validation harness only. Not public API.`
  The prompt itself is typed into the real chat UI by the runner — prompt
  delivery is part of the measured surface. Bench mode grants the agent
  nothing — same runtime, same tools, same prompts as a human session.
- **Tasks are user-shaped**: `tasks/<slug>/prompt.md` is exactly what a user would
  type into chat (no tool docs); `seed/` overlays the react-vite preset; `judge.ts`
  asserts via Playwright APIs (preview DOM/HTTP, git diff, terminal) — no judge DSL
  at 5-task scale. The agent never sees `seed/` provenance or `judge.ts`.
- **Diagnostic-first report**: per run — pass/fail, elapsed/turns/tool calls,
  terminal tail, final diff, preview probes, failure class
  (`agent / rifty-runtime / rifty-tooling / ai-mode-ux / provider / task-bad`,
  human-assigned in v1 — auto-classification would be overconfident) + note;
  per task — rifty vs local-reference delta; header — model, prompt profile,
  task-set version, endpoint, limits. Budget overrun (`budget-exceeded`) is a
  distinct outcome, never conflated with fail.
- **Reset = cold start only**: fresh browser context + re-seed per run; no in-place
  reset path to maintain (and silently drift).

## Consequences

- The bench measures the product as shipped; any hook creep beyond
  `__riftyAgentBench` observation is an architecture violation, greppable by
  namespace and marker comment.
- Failure classes give M12 the environment-vs-model split before product-IDE
  investment; the local-reference lane doubles as the ceiling estimate.
- Costs: a second Pi surface to pin (CLI), a bench that runs only on demand (never
  green-gates PRs), and human classification effort per run in v1.
- Report JSONs land in `tools/agent-bench/reports/` (gitignored except committed
  summaries) — traces contain model output; no secrets (config snapshot excludes
  the key).
