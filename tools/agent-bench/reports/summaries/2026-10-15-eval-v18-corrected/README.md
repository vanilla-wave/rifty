# eval-v18 — current qualified reference (text core, ADR-0532)

Fresh clean source `cf7a842a4`, 8 tasks × 4 lanes × 3 trials = 96; producer exit 0,
8177 s. 64 PASS / 32 FAIL. Model: gpt-6-luna through codex-proxy for Rifty COI,
Rifty no-COI and native Pi; native Codex with its own default model/context/tools.
[Summary](summary.md) lists every attempt; `report.json.gz` is the untouched
producer report (only `failureClass`/`note` added); `statistics.json.gz` the
derived uncertainty. Binary attachments (Playwright traces, workspace archives,
screenshots stream, frozen input bundle) are not retained in git; artifact paths
in the report describe the run directory, not this repository.

| Lane | PASS/24 | Setup failures |
|---|---:|---:|
| Rifty COI | 10 | 2 |
| Rifty no-COI | 14 | 0 |
| Native Pi | 19 | 0 |
| Native Codex | 21 | 0 |

| Task | COI | no-COI | native Pi | Codex | Rifty failures |
|---|---:|---:|---:|---:|---|
| ms-negative | 3 | 3 | 3 | 3 | — |
| ms-weeks | 0 | 1 | 3 | 3 | agent: formatting regression reproduces on Node; asymmetry vs native Pi unexplained |
| stringify-boxed | 2 | 3 | 3 | 3 | 1 COI import-toast setup timeout |
| queue-clear | 0 | 0 | 3 | 3 | 4 rifty-runtime: AsyncLocalStorage after `await`; 1 unisolated (Node fails too); 1 import-toast setup timeout |
| csv-workflow-v5 | 2 | 3 | 3 | 2 | 1 unisolated; Codex: CLI 503 reconnect, app judge PASS |
| markdown-notes-v4 | 3 | 2 | 3 | 3 | 1 agent TypeError |
| booking-workflow-v11 | 0 | 0 | 0 | 3 | oracle-qualified: judged by the retired record-observation engine (ADR-0535), not reproducible from this tree; recorded class agent (Luna): public Validation/date-time regex defects in all Pi lanes |
| expense-settlement-v11 | 0 | 2 | 1 | 1 | oracle-qualified (ADR-0535); COI: Svelte HMR blank preview ×3 (unisolated); task-bad ×4 across native lanes |

Failure classes: none 64, agent 15, rifty-runtime 4, ai-mode-ux 2, native-tooling 1,
task-bad 4, unisolated 6.

## What it says about Rifty

- `AsyncLocalStorage` context is lost across `await`: 6/6 queue-clear attempts fail
  in Rifty — 4 where the exact after-source passes on Node (rifty-runtime), 1 mixed
  (Node fails too, unisolated), 1 import-toast setup timeout —
  `docs/backlog/runtime-js/async-local-storage-await-context.md`.
- Svelte starter preview goes blank under HMR in COI (3/3 expense attempts, roots
  unisolated) — `docs/backlog/service-worker/svelte-css-preview-network-url.md`.
- Workspace-import success toast missing after 90 s before the agent starts (2 setup
  failures) — `docs/backlog/playground/workspace-import-success-observation-timeout.md`.
- npm-client rejected SHA-1 lock integrity and `npm:` aliases (24/96 setup failures in
  the confounded eval-v16); repaired with real-npm parity in this delivery (ADR-0526/0527).
- Expense/booking judges rejected working UIs (decorative glyphs, styled checkbox);
  the record-observation engine behind them was retired instead of repaired
  (ADR-0535). The notes judge's native `confirm()` dismissal stays
  `docs/backlog/distribution/native-confirmation-observation.md`; the native Codex
  CLI 503 status `docs/backlog/distribution/native-codex-recovered-error-status.md`.

## Limits

The record-observation judge engine behind booking/expense was removed after this
recording (ADR-0535); those rows are oracle-qualified and cannot be re-run from this
tree. `judge/context.ts` was trimmed to the helpers the surviving cases use and the
judge fingerprint covers the import closure, so a new plan is not
fingerprint-comparable with this report (`report --compare` flags judge drift by
design). Compare new runs against each other, not against v18.

Models, contexts, tools and installed graphs differ between lanes; no causal
model-quality or runtime-only delta is claimed. Proxy prices are 0, not spend.
Native Codex malformed-call telemetry is unknown. No retries, rescoring, prompt
tuning or pruning after the series started.

## History

Pilot v1–v4 and eval v1–v17 (2026-10-05 → 2026-10-14) were each stopped or
superseded on judge false-negatives, npm-client setup failures, a codex-proxy
parallel tool-call argument loss, or host faults; eval-v16 original 43/96 was
confounded, corrected v16 51/96, v17 57/96. Their archives, manifests and case
versions are not retained in git (ADR-0532/0535); `corpus/core-v1.json` carries the six
cases of this run whose judges stand, with unchanged bytes.
