---
area: distribution
status: ready
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

## Reference contract

- Native pi-ai/pi CLI 0.85.1; model transport I1/I2 certified at c5bb64273,
  catalog UI I3/I4 at c288a9cc9. Native ModelRuntime probe preserved in
  reference/ai-agent-weak-model-baseline-evidence.md. ADR-0434/0471/0472.

## Acceptance

1. Config endpoint carries native Model fields and request defaults with explicit
   context/output limits; all three lanes send those parameters and report the
   effective entry without credentials. → I12 + I1
2. Every run records observed input/output tokens, retries, compactions,
   repeated-call notices, edit failures and malformed calls; native compaction
   summary usage is included. Context overflow is a separate outcome while raw
   agent status stays honest. → I12
3. Existing five tasks, three cold runs per supported lane (42 total) run on
   gpt-6-luna through the user's proxy, before I5–I11. Summary/source artifacts
   and manual failure classes are committed under reports/summaries. → I12
4. Existing smoke/judge controls remain; no task/prompt/judge re-cut. Native
   CLI retains default compaction and disabled agent retry in this baseline. → I12 + ADR-0434

## Fault matrix

| axis × operation | honest outcome | carrier | trace |
|---|---|---|---|
| missing catalog limit × config | loud validation, no guessed window | catalog-metrics.test.ts | → I12 + I1 |
| edit/argument failure × metrics | real error counters, no action change | catalog-metrics.test.ts real Agent/MemoryVfs | → I12 |
| provider context error × report | context-exceeded, original error status retained | catalog-metrics.test.ts and CLI contract | → I12 |
| provider failure × run | original artifacts/manual failure classification | existing contract.spec.ts | → I12 + ADR-0434 |
| corrupt-input/provenance-lie × credential serialization | valid JSON numbers and protocol tags; headers/payload strings private; metrics derived before masking | redaction.test.ts, real browser/native header contract | → I1 + I12 + ADR-0472 |

## Out of scope

No new tasks, task tuning, runtime mechanisms or automatic quality attribution.
Unsupported node-endpoint/no-COI stays explicitly excluded (ADR-0434).

## Decisions

- re-cut: 2026-09-27 — observed credential-redaction defect in benchmark and Agent trace repaired in this unit; unchanged I1/I12 obligations, baseline runtime kept isolated — trace: none

- Inherits goal decisions (first baseline endpoint, bench lane order, tier). The re-run is slice 12 (`distribution/ai-agent-weak-model-rerun`).

- 2026-09-27 — RDY-8: private config/report measurement tooling over already-certified I1/I4 behavior; reuse those reviews, execute config/metrics RED and real smoke, then independent Final+GREEN. No new runtime promise or copied loop.
- 2026-09-27 — ADR-0472 pins native pi overflow classification and metadata/privacy carriers; protocol parameters verified through public ModelRuntime before implementation.
- 2026-09-27 — proxy launcher ignores CLI flags: a temporary copy sets handler codexVersion 0.155.1 on port 10539; model list includes gpt-6-luna and direct request returned OK. Original launcher unchanged.
- 2026-09-27 — RDY-8 observed-defect route: raw header collision reproducer + RED, repair, independent Final+GREEN; no new continuation behavior.
