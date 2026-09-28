# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: trackline-300+hono-v1; runs/task: 3.
Limits: {"maxToolCalls":40,"runTimeoutMs":600000}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 61605476e1217b328c8989e895c4320c6b25624a; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.

Excluded: rifty-no-coi/node-endpoint: installed-bin resident preview only.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| fix-date-sort | rifty | 1 | pass | done | 14.1 | 7 | 18379 | 368 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty | 2 | pass | done | 17.1 | 7 | 16764 | 467 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty | 3 | pass | done | 19.1 | 7 | 15915 | 513 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 1 | pass | done | 22.0 | 6 | 15239 | 491 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 2 | pass | done | 27.4 | 6 | 15245 | 492 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 3 | pass | done | 22.4 | 7 | 17836 | 481 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 1 | pass | done | 16.9 | 7 | 13917 | 390 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 2 | pass | done | 18.4 | 7 | 13856 | 377 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 3 | pass | done | 29.0 | 7 | 19936 | 473 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | rifty | 1 | pass | done | 44.8 | 18 | 59495 | 1449 | 0 | 0 | 0 | 2 | 0 | — | — |
| add-search | rifty | 2 | pass | done | 48.0 | 17 | 65605 | 1527 | 0 | 0 | 0 | 1 | 0 | — | — |
| add-search | rifty | 3 | pass | done | 38.2 | 14 | 39155 | 1233 | 0 | 0 | 0 | 1 | 0 | — | — |
| add-search | rifty-no-coi | 1 | pass | done | 24.8 | 11 | 34352 | 699 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | rifty-no-coi | 2 | pass | done | 48.8 | 16 | 50513 | 1506 | 0 | 0 | 0 | 2 | 0 | — | — |
| add-search | rifty-no-coi | 3 | pass | done | 53.1 | 15 | 48420 | 1700 | 0 | 0 | 0 | 2 | 0 | — | — |
| add-search | local-reference | 1 | pass | done | 34.1 | 10 | 25161 | 1045 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | local-reference | 2 | pass | done | 26.4 | 8 | 31691 | 767 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | local-reference | 3 | pass | done | 23.4 | 8 | 26051 | 761 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 1 | pass | done | 33.5 | 11 | 25990 | 787 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 2 | pass | done | 27.4 | 11 | 22216 | 842 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 3 | pass | done | 30.4 | 10 | 24327 | 891 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 1 | pass | done | 26.5 | 8 | 18259 | 858 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 2 | pass | done | 24.4 | 8 | 19320 | 809 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 3 | pass | done | 26.6 | 9 | 22749 | 808 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | local-reference | 1 | pass | done | 42.1 | 10 | 28712 | 891 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | local-reference | 2 | pass | done | 23.4 | 7 | 18680 | 761 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | local-reference | 3 | pass | done | 23.8 | 8 | 19254 | 758 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty | 1 | pass | done | 54.7 | 12 | 48741 | 1764 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty | 2 | pass | done | 85.9 | 13 | 63607 | 3831 | 0 | 0 | 0 | 2 | 0 | — | — |
| new-issue-form | rifty | 3 | pass | done | 95.6 | 14 | 71382 | 4161 | 0 | 0 | 0 | 2 | 0 | — | — |
| new-issue-form | rifty-no-coi | 1 | pass | done | 75.6 | 13 | 48619 | 3420 | 0 | 0 | 0 | 1 | 0 | — | — |
| new-issue-form | rifty-no-coi | 2 | pass | done | 76.4 | 14 | 66119 | 3308 | 0 | 0 | 0 | 2 | 0 | — | — |
| new-issue-form | rifty-no-coi | 3 | pass | done | 78.5 | 12 | 55535 | 3525 | 0 | 0 | 0 | 1 | 0 | — | — |
| new-issue-form | local-reference | 1 | pass | done | 35.3 | 10 | 40328 | 1353 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | local-reference | 2 | pass | done | 50.7 | 13 | 56024 | 1562 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | local-reference | 3 | pass | done | 39.1 | 13 | 34651 | 1606 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 1 | pass | done | 16.6 | 7 | 11932 | 448 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 2 | pass | done | 19.7 | 10 | 16727 | 486 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 3 | pass | done | 22.3 | 9 | 16638 | 659 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | local-reference | 1 | pass | done | 35.4 | 6 | 13616 | 612 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | local-reference | 2 | pass | done | 15.8 | 6 | 9007 | 502 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | local-reference | 3 | pass | done | 24.3 | 7 | 11927 | 914 | 0 | 0 | 0 | 0 | 0 | — | — |

Per-task pass-rate delta versus local-reference (budget/context counts remain visible):

| Task | Lane | Pass / runs | Budget | Context | Delta |
|---|---|---:|---:|---:|---:|
| fix-date-sort | rifty | 3/3 | 0 | 0 | 0.000 |
| fix-date-sort | rifty-no-coi | 3/3 | 0 | 0 | 0.000 |
| fix-date-sort | local-reference | 3/3 | 0 | 0 | 0.000 |
| add-search | rifty | 3/3 | 0 | 0 | 0.000 |
| add-search | rifty-no-coi | 3/3 | 0 | 0 | 0.000 |
| add-search | local-reference | 3/3 | 0 | 0 | 0.000 |
| url-filters | rifty | 3/3 | 0 | 0 | 0.000 |
| url-filters | rifty-no-coi | 3/3 | 0 | 0 | 0.000 |
| url-filters | local-reference | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | rifty | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | rifty-no-coi | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | local-reference | 3/3 | 0 | 0 | 0.000 |
| node-endpoint | rifty | 3/3 | 0 | 0 | 0.000 |
| node-endpoint | local-reference | 3/3 | 0 | 0 | 0.000 |
