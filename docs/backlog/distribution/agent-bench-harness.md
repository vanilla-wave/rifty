---
area: distribution
status: ready
title: agent-bench — external validation harness, two lanes, diagnostic report
created: 2026-07-02
why: without measurement the AI mode is anecdote; the bench must separate "rifty environment loses quality" from "model can't code"
user_story: As the rifty maintainer, I want to run one task suite through built-in AI mode AND a local Pi reference and get per-run failure classes, but today there is no runner, no tasks, no judge, no report
epic: ai-mode-mvp
blocked_by: [distribution/ai-mode-playground]
sources: [ADR-0191, docs/backlog/epics/ai-mode-mvp.md, tests/e2e/helpers/playground.ts]
code: [playwright.config.ts, apps/playground/src/glue/preset-deep-link.ts]
---

## Context

Design ratified in ADR-0191: harness in `tools/agent-bench/` (workspace tool,
never product API), two adapters over one suite, observation/seed hooks only
under `globalThis.__riftyAgentBench` gated by `?agentBench=1`, diagnostic-first
report with human failure classification in v1. Repo wiring is mostly free:
`tools/*` already covered by pnpm-workspace, vitest globs, biome, `check:arch`,
backlog SCAN_ROOTS; only Playwright's `testDir` excludes it (deliberate — the
bench has its own config and never runs in CI e2e lanes).

## Acceptance

- `tools/agent-bench/` package with CLI (`tsx` entry, root script
  `agent-bench`): `pnpm agent-bench -- --lane rifty|local-reference|both
  [--task <slug>] [--runs N] [--config <path>]`.
- Config file: endpoint `baseUrl`/`model` (+ key from env at runtime, never
  stored), limits (`maxToolCalls`, `runTimeoutMs`, `toolTimeoutMs`), runs per
  task (default 3; `--runs 1` fast mode), playground port
  (`RIFTY_PLAYGROUND_PORT` respected).
- Task layout `tasks/<slug>/`: `prompt.md` (exactly what a user types, no tool
  docs), `seed/` (files overlaid on the preset), `judge.ts` (single
  implementation, Playwright APIs, runs against BOTH lanes via a lane-agnostic
  context: preview page/baseUrl, workspace file reads, git diff, terminal tail).
- Lane `rifty`: fresh browser context per run → `?preset=react-vite&agentBench=1`
  (Node control task: its preset) → seed via `__riftyAgentBench.seed` (pre-run
  hook) → type the prompt into the real chat UI (no prompt-injection hook) →
  wait done / budget-exceeded → collect `__riftyAgentBench.exportTrace()` →
  judge.
- Lane `local-reference`: fresh temp dir per run → copy the same preset source +
  same `seed/` overlay → real `npm i` + local Vite dev server →
  `@earendil-works/pi-coding-agent` CLI (pinned to the Pi version of ADR-0190,
  isolated via `PI_CODING_AGENT_DIR`, same model, prompt profile
  `pi-baseline+rifty-adapter-v1`'s baseline equivalent) with the same prompt →
  judge the same way; session JSONL kept as the lane's trace.
- Suite v1 (5 tasks, pinned as `task-set-v1`): `add-search` (search issues by
  title on /issues), `url-filters` (persist list filters in the URL),
  `fix-date-sort` (fix the planted dashboard sort bug), `new-issue-form`
  (create-issue form with validation), `node-endpoint` (Node control over the
  Hono preset: add a JSON stats endpoint).
- Report per invocation under `reports/<run-id>/`: `report.json` — header
  (model, prompt profile, task-set version, endpoint, limits, lane versions) +
  per run: pass/fail/budget-exceeded, elapsed, turns, tool calls, terminal
  tail, final diff, preview probe results, `failureClass: null` +
  `note: null` for human fill-in (classes: `agent / rifty-runtime /
  rifty-tooling / ai-mode-ux / provider / task-bad`); per task: pass rates and
  rifty vs local-reference delta. `agent-bench report <dir>` regenerates the
  human-readable summary (md) after classification.
- Harness self-checks that need no model, runnable in CI-less local runs:
  unit tests for config parsing, report aggregation, seed-overlay equality
  across lanes; plus a mock-model smoke run (`--mock-model`, reusing the
  ai-mode e2e mock endpoint) proving the rifty-lane plumbing end-to-end.
- Playground side: `?agentBench=1` parsing + `__riftyAgentBench`
  (`seed`, `exportTrace`, session/task metadata) — every hook marked
  `// agent-bench hook: external validation harness only. Not public API.`
  Nothing else in the product changes.

## Parity cases

Lane equivalence invariants (each an automated harness test — this is what makes
the delta meaningful):

- The prompt delivered to the model is byte-identical across lanes (rifty chat
  input vs Pi CLI input) for every task.
- Seed overlay produces an identical project file tree (modulo
  `node_modules`/lockfile) in both lanes.
- One `judge.ts` per task executes unmodified against both lanes' contexts.
- Pi version, model id, and limits recorded in the report header match between
  lanes for a `both` invocation.

## Out of scope

- CI integration — on-demand only; the bench never gates PRs (costs real model
  tokens; its output is a diagnostic, not a regression signal).
- Auto-classification of failures — v1 classification is human;
  `failureClass` stays null until a human fills it.
- In-place workspace reset — cold start only; anything else throws
  `NotImplementedError('agent-bench.reset')` if reached.
- Multi-model matrix per invocation — one model per run; compare by running
  twice.
- Firefox/WebKit lanes; non-Chromium is off-mission.
- Leaderboard/scoring beyond per-task pass rate + delta.

## Decisions

- Architecture (location, two lanes, hooks contract, report shape, cold-start
  reset): ADR-0191.
- Runner drives the chat via the real UI (Playwright typing) — prompt delivery
  itself is part of the measured surface (`ai-mode-ux` class exists for a
  reason); only seeding and trace export use hooks.
- `judge.ts` executes in the harness process against a `JudgeContext`
  abstraction (`previewUrl`, `page`, `readFile`, `gitDiff`, `terminalTail`) —
  the lane adapters implement it; no DSL.
- Node control task runs over the existing `hono-api` preset (its local lane =
  same source under real Node) — no new preset needed.
- Reports dir gitignored except `reports/README.md`; traces contain model
  output and are for local analysis; committed artifacts are human-authored
  summaries only.
- Playwright stays a root devDependency (already present); agent-bench reuses
  it with its own config file inside `tools/agent-bench/` and never touches
  `testDir` of the root config.
