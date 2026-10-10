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
| indexed-data-2 | rifty | 1 | pass | done | 68.6 | 19 | 77538 | 2732 | 0 | 0 | 0 | 1 | 0 | — | — |
| indexed-data-2 | rifty-no-coi | 1 | pass | done | 18.9 | 7 | 12080 | 959 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | local-reference | 1 | pass | done | 31.1 | 9 | 25812 | 1902 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | native-codex | 1 | pass | done | 299.8 | 20 | 447772 | 8015 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | b73ef8c869946995cc72ba033db882eee255692a6670e7993b2beea45b302d30 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-10T15:36:34.023Z","agentStart":"2026-10-10T15:36:42.531Z","agentEnd":"2026-10-10T15:37:51.106Z","judgeStart":"2026-10-10T15:37:51.239Z","judgeEnd":"2026-10-10T15:37:53.339Z","complete":"2026-10-10T15:37:53.703Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T15:37:53.705Z","agentStart":"2026-10-10T15:37:57.561Z","agentEnd":"2026-10-10T15:38:16.415Z","judgeStart":"2026-10-10T15:38:16.437Z","judgeEnd":"2026-10-10T15:38:18.672Z","complete":"2026-10-10T15:38:18.724Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-10T15:38:18.726Z","agentStart":"2026-10-10T15:38:21.279Z","agentEnd":"2026-10-10T15:38:52.338Z","judgeStart":"2026-10-10T15:38:52.349Z","judgeEnd":"2026-10-10T15:38:54.430Z","complete":"2026-10-10T15:38:54.477Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-10T15:38:54.479Z","agentStart":"2026-10-10T15:38:56.756Z","agentEnd":"2026-10-10T15:43:56.523Z","judgeStart":"2026-10-10T15:43:56.528Z","judgeEnd":"2026-10-10T15:43:58.526Z","complete":"2026-10-10T15:43:58.545Z"} |

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
| indexed-data-2 | evaluation/app | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 77538/2732 |
| indexed-data-2 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 12080/959 |
| indexed-data-2 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 25812/1902 |
| indexed-data-2 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 447772/8015 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | app | rifty-no-coi | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | all | rifty-no-coi | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [-0.994, 0.994] |
| evaluation | app | local-reference | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | app | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 1/1 | 0 | 1.000 | [0.006, 1.000] | separate reference | unavailable |
