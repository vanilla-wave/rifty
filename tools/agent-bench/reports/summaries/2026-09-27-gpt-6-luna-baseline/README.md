# Baseline: GPT-6 Luna

42 cold runs, original five tasks, three runs per supported lane. Measured on
clean `0fab1a861b1f9bf7112d908b439ef1d1654825f3`, before I5–I11 mechanisms.
Node24.16.0 / Pi0.85.1 / Chromium148.0.7778.96.
[Exact config](../../../configs/gpt-6-luna.json): 1M context, output8192,
medium thinking, 40 tools/600s; local codex-proxy10539, handler version0.155.1.
Declared token costs0 for this subscription proxy; no external pricing inferred.

| Lane | Pass | Median agent seconds | Tools | Input tokens | Output tokens | Edit failures |
|---|---:|---:|---:|---:|---:|---:|
| COI playground |15/15|31.552|150|461746|14937|6|
| Packed no-COI SDK |11/12|33.784|119|356742|14699|7|
| Native Pi CLI |14/15|28.110|129|315188|13989|0|

40/42 pass. No budget/context/provider failures; retries, compactions,
repetition notices and malformed-call counters all0. Native compaction was
enabled by Pi default, retry disabled; browser mechanisms were absent.
The13 edit failures were rejected `apply_patch` format attempts, followed by
recovery. No task/judge changes or replacement measurements.

## Two agent failures

- `url-filters/rifty-no-coi/3`: model removed the `useState` import but kept
  calls. Browser captured `ReferenceError: useState is not defined`; judge
  could not reach Issues. `vite build` passed because it did not typecheck.
- `node-endpoint/local-reference/2`: only ls/read executed, before/after files
  identical. Final response claimed `/api/stats` implemented; both actual
  initial/post-write HTTP probes returned404.

[Captured failure evidence](failure-evidence.json.gz) includes the original page
error and native assistant messages. [Original measurements](original-report.json.gz)
are preserved; [annotated report](report.json.gz) adds only manual classes/notes.
[Summary](summary.md) retains every run and per-task/lane counts. I13 compares
the unchanged config/tasks/count against this baseline, including both failures.

## Interpretation and artifacts

Shared policy does not make native/browser tool protocols or context equivalent.
These small samples do not isolate an environment-only effect. Startup/judge time
is outside the reported agent duration; actual locks and provider prompts remain.
No-COI node-endpoint stays unsupported, yielding42 rather than45 runs.

- `source-artifacts.json.gz`: all42 `{id,trace,before,after}` records, including
  dependency locks. Compression roundtrip and every original JSON value verified.
- `manifest.json.gz`: original artifact sizes/SHA256, config hash and committed
  screenshot locations. Original Playwright ZIPs remain local at
  `/private/tmp/rifty-pr359-luna-baseline`; failed URL run has captured pageError,
  no post-judge screenshot because the judge threw.
- `measurement-replay.json.gz`: all10 reported metrics for all42 runs match the
  repaired observer, with exact observer source hashes. Measurement had no auth
  headers; later privacy repairs do not change this baseline's values.

Rerun via the [benchmark CLI](../../../README.md), in a new output directory.
Use the same checked-in config and a working user proxy; preserve this series.
