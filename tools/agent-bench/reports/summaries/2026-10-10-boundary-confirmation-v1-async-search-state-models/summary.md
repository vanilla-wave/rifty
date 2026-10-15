# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 2.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 77597a9d3e2eec28cd2ea17da14b2ea20851d19c; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 8; retained 8.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| async-search-2 | rifty | 1 | fail | done | 58.4 | 20 | 39285 | 2331 | 0 | 0 | 1 | 0 | 10 | — | — |
| async-search-2 | rifty | 2 | fail | done | 44.0 | 16 | 22970 | 1760 | 0 | 0 | 1 | 0 | 9 | — | — |
| async-search-2 | rifty-no-coi | 1 | fail | done | 34.6 | 11 | 19143 | 2480 | 0 | 0 | 0 | 0 | 2 | — | — |
| async-search-2 | rifty-no-coi | 2 | fail | done | 34.9 | 22 | 34534 | 2715 | 0 | 0 | 1 | 0 | 15 | — | — |
| async-search-2 | local-reference | 1 | fail | done | 36.5 | 8 | 24581 | 3488 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | local-reference | 2 | fail | done | 49.3 | 4 | 21283 | 2258 | 0 | 0 | 0 | 0 | 8 | — | — |
| async-search-2 | native-codex | 1 | pass | done | 111.0 | 9 | 159822 | 3706 | unknown | unknown | unknown | unknown | unknown | — | — |
| async-search-2 | native-codex | 2 | pass | done | 135.6 | 10 | 192374 | 5541 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | e501fc01afca3217665b1db2674b4cd083e93f4b94b1d757bb921e6be76be4dc |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-10T16:21:39.692Z","agentStart":"2026-10-10T16:21:47.185Z","agentEnd":"2026-10-10T16:22:45.602Z","judgeStart":"2026-10-10T16:22:45.712Z","judgeEnd":"2026-10-10T16:22:49.714Z","complete":"2026-10-10T16:22:49.884Z"} |
| async-search-2/rifty/2 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/2/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/2/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/2/after.json | {"start":"2026-10-10T16:22:49.886Z","agentStart":"2026-10-10T16:22:55.358Z","agentEnd":"2026-10-10T16:23:39.378Z","judgeStart":"2026-10-10T16:23:39.475Z","judgeEnd":"2026-10-10T16:23:43.536Z","complete":"2026-10-10T16:23:43.699Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T16:23:43.701Z","agentStart":"2026-10-10T16:23:46.976Z","agentEnd":"2026-10-10T16:24:21.552Z","judgeStart":"2026-10-10T16:24:21.637Z","judgeEnd":"2026-10-10T16:24:22.794Z","complete":"2026-10-10T16:24:22.860Z"} |
| async-search-2/rifty-no-coi/2 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/2/after.json | {"start":"2026-10-10T16:24:22.863Z","agentStart":"2026-10-10T16:24:25.821Z","agentEnd":"2026-10-10T16:25:00.735Z","judgeStart":"2026-10-10T16:25:00.828Z","judgeEnd":"2026-10-10T16:25:01.901Z","complete":"2026-10-10T16:25:01.972Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-10T16:25:01.975Z","agentStart":"2026-10-10T16:25:03.578Z","agentEnd":"2026-10-10T16:25:40.074Z","judgeStart":"2026-10-10T16:25:40.082Z","judgeEnd":"2026-10-10T16:25:41.260Z","complete":"2026-10-10T16:25:41.271Z"} |
| async-search-2/local-reference/2 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/2/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/2/after.json | {"start":"2026-10-10T16:25:41.273Z","agentStart":"2026-10-10T16:25:42.503Z","agentEnd":"2026-10-10T16:26:31.834Z","judgeStart":"2026-10-10T16:26:31.848Z","judgeEnd":"2026-10-10T16:26:32.502Z","complete":"2026-10-10T16:26:32.513Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-10T16:26:32.515Z","agentStart":"2026-10-10T16:26:33.780Z","agentEnd":"2026-10-10T16:28:24.739Z","judgeStart":"2026-10-10T16:28:24.740Z","judgeEnd":"2026-10-10T16:28:25.977Z","complete":"2026-10-10T16:28:25.990Z"} |
| async-search-2/native-codex/2 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/2/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/2/after.json | {"start":"2026-10-10T16:28:25.993Z","agentStart":"2026-10-10T16:28:27.421Z","agentEnd":"2026-10-10T16:30:43.035Z","judgeStart":"2026-10-10T16:30:43.037Z","judgeEnd":"2026-10-10T16:30:44.269Z","complete":"2026-10-10T16:30:44.282Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 8; retained 8; missing 0.
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
| async-search-2 | evaluation/feature | rifty | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [-0.921, 0.921] | {"functional":2} | 62255/4091 |
| async-search-2 | evaluation/feature | rifty-no-coi | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [-0.921, 0.921] | {"functional":2} | 53677/5195 |
| async-search-2 | evaluation/feature | local-reference | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [0.000, 0.000] | {"functional":2} | 45864/5746 |
| async-search-2 | evaluation/feature | native-codex | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | separate reference | unavailable | {} | 352196/9247 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | project-change | rifty | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty-no-coi | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | project-change | rifty-no-coi | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | feature | local-reference | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [0.000, 0.000] |
| evaluation | project-change | local-reference | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
