# Rerun: GPT-6 Luna

42/42 PASS after I5–I11; baseline40/42. No task/lane loses a pass.
Clean measured source `61605476e1217b328c8989e895c4320c6b25624a`;
Node24.16.0 / Pi0.85.1 / Chromium148.0.7778.96. Same
[config](../../../configs/gpt-6-luna.json), five tasks, judges and three cold
runs per supported task/lane as the [baseline](../2026-09-27-gpt-6-luna-baseline/README.md).
Config/tasks/judges have no diff against baseline source0fab1a861.

| Lane | Pass before → after | Median agent seconds | Tools | Input tokens | Output tokens | Edit failures |
|---|---:|---:|---:|---:|---:|---:|
| COI playground |15/15 →15/15|30.420|167|516873|19426|8|
| Packed no-COI SDK |11/12 →12/12|27.017|125|412206|18097|8|
| Native Pi CLI |14/15 →15/15|26.422|127|362811|12772|0|

No budget/context failures, retries, compactions, repeated-call notices or
malformed calls. Sixteen failed edit attempts recovered before task completion.
No failed runs to classify; all original classes/notes remain null.

[Comparison](comparison.md) shows every task/lane's before/after/delta, including
all token/time/tool/failure counters. Gains: URL filters/no-COI2→3 and Node
endpoint/native2→3; each +1/3 is within noise. These samples do not establish
causality or isolate environment effects. Retry/compaction behavior is proven by
the separate native differential/fault tests, not exercised by this easy matrix.
No source/build edits during measurement, task/judge changes, interrupted runs
or selected replacement measurements.

## Artifacts

- [Original report](original-report.json.gz), [report](report.json.gz), [summary](summary.md),
  [machine comparison](comparison.json.gz): all42 original outcomes, exact source/config.
- `source-artifacts.json.gz`: all42 full `{id,trace,before,after}` records,
  including provider requests and dependency locks. Every JSON value roundtripped
  against the original files; bundle SHA256
  `6fab272bd4ba98758f6ff41e27acd997485f8d81cdd9c1c84fd59228fb9fcd8a`.
- [Manifest](manifest.json.gz):210 original artifact sizes/hashes, config hash and
  one screenshot per lane. Original Playwright ZIPs remain local at
  `/private/tmp/rifty-pr359-luna-rerun`; hashes identify them. The gzip bundle
  is JSON, not a Playwright ZIP.

Reproduce with the benchmark CLI and same config in a new output directory;
`report <current-dir> --compare <baseline-dir>` regenerates comparison and exits0
here. No-COI Node endpoint remains the pre-existing unsupported pair.
