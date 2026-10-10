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
| indexed-data-2 | rifty | 1 | pass | done | 29.8 | 11 | 30198 | 1803 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | rifty | 2 | pass | done | 31.8 | 20 | 40395 | 2041 | 0 | 0 | 1 | 0 | 12 | — | — |
| indexed-data-2 | rifty-no-coi | 1 | pass | done | 35.1 | 14 | 29022 | 2012 | 0 | 0 | 1 | 0 | 4 | — | — |
| indexed-data-2 | rifty-no-coi | 2 | pass | done | 48.8 | 22 | 43529 | 2413 | 0 | 0 | 2 | 0 | 11 | — | — |
| indexed-data-2 | local-reference | 1 | pass | done | 29.7 | 8 | 33197 | 2007 | 0 | 0 | 0 | 0 | 8 | — | — |
| indexed-data-2 | local-reference | 2 | pass | done | 41.5 | 10 | 49855 | 2237 | 0 | 0 | 0 | 0 | 9 | — | — |
| indexed-data-2 | native-codex | 1 | pass | done | 167.2 | 12 | 296073 | 5076 | unknown | unknown | unknown | unknown | unknown | — | — |
| indexed-data-2 | native-codex | 2 | pass | done | 197.3 | 16 | 373886 | 6358 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | b73ef8c869946995cc72ba033db882eee255692a6670e7993b2beea45b302d30 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-10T16:47:23.904Z","agentStart":"2026-10-10T16:47:32.445Z","agentEnd":"2026-10-10T16:48:02.201Z","judgeStart":"2026-10-10T16:48:02.330Z","judgeEnd":"2026-10-10T16:48:04.917Z","complete":"2026-10-10T16:48:05.165Z"} |
| indexed-data-2/rifty/2 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/2/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/2/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/2/after.json | {"start":"2026-10-10T16:48:05.167Z","agentStart":"2026-10-10T16:48:12.599Z","agentEnd":"2026-10-10T16:48:44.383Z","judgeStart":"2026-10-10T16:48:44.507Z","judgeEnd":"2026-10-10T16:48:47.669Z","complete":"2026-10-10T16:48:47.987Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T16:48:47.990Z","agentStart":"2026-10-10T16:48:50.799Z","agentEnd":"2026-10-10T16:49:25.893Z","judgeStart":"2026-10-10T16:49:25.940Z","judgeEnd":"2026-10-10T16:49:27.709Z","complete":"2026-10-10T16:49:27.800Z"} |
| indexed-data-2/rifty-no-coi/2 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/2/after.json | {"start":"2026-10-10T16:49:27.802Z","agentStart":"2026-10-10T16:49:30.252Z","agentEnd":"2026-10-10T16:50:19.009Z","judgeStart":"2026-10-10T16:50:19.075Z","judgeEnd":"2026-10-10T16:50:21.411Z","complete":"2026-10-10T16:50:21.475Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-10T16:50:21.478Z","agentStart":"2026-10-10T16:50:24.188Z","agentEnd":"2026-10-10T16:50:53.934Z","judgeStart":"2026-10-10T16:50:53.942Z","judgeEnd":"2026-10-10T16:50:55.464Z","complete":"2026-10-10T16:50:55.527Z"} |
| indexed-data-2/local-reference/2 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/2/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/2/after.json | {"start":"2026-10-10T16:50:55.529Z","agentStart":"2026-10-10T16:50:57.732Z","agentEnd":"2026-10-10T16:51:39.265Z","judgeStart":"2026-10-10T16:51:39.274Z","judgeEnd":"2026-10-10T16:51:40.790Z","complete":"2026-10-10T16:51:40.820Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-10T16:51:40.823Z","agentStart":"2026-10-10T16:51:43.370Z","agentEnd":"2026-10-10T16:54:30.600Z","judgeStart":"2026-10-10T16:54:30.603Z","judgeEnd":"2026-10-10T16:54:31.640Z","complete":"2026-10-10T16:54:31.668Z"} |
| indexed-data-2/native-codex/2 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/2/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/2/after.json | {"start":"2026-10-10T16:54:31.671Z","agentStart":"2026-10-10T16:54:34.282Z","agentEnd":"2026-10-10T16:57:51.543Z","judgeStart":"2026-10-10T16:57:51.547Z","judgeEnd":"2026-10-10T16:57:52.489Z","complete":"2026-10-10T16:57:52.516Z"} |

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
| indexed-data-2 | evaluation/app | rifty | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | 0.000 | [-0.921, 0.921] | {} | 70593/3844 |
| indexed-data-2 | evaluation/app | rifty-no-coi | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | 0.000 | [-0.921, 0.921] | {} | 72551/4425 |
| indexed-data-2 | evaluation/app | local-reference | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | 0.000 | [0.000, 0.000] | {} | 83052/4244 |
| indexed-data-2 | evaluation/app | native-codex | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | separate reference | unavailable | {} | 669959/11434 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | app | rifty-no-coi | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty-no-coi | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | app | local-reference | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | app | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
