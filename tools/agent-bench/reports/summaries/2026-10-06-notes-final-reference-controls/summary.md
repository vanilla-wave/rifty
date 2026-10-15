# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v4; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: db494579e4bde3aa61525f416c33633784654b08 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| csv-workflow-v3 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| csv-workflow-v3 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | 1bca079e9be141a0722241d233f0e135eb06ce822e319697824dbe12abf65c0e |
| markdown-notes-v3 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | 53018e6f260f5022441b7b028a2910ccc8580e0509b7dbaf6a0677dfb657000a |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| csv-workflow-v3/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/after.json | {"start":"2026-10-05T23:19:31.360Z","judgeStart":"2026-10-05T23:19:39.115Z","judgeEnd":"2026-10-05T23:19:47.204Z","complete":"2026-10-05T23:19:47.284Z"} |
| csv-workflow-v3/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/after.json | {"start":"2026-10-05T23:19:47.287Z","judgeStart":"2026-10-05T23:19:50.677Z","judgeEnd":"2026-10-05T23:19:58.345Z","complete":"2026-10-05T23:19:58.367Z"} |
| csv-workflow-v3/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/after.json | {"start":"2026-10-05T23:19:58.372Z","judgeStart":"2026-10-05T23:20:01.045Z","judgeEnd":"2026-10-05T23:20:07.603Z","complete":"2026-10-05T23:20:07.620Z"} |
| csv-workflow-v3/native-codex/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/after.json | {"start":"2026-10-05T23:20:07.623Z","judgeStart":"2026-10-05T23:20:09.979Z","judgeEnd":"2026-10-05T23:20:16.553Z","complete":"2026-10-05T23:20:16.586Z"} |
| markdown-notes-v3/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/after.json | {"start":"2026-10-05T23:20:16.589Z","judgeStart":"2026-10-05T23:20:23.073Z","judgeEnd":"2026-10-05T23:20:24.851Z","complete":"2026-10-05T23:20:24.991Z"} |
| markdown-notes-v3/rifty-no-coi/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/after.json | {"start":"2026-10-05T23:20:24.998Z","judgeStart":"2026-10-05T23:20:29.715Z","judgeEnd":"2026-10-05T23:20:30.728Z","complete":"2026-10-05T23:20:30.754Z"} |
| markdown-notes-v3/local-reference/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/after.json | {"start":"2026-10-05T23:20:30.762Z","judgeStart":"2026-10-05T23:20:33.199Z","judgeEnd":"2026-10-05T23:20:33.919Z","complete":"2026-10-05T23:20:33.954Z"} |
| markdown-notes-v3/native-codex/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/after.json | {"start":"2026-10-05T23:20:33.963Z","judgeStart":"2026-10-05T23:20:36.516Z","judgeEnd":"2026-10-05T23:20:37.261Z","complete":"2026-10-05T23:20:37.292Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 8; retained 8; missing 0.
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
| csv-workflow-v3 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
