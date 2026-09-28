# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v1; task set: trackline-300+hono-v1; runs/task: 3.
Limits: {"maxToolCalls":40,"runTimeoutMs":600000}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 0fab1a861b1f9bf7112d908b439ef1d1654825f3; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.

Excluded: rifty-no-coi/node-endpoint: installed-bin resident preview only.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| fix-date-sort | rifty | 1 | pass | done | 12.0 | 5 | 10089 | 314 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty | 2 | pass | done | 23.7 | 6 | 15347 | 408 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty | 3 | pass | done | 12.6 | 5 | 10589 | 317 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 1 | pass | done | 24.3 | 7 | 13790 | 444 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 2 | pass | done | 20.7 | 7 | 15122 | 461 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | rifty-no-coi | 3 | pass | done | 28.4 | 7 | 14946 | 526 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 1 | pass | done | 31.5 | 5 | 13849 | 490 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 2 | pass | done | 21.9 | 5 | 11944 | 453 | 0 | 0 | 0 | 0 | 0 | — | — |
| fix-date-sort | local-reference | 3 | pass | done | 23.1 | 8 | 16981 | 616 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | rifty | 1 | pass | done | 31.6 | 10 | 30181 | 956 | 0 | 0 | 0 | 1 | 0 | — | — |
| add-search | rifty | 2 | pass | done | 53.0 | 14 | 41657 | 1343 | 0 | 0 | 0 | 2 | 0 | — | — |
| add-search | rifty | 3 | pass | done | 76.1 | 16 | 55061 | 1986 | 0 | 0 | 0 | 2 | 0 | — | — |
| add-search | rifty-no-coi | 1 | pass | done | 25.7 | 9 | 22537 | 696 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | rifty-no-coi | 2 | pass | done | 40.2 | 11 | 31083 | 1016 | 0 | 0 | 0 | 1 | 0 | — | — |
| add-search | rifty-no-coi | 3 | pass | done | 34.5 | 9 | 21386 | 950 | 0 | 0 | 0 | 1 | 0 | — | — |
| add-search | local-reference | 1 | pass | done | 39.1 | 13 | 32590 | 1201 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | local-reference | 2 | pass | done | 33.1 | 9 | 19173 | 915 | 0 | 0 | 0 | 0 | 0 | — | — |
| add-search | local-reference | 3 | pass | done | 39.9 | 9 | 28741 | 773 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 1 | pass | done | 49.4 | 11 | 27914 | 1192 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 2 | pass | done | 22.9 | 8 | 19058 | 732 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty | 3 | pass | done | 58.1 | 18 | 59366 | 1367 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 1 | pass | done | 27.2 | 8 | 23276 | 812 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 2 | pass | done | 33.1 | 10 | 22868 | 722 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | rifty-no-coi | 3 | fail | done | 46.5 | 10 | 23094 | 1196 | 0 | 0 | 0 | 0 | 0 | agent | Removed the useState import while retaining calls; captured browser ReferenceError. Build passed, UI unavailable; original judge failure retained. |
| url-filters | local-reference | 1 | pass | done | 26.3 | 10 | 17487 | 740 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | local-reference | 2 | pass | done | 28.1 | 10 | 17679 | 837 | 0 | 0 | 0 | 0 | 0 | — | — |
| url-filters | local-reference | 3 | pass | done | 23.1 | 8 | 18848 | 661 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty | 1 | pass | done | 81.1 | 15 | 62340 | 1597 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty | 2 | pass | done | 64.4 | 16 | 67187 | 2208 | 0 | 0 | 0 | 1 | 0 | — | — |
| new-issue-form | rifty | 3 | pass | done | 51.0 | 11 | 43962 | 1467 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty-no-coi | 1 | pass | done | 68.1 | 14 | 57294 | 2606 | 0 | 0 | 0 | 2 | 0 | — | — |
| new-issue-form | rifty-no-coi | 2 | pass | done | 49.4 | 14 | 57168 | 1728 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | rifty-no-coi | 3 | pass | done | 86.2 | 13 | 54178 | 3542 | 0 | 0 | 0 | 3 | 0 | — | — |
| new-issue-form | local-reference | 1 | pass | done | 48.3 | 12 | 40382 | 1669 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | local-reference | 2 | pass | done | 61.4 | 12 | 40459 | 2706 | 0 | 0 | 0 | 0 | 0 | — | — |
| new-issue-form | local-reference | 3 | pass | done | 53.2 | 12 | 38028 | 1856 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 1 | pass | done | 16.6 | 5 | 6335 | 315 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 2 | pass | done | 15.1 | 5 | 6323 | 308 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | rifty | 3 | pass | done | 15.1 | 5 | 6337 | 427 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | local-reference | 1 | pass | done | 13.5 | 5 | 6115 | 350 | 0 | 0 | 0 | 0 | 0 | — | — |
| node-endpoint | local-reference | 2 | fail | done | 10.2 | 3 | 3911 | 149 | 0 | 0 | 0 | 0 | 0 | agent | Only ls/read tools executed, no file changes; final text claimed implementation. Both real /api/stats probes returned 404; original failure retained. |
| node-endpoint | local-reference | 3 | pass | done | 19.5 | 8 | 9001 | 573 | 0 | 0 | 0 | 0 | 0 | — | — |

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
| url-filters | rifty-no-coi | 2/3 | 0 | 0 | -0.333 |
| url-filters | local-reference | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | rifty | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | rifty-no-coi | 3/3 | 0 | 0 | 0.000 |
| new-issue-form | local-reference | 3/3 | 0 | 0 | 0.000 |
| node-endpoint | rifty | 3/3 | 0 | 0 | 0.333 |
| node-endpoint | local-reference | 2/3 | 0 | 0 | 0.000 |
