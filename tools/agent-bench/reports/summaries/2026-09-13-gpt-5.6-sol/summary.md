# Agent benchmark: gpt-5.6-sol

Original judge: **38/42**. Retained-artifact recheck: **42/42**, from the same42 model runs; no new model execution. [Original report](original-report.json) · [Recheck evidence](rechecks.json) · [Interpretation](README.md).

Profile: pi-0.85.1+rifty-adapter-v1; task set: trackline-300+hono-v1; runs/task: 3.
Limits: {"maxToolCalls":40,"runTimeoutMs":600000}.
Source: 25391197516ee5ce9bc5c9b7afdc0b5a997f8ad3; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.

Excluded: rifty-no-coi/node-endpoint: installed-bin resident preview only.

Outcomes: pass, fail, budget-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Class | Note |
|---|---|---:|---|---|---:|---:|---|---|
| fix-date-sort | rifty | 1 | pass | done | 54.8 | 13 | — | — |
| fix-date-sort | rifty | 2 | pass | done | 50.9 | 16 | — | — |
| fix-date-sort | rifty | 3 | pass | done | 32.4 | 11 | — | — |
| fix-date-sort | rifty-no-coi | 1 | pass | done | 37.6 | 9 | — | — |
| fix-date-sort | rifty-no-coi | 2 | pass | done | 41.2 | 13 | — | — |
| fix-date-sort | rifty-no-coi | 3 | pass | done | 27.9 | 9 | — | — |
| fix-date-sort | local-reference | 1 | pass | done | 39.0 | 11 | — | — |
| fix-date-sort | local-reference | 2 | pass | done | 43.5 | 13 | — | — |
| fix-date-sort | local-reference | 3 | pass | done | 42.3 | 14 | — | — |
| add-search | rifty | 1 | pass | done | 62.2 | 18 | — | — |
| add-search | rifty | 2 | pass | done | 61.1 | 18 | — | — |
| add-search | rifty | 3 | pass | done | 73.1 | 18 | — | — |
| add-search | rifty-no-coi | 1 | pass | done | 110.1 | 18 | — | — |
| add-search | rifty-no-coi | 2 | pass | done | 81.9 | 16 | — | — |
| add-search | rifty-no-coi | 3 | pass | done | 64.6 | 15 | — | — |
| add-search | local-reference | 1 | pass | done | 48.0 | 14 | — | — |
| add-search | local-reference | 2 | pass | done | 541.1 | 8 | — | 541.110s/8tools PASS retained. One provider turn accounted for about511s; cause not isolated, no timing rerun. |
| add-search | local-reference | 3 | pass | done | 62.9 | 15 | — | — |
| url-filters | rifty | 1 | pass | done | 99.1 | 22 | task-bad | Original live judge FAIL: task-bad, consecutive navigation/select actions outran React rendering. Exact source and independent functional control reproduce in native React19.3/CPU6; corrected judge passes retained source in actual COI playground, no source edits or new model execution. See rechecks.json. |
| url-filters | rifty | 2 | pass | done | 97.1 | 21 | — | — |
| url-filters | rifty | 3 | pass | done | 112.3 | 20 | — | — |
| url-filters | rifty-no-coi | 1 | pass | done | 82.2 | 14 | — | — |
| url-filters | rifty-no-coi | 2 | pass | done | 93.5 | 14 | — | — |
| url-filters | rifty-no-coi | 3 | pass | done | 83.6 | 13 | — | — |
| url-filters | local-reference | 1 | pass | done | 328.7 | 19 | — | 328.711s PASS retained; cause of provider latency not isolated, no timing rerun. |
| url-filters | local-reference | 2 | pass | done | 71.5 | 15 | — | — |
| url-filters | local-reference | 3 | pass | done | 79.8 | 15 | — | — |
| new-issue-form | rifty | 1 | pass | done | 196.4 | 33 | — | — |
| new-issue-form | rifty | 2 | pass | done | 129.2 | 33 | — | — |
| new-issue-form | rifty | 3 | pass | done | 312.0 | 33 | — | — |
| new-issue-form | rifty-no-coi | 1 | pass | done | 89.4 | 21 | — | — |
| new-issue-form | rifty-no-coi | 2 | pass | done | 152.6 | 20 | — | — |
| new-issue-form | rifty-no-coi | 3 | pass | done | 108.8 | 22 | — | — |
| new-issue-form | local-reference | 1 | pass | done | 103.9 | 22 | task-bad | Original live judge FAIL: task-bad, styled Link entry excluded by button-only locator. Independent native replay of the same source passes required feedback and 25→25→26 creation; corrected judge also awaits routed form/list rendering. See rechecks.json. |
| new-issue-form | local-reference | 2 | pass | done | 124.5 | 27 | task-bad | Original live judge FAIL: task-bad, styled Link entry excluded by button-only locator. Independent native replay of the same source passes required feedback and 25→25→26 creation; corrected judge also awaits routed form/list rendering. See rechecks.json. |
| new-issue-form | local-reference | 3 | pass | done | 117.0 | 25 | task-bad | Original live judge FAIL: task-bad, styled Link entry excluded by button-only locator. Independent native replay of the same source passes required feedback and 25→25→26 creation; corrected judge also awaits routed form/list rendering. See rechecks.json. |
| node-endpoint | rifty | 1 | pass | done | 54.4 | 17 | — | — |
| node-endpoint | rifty | 2 | pass | done | 39.0 | 12 | — | — |
| node-endpoint | rifty | 3 | pass | done | 53.0 | 13 | — | — |
| node-endpoint | local-reference | 1 | pass | done | 30.4 | 8 | — | — |
| node-endpoint | local-reference | 2 | pass | done | 27.2 | 7 | — | — |
| node-endpoint | local-reference | 3 | pass | done | 45.1 | 9 | — | — |

Per-task pass-rate delta versus local-reference (budget counts remain visible):

| Task | Lane | Pass / runs | Budget | Delta |
|---|---|---:|---:|---:|
| fix-date-sort | rifty | 3/3 | 0 | 0.000 |
| fix-date-sort | rifty-no-coi | 3/3 | 0 | 0.000 |
| fix-date-sort | local-reference | 3/3 | 0 | 0.000 |
| add-search | rifty | 3/3 | 0 | 0.000 |
| add-search | rifty-no-coi | 3/3 | 0 | 0.000 |
| add-search | local-reference | 3/3 | 0 | 0.000 |
| url-filters | rifty | 3/3 | 0 | 0.000 |
| url-filters | rifty-no-coi | 3/3 | 0 | 0.000 |
| url-filters | local-reference | 3/3 | 0 | 0.000 |
| new-issue-form | rifty | 3/3 | 0 | 0.000 |
| new-issue-form | rifty-no-coi | 3/3 | 0 | 0.000 |
| new-issue-form | local-reference | 3/3 | 0 | 0.000 |
| node-endpoint | rifty | 3/3 | 0 | 0.000 |
| node-endpoint | local-reference | 3/3 | 0 | 0.000 |
