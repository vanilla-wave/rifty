# Agent benchmark: scripted

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v1; runs/task: 1.
Limits: {"maxToolCalls":40,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"scripted","name":"scripted","provider":"bench","api":"openai-completions","baseUrl":"http://127.0.0.1:55308/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":false,"thinking":"off","compat":{},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: bc1bcdb33561d2c3c5251e441b5db51f8314a7b4 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Series: completed; selected 24; retained 24.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| ms-negative | rifty | 1 | fail | error | 9.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | fail | done | 0.6 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 1 | fail | error | 3.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty | 1 | fail | done | 0.2 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty-no-coi | 1 | fail | done | 0.0 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | rifty | 1 | fail | done | 0.1 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | rifty-no-coi | 1 | fail | done | 0.0 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | local-reference | 1 | fail | done | 0.6 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Per-task pass-rate delta versus local-reference (budget/context counts remain visible):

| Task | Lane | Pass / runs | Budget | Context | Delta |
|---|---|---:|---:|---:|---:|
| ms-negative | rifty | 0/1 | 0 | 0 | 0.000 |
| ms-negative | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| ms-negative | local-reference | 0/1 | 0 | 0 | 0.000 |
| ms-negative | native-codex | 0/1 | 0 | 0 | separate reference |
| ms-weeks | rifty | 0/1 | 0 | 0 | 0.000 |
| ms-weeks | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| ms-weeks | local-reference | 0/1 | 0 | 0 | 0.000 |
| ms-weeks | native-codex | 0/1 | 0 | 0 | separate reference |
| stringify-boxed | rifty | 0/1 | 0 | 0 | 0.000 |
| stringify-boxed | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| stringify-boxed | local-reference | 0/1 | 0 | 0 | 0.000 |
| stringify-boxed | native-codex | 0/1 | 0 | 0 | separate reference |
| queue-clear | rifty | 0/1 | 0 | 0 | 0.000 |
| queue-clear | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| queue-clear | local-reference | 0/1 | 0 | 0 | 0.000 |
| queue-clear | native-codex | 0/1 | 0 | 0 | separate reference |
| csv-workflow | rifty | 0/1 | 0 | 0 | 0.000 |
| csv-workflow | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| csv-workflow | local-reference | 0/1 | 0 | 0 | 0.000 |
| csv-workflow | native-codex | 0/1 | 0 | 0 | separate reference |
| markdown-notes | rifty | 0/1 | 0 | 0 | 0.000 |
| markdown-notes | rifty-no-coi | 0/1 | 0 | 0 | 0.000 |
| markdown-notes | local-reference | 0/1 | 0 | 0 | 0.000 |
| markdown-notes | native-codex | 0/1 | 0 | 0 | separate reference |
