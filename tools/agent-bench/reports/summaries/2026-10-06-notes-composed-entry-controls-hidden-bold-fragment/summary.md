# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v4; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 8d9eef35a3a8f555a0902849191494adc760f228 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| markdown-notes-v4 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v4 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v4 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v4 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| markdown-notes-v4 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | 66267edc5cbff93846cf468b38b1440e8bfb0c9808af04c30e436464357a7d98 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| markdown-notes-v4/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty/1/after.json | {"start":"2026-10-06T19:18:38.648Z","judgeStart":"2026-10-06T19:18:45.541Z","judgeEnd":"2026-10-06T19:18:46.722Z","complete":"2026-10-06T19:18:46.765Z"} |
| markdown-notes-v4/rifty-no-coi/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v4/rifty-no-coi/1/after.json | {"start":"2026-10-06T19:18:46.767Z","judgeStart":"2026-10-06T19:18:49.563Z","judgeEnd":"2026-10-06T19:18:50.469Z","complete":"2026-10-06T19:18:50.479Z"} |
| markdown-notes-v4/local-reference/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v4/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v4/local-reference/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v4/local-reference/1/after.json | {"start":"2026-10-06T19:18:50.481Z","judgeStart":"2026-10-06T19:18:52.736Z","judgeEnd":"2026-10-06T19:18:53.359Z","complete":"2026-10-06T19:18:53.370Z"} |
| markdown-notes-v4/native-codex/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v4/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v4/native-codex/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v4/native-codex/1/after.json | {"start":"2026-10-06T19:18:53.372Z","judgeStart":"2026-10-06T19:18:55.539Z","judgeEnd":"2026-10-06T19:18:56.142Z","complete":"2026-10-06T19:18:56.153Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 4; retained 4; missing 0.
Clopper–Pearson exact binomial; Bonferroni simultaneous finite-cell task-macro bands
iid repeated trials within each task/lane, conditional on fixed settings; provider/cache correlations may violate this.
No between-cell independence required for finite-cell union bounds.
No general programming-task population or environment-only causal inference.
No coding-quality inference: non-model/smoke evidence or missing immutable legacy plan.
Pass means the frozen functional/regression checks passed, not a universal program proof.
Few repeats yield wide conditional intervals; these data do not establish equality/equivalence.
Missing selected attempts have unavailable point estimates; retained failures remain selected.
Native Codex is a separate model/context reference, no Pi delta.

| Task | Split/group | Lane | Pass/selected | Missing | Budget/context | Rate | CP95% | Pi delta | Simultaneous delta band | Failure stages | Tokens in/out |
|---|---|---|---:|---:|---:|---:|---|---:|---|---|---|
| markdown-notes-v4 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| markdown-notes-v4 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| markdown-notes-v4 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| markdown-notes-v4 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
