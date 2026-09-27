---
area: distribution
status: draft
title: Run the existing agent-bench tasks on gpt-6-luna through the codex proxy with a catalog entry and per-run failure metrics, and record that baseline before the mechanism slices
created: 2026-09-27
why: The only recorded bench run is gpt-5.6-sol at 42/42 — it distinguishes environments, not harness mechanisms — and that model is no longer served; every later mechanism of the goal needs a weak-endpoint baseline to beat.
user_story: As the maintainer measuring the agent on cheap models, I want `pnpm agent-bench run --config luna.json` to carry the catalog entry's thinking/limits/compat and report tokens, retries, compactions and edit failures per run, but today the config knows only baseUrl/model/envKey and rows show elapsed and tool counts.
epic: agent-weak-models
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/README.md]
code: [tools/agent-bench/src/config.ts, tools/agent-bench/src/report.ts, tools/agent-bench/src/runner.ts, tools/agent-bench/src/lanes/local-reference.ts]
---

## Context

finding — goal slice 4 (I12); after slice 1, before slices 5–11 (goal
§Decisions "bench lane order") and before the quality goal's
`distribution/agent-eval-local-runner` (PR #341) restructures
runner/config/report, so that restructuring carries the catalog endpoint and
these columns (goal §Decisions "shared bench order").

- Ours: `tools/agent-bench/src/config.ts:3-7,46` `endpoint = {baseUrl, model,
  envKey}`; `report.ts:14,25,69` per-run outcome / agentStatus / elapsedMs /
  toolCalls / failureClass / note (+ usage); no retries, compactions,
  repeated-call, edit-failure or malformed-call columns; no
  `context-exceeded` outcome. Only summary: `2026-09-13-gpt-5.6-sol`.
- Endpoint (user, 2026-09-27: «gpt-6-luna через прокси сейчас»): the Codex
  subscription serves `gpt-6-luna` / `gpt-6-sol` / `gpt-6-astra` / `gpt-5.5`
  since 2026-09-25; the user's `codex-proxy.mjs` announces `CLIENT_VERSION
  0.111.0` and needs `--codex-version` ≥ 0.155.1 for GPT-6 models (evidence
  §endpoint); the run starts by booting the proxy and reading its printed
  model list. The Flash-class model is deferred by the user.
- Native lane (`local-reference`, pi CLI 0.85.1) receives the same entry
  through its `models.json`/settings so the three lanes stay comparable
  (ADR-0434 §3 shared policy); thinking level, limits and compat are recorded
  in the report header.
- Metrics come from the agent trace (events for retry attempts, compactions,
  repeated-call notices, tool failures, pi `validateToolArguments` errors) and
  from pi CLI session entries in the native lane; the report shows them as
  columns; `context-exceeded` is a separate outcome like `budget-exceeded`.
  Every column shows the lane's actual events: browser lanes have no
  retry/compaction yet (0), the native pi CLI lane compacts by pi default and
  has retry disabled by the lane (`local-reference.ts:94` writes
  `retry.enabled false`), edit and argument failures exist in all lanes —
  recording that before the mechanisms is the point.
- Same five tasks, three cold runs per lane; manual failure classes as today;
  no new task, no judge change (`PR-4`: a judge change would need the old/new
  criterion comparison).
- Carrier notes for PICKUP: smoke lanes precede real runs (ADR-0434 §5); the
  recorded summary goes under `reports/summaries/<date>-gpt-6-luna/` with the
  same artifact set as the 2026-09-13 run; keyless proxy run keeps the
  Playwright traces as before.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (first baseline endpoint, bench lane order, tier). The re-run is slice 12 (`distribution/ai-agent-weak-model-rerun`).
