# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: a0b571faa7ca1f074b0c9ef18378958ed455dc40; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| async-search-2 | rifty | 1 | fail | done | 54.1 | 21 | 49303 | 3111 | 0 | 0 | 1 | 0 | 9 | — | — |
| async-search-2 | rifty-no-coi | 1 | fail | done | 61.6 | 25 | 54168 | 3629 | 0 | 0 | 1 | 0 | 11 | — | — |
| async-search-2 | local-reference | 1 | fail | done | 61.8 | 14 | 61931 | 4138 | 0 | 0 | 0 | 0 | 3 | — | — |
| async-search-2 | native-codex | 1 | pass | done | 110.7 | 8 | 138812 | 3844 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | e501fc01afca3217665b1db2674b4cd083e93f4b94b1d757bb921e6be76be4dc |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-10T15:05:05.902Z","agentStart":"2026-10-10T15:05:13.104Z","agentEnd":"2026-10-10T15:06:07.198Z","judgeStart":"2026-10-10T15:06:07.341Z","judgeEnd":"2026-10-10T15:06:11.410Z","complete":"2026-10-10T15:06:11.639Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T15:06:11.642Z","agentStart":"2026-10-10T15:06:14.697Z","agentEnd":"2026-10-10T15:07:16.334Z","judgeStart":"2026-10-10T15:07:16.435Z","judgeEnd":"2026-10-10T15:07:17.775Z","complete":"2026-10-10T15:07:17.938Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-10T15:07:17.944Z","agentStart":"2026-10-10T15:07:19.453Z","agentEnd":"2026-10-10T15:08:21.253Z","judgeStart":"2026-10-10T15:08:21.271Z","judgeEnd":"2026-10-10T15:08:22.074Z","complete":"2026-10-10T15:08:22.087Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-10T15:08:22.090Z","agentStart":"2026-10-10T15:08:23.598Z","agentEnd":"2026-10-10T15:10:14.316Z","judgeStart":"2026-10-10T15:10:14.320Z","judgeEnd":"2026-10-10T15:10:15.590Z","complete":"2026-10-10T15:10:15.603Z"} |

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
| async-search-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.994, 0.994] | {"functional":1} | 49303/3111 |
| async-search-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.994, 0.994] | {"functional":1} | 54168/3629 |
| async-search-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [0.000, 0.000] | {"functional":1} | 61931/4138 |
| async-search-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 138812/3844 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | project-change | rifty | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty-no-coi | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | project-change | rifty-no-coi | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [-0.994, 0.994] |
| evaluation | feature | local-reference | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [0.000, 0.000] |
| evaluation | project-change | local-reference | 1/1 | 0/1 | 0 | 0.000 | [0.000, 0.994] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
