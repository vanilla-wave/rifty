# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 800fa763ec6123d4b7c0e5cb9d6656bc04045c83; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 4; retained 4.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| async-search-1 | rifty | 1 | pass | done | 30.2 | 17 | 20079 | 1372 | 0 | 0 | 1 | 0 | 10 | — | — |
| async-search-1 | rifty-no-coi | 1 | pass | done | 30.3 | 14 | 23405 | 1791 | 0 | 0 | 2 | 0 | 7 | — | — |
| async-search-1 | local-reference | 1 | pass | done | 33.7 | 5 | 19977 | 2654 | 0 | 0 | 0 | 0 | 2 | — | — |
| async-search-1 | native-codex | 1 | pass | done | 114.2 | 10 | 174507 | 4205 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 3c5c86a2c69580f01653fe7fca1cbade6299da7c102fd5c66224a726cfcb1195 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-10T14:16:54.588Z","agentStart":"2026-10-10T14:17:01.780Z","agentEnd":"2026-10-10T14:17:31.992Z","judgeStart":"2026-10-10T14:17:32.064Z","judgeEnd":"2026-10-10T14:17:36.109Z","complete":"2026-10-10T14:17:36.268Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:17:36.271Z","agentStart":"2026-10-10T14:17:39.444Z","agentEnd":"2026-10-10T14:18:09.761Z","judgeStart":"2026-10-10T14:18:09.802Z","judgeEnd":"2026-10-10T14:18:11.040Z","complete":"2026-10-10T14:18:11.074Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-10T14:18:11.077Z","agentStart":"2026-10-10T14:18:12.515Z","agentEnd":"2026-10-10T14:18:46.252Z","judgeStart":"2026-10-10T14:18:46.264Z","judgeEnd":"2026-10-10T14:18:47.240Z","complete":"2026-10-10T14:18:47.251Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-10T14:18:47.254Z","agentStart":"2026-10-10T14:18:48.574Z","agentEnd":"2026-10-10T14:20:42.785Z","judgeStart":"2026-10-10T14:20:42.789Z","judgeEnd":"2026-10-10T14:20:43.720Z","complete":"2026-10-10T14:20:43.733Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 4; retained 4; missing 0.
Clopper–Pearson exact binomial; Bonferroni simultaneous finite-cell task-macro bands
iid repeated trials within each task/lane, conditional on fixed settings; provider/cache correlations may violate this.
No between-cell independence required for finite-cell union bounds.
No general programming-task population or environment-only causal inference.
Pass means the frozen functional/regression checks passed, not a universal program proof.
Few repeats yield wide conditional intervals; these data do not establish equality/equivalence.
Missing selected attempts have unavailable point estimates; retained failures remain selected.
Native Codex is a separate model/context reference, no Pi delta.

| Task | Split/group | Lane | Pass/selected | Missing | Budget/context | Rate | CP95% | Pi delta | Simultaneous delta band | Failure stages | Tokens in/out |
|---|---|---|---:|---:|---:|---:|---|---:|---|---|---|
| async-search-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 20079/1372 |
| async-search-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 23405/1791 |
| async-search-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 19977/2654 |
| async-search-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 174507/4205 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | project-change | rifty | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | feature | rifty-no-coi | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty-no-coi | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | project-change | rifty-no-coi | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | feature | local-reference | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | project-change | local-reference | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
