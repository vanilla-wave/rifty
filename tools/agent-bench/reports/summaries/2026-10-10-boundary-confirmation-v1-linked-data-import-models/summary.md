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
| linked-import-2 | rifty | 1 | pass | done | 45.4 | 18 | 34963 | 2753 | 0 | 0 | 1 | 0 | 10 | — | — |
| linked-import-2 | rifty | 2 | fail | done | 35.7 | 9 | 21093 | 3214 | 0 | 0 | 0 | 0 | 2 | — | — |
| linked-import-2 | rifty-no-coi | 1 | pass | done | 61.1 | 9 | 26331 | 2768 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | rifty-no-coi | 2 | pass | done | 59.6 | 10 | 24733 | 3246 | 0 | 0 | 0 | 0 | 2 | — | — |
| linked-import-2 | local-reference | 1 | pass | done | 43.1 | 7 | 31149 | 3009 | 0 | 0 | 0 | 0 | 6 | — | — |
| linked-import-2 | local-reference | 2 | pass | done | 56.4 | 6 | 16646 | 2791 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | native-codex | 1 | pass | done | 85.9 | 6 | 134982 | 3404 | unknown | unknown | unknown | unknown | unknown | — | — |
| linked-import-2 | native-codex | 2 | pass | done | 143.9 | 9 | 187241 | 6328 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| linked-import-2 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | e4b89c1a9ed19f5317a480003d4eec110261c856d645ad1c73592bce7043b7f8 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| linked-import-2/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/after.json | {"start":"2026-10-10T16:05:21.884Z","agentStart":"2026-10-10T16:05:28.735Z","agentEnd":"2026-10-10T16:06:14.180Z","judgeStart":"2026-10-10T16:06:14.327Z","judgeEnd":"2026-10-10T16:06:18.300Z","complete":"2026-10-10T16:06:18.527Z"} |
| linked-import-2/rifty/2 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/2/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/2/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/2/after.json | {"start":"2026-10-10T16:06:18.530Z","agentStart":"2026-10-10T16:06:24.035Z","agentEnd":"2026-10-10T16:06:59.699Z","judgeStart":"2026-10-10T16:06:59.859Z","judgeEnd":"2026-10-10T16:07:03.289Z","complete":"2026-10-10T16:07:03.486Z"} |
| linked-import-2/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T16:07:03.489Z","agentStart":"2026-10-10T16:07:07.482Z","agentEnd":"2026-10-10T16:08:08.608Z","judgeStart":"2026-10-10T16:08:08.754Z","judgeEnd":"2026-10-10T16:08:09.638Z","complete":"2026-10-10T16:08:09.748Z"} |
| linked-import-2/rifty-no-coi/2 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/2/after.json | {"start":"2026-10-10T16:08:09.752Z","agentStart":"2026-10-10T16:08:12.991Z","agentEnd":"2026-10-10T16:09:12.593Z","judgeStart":"2026-10-10T16:09:12.718Z","judgeEnd":"2026-10-10T16:09:13.748Z","complete":"2026-10-10T16:09:13.838Z"} |
| linked-import-2/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/after.json | {"start":"2026-10-10T16:09:13.841Z","agentStart":"2026-10-10T16:09:15.310Z","agentEnd":"2026-10-10T16:09:58.432Z","judgeStart":"2026-10-10T16:09:58.446Z","judgeEnd":"2026-10-10T16:09:59.012Z","complete":"2026-10-10T16:09:59.025Z"} |
| linked-import-2/local-reference/2 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/2/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/2/after.json | {"start":"2026-10-10T16:09:59.030Z","agentStart":"2026-10-10T16:10:00.264Z","agentEnd":"2026-10-10T16:10:56.641Z","judgeStart":"2026-10-10T16:10:56.654Z","judgeEnd":"2026-10-10T16:10:57.239Z","complete":"2026-10-10T16:10:57.253Z"} |
| linked-import-2/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/after.json | {"start":"2026-10-10T16:10:57.256Z","agentStart":"2026-10-10T16:10:58.532Z","agentEnd":"2026-10-10T16:12:24.390Z","judgeStart":"2026-10-10T16:12:24.393Z","judgeEnd":"2026-10-10T16:12:24.978Z","complete":"2026-10-10T16:12:24.993Z"} |
| linked-import-2/native-codex/2 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/2/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/2/after.json | {"start":"2026-10-10T16:12:24.996Z","agentStart":"2026-10-10T16:12:26.265Z","agentEnd":"2026-10-10T16:14:50.168Z","judgeStart":"2026-10-10T16:14:50.172Z","judgeEnd":"2026-10-10T16:14:50.766Z","complete":"2026-10-10T16:14:50.780Z"} |

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
| linked-import-2 | evaluation/feature | rifty | 1/2 | 0 | 0/0 | 0.500 | [0.013, 0.987] | -0.500 | [-0.997, 0.918] | {"functional":1} | 56056/5967 |
| linked-import-2 | evaluation/feature | rifty-no-coi | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | 0.000 | [-0.921, 0.921] | {} | 51064/6014 |
| linked-import-2 | evaluation/feature | local-reference | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | 0.000 | [0.000, 0.000] | {} | 47795/5800 |
| linked-import-2 | evaluation/feature | native-codex | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | separate reference | unavailable | {} | 322223/9732 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 1/1 | 1/2 | 0 | 0.500 | [0.003, 0.997] | -0.500 | [-0.997, 0.918] |
| evaluation | all | rifty | 1/1 | 1/2 | 0 | 0.500 | [0.003, 0.997] | -0.500 | [-0.997, 0.918] |
| evaluation | project-change | rifty | 1/1 | 1/2 | 0 | 0.500 | [0.003, 0.997] | -0.500 | [-0.997, 0.918] |
| evaluation | feature | rifty-no-coi | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty-no-coi | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | project-change | rifty-no-coi | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [-0.921, 0.921] |
| evaluation | feature | local-reference | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | project-change | local-reference | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
