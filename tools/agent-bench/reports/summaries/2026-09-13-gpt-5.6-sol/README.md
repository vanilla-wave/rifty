# Live diagnostic: gpt-5.6-sol

42 real model runs; three cold runs per supported task/lane. Original source
25391197516ee5ce9bc5c9b7afdc0b5a997f8ad3, clean. Node24.16.0, Pi0.85.1,
Chromium148.0.7778.96. No-auth codex-proxy at localhost10530/v1;
profile pi-0.85.1+rifty-adapter-v1,40 tools/600s per run.

| Lane | Original judge | Audited artifacts | Median agent seconds | Tools |
|---|---:|---:|---:|---:|
| COI playground +chat |14/15|15/15|62.216|298|
| Packed no-COI SDK |12/12|12/12|82.907|184|
| Native Pi CLI |12/15|15/15|62.920|222|

No budget/provider failures. Original model time/tool counts remain unchanged.
Four original failures were `task-bad`: repaired judges rechecked the retained
programs, with no source repair or additional model run. Every other artifact
keeps its original judgment. [Original report](original-report.json),
[annotated report](report.json), [per-task deltas](summary.md), [rechecks](rechecks.json).

## Four rechecks

- Native new-issue-form1–3: visible styled links opened working forms. The old
  judge admitted only an ARIA button. Independent native execution proved
  required feedback and25→25→26 records for rejected-empty/valid submissions.
  The repaired common judge also waits for routed form/list rendering. All3 PASS.
- COI url-filters1: two select actions ran within3.4ms, before React committed
  the first navigation. Exact source and independent functioning control both
  reproduced the lost filter in native React19.3 at CPU×6; waiting for rendered
  results passed at that same CPU setting. The repaired common judge passed
  the unchanged retained source in the actual COI playground. This was not a
  rifty-only runtime defect. React Router7.18.3 documents that same-tick functional
  search-param updates do not queue: [reference](https://reactrouter.com/7.18.3/api/hooks/useSearchParams).

An additional native required-textarea control exposed the same element-type
assumption. Seven native controls now cover all five tasks, textarea, routed
Link and slowed React scheduling. The common smoke still detects every planted
baseline defect across all14 supported task/lane pairs.

## Interpretation

This small diagnostic found no unresolved agent task failure. It does not prove
host/tool/context equivalence or an environment-only quality/performance delta.
Native CLI offers read/bash/edit/write; browser hosts offer their actual SDK
capabilities and distinct tool protocols. Full provider prompts/tool schemas
are retained. UI composition trims the final prompt newline; source prompts
are shared. Native and browser semver resolutions also differed: native registry
mirror supplied React19.2.8, browser public registry supplied19.3.0. Both actual
lockfiles are retained; the URL causal replay used exact browser React19.3.0.

Native add-search2 took541.110s, including an approximately511s provider turn;
url-filters/native1 took328.711s. Both PASS. Latency cause was not isolated;
no retries replaced those measurements.

Native project isolation was subsequently tightened: independent temporary
project even for an in-checkout report path, inherited NODE_PATH omitted from
native npm/dev/Pi children. The live projects already lived outside the checkout;
recorded commands used their own installed dependencies. See
[repair evidence](../../../../../docs/backlog/distribution/reference/agent-bench-final-evidence.md).

[Baseline measurements](../../../../../docs/backlog/distribution/reference/agent-bench-baseline-results.md):
real declarations/.bin/tsc/Monaco now pass after npm tar-root repair; no-COI Node
flags, builtins, foreground pipes and git init/status work. Vitest2.1.9 hits the
explicit legacy-esbuild admission ceiling; native Vitest test passes.

## Artifacts

- `source-artifacts.json.gz`: gzip JSON array `{id,trace,before,after}` for all42
  runs, including dependency locks. This is JSON, not a Playwright ZIP.
- `manifest.json`: original artifact sizes/SHA256 and committed locations.
  Original Playwright ZIPs remain local; screenshots include all original failures
  and one example per lane. The COI URL recheck screenshot is also retained.
- `rechecks.json`: independent native results, exact-version scheduling
  discriminator, actual COI replay and hashes of the corrected judges.

Run again with an available endpoint using the [benchmark CLI](../../../README.md).
Use a new output directory; preserve this diagnostic's original measurements.
