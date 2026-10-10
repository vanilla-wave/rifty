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
| compiler-dependency-2 | rifty | 1 | fail | error | 6.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty | 2 | fail | error | 4.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty-no-coi | 1 | fail | error | 2.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty-no-coi | 2 | fail | error | 2.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | local-reference | 1 | fail | done | 127.3 | 15 | 67913 | 2277 | 0 | 0 | 0 | 0 | 4 | — | — |
| compiler-dependency-2 | local-reference | 2 | fail | done | 53.0 | 15 | 57538 | 2664 | 0 | 0 | 0 | 0 | 4 | — | — |
| compiler-dependency-2 | native-codex | 1 | pass | done | 194.1 | 23 | 592007 | 5462 | unknown | unknown | unknown | unknown | unknown | — | — |
| compiler-dependency-2 | native-codex | 2 | pass | done | 135.7 | 10 | 226581 | 3690 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | a6dc26a95d93d4b894933ef70e92e8666b5ba250f2b16c7bbc4bcb8bfe26d322 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| compiler-dependency-2/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-10T16:34:15.120Z","complete":"2026-10-10T16:34:21.916Z"} |
| compiler-dependency-2/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-10T16:34:21.919Z","complete":"2026-10-10T16:34:26.568Z"} |
| compiler-dependency-2/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-10T16:34:26.570Z","complete":"2026-10-10T16:34:29.270Z"} |
| compiler-dependency-2/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-10T16:34:29.276Z","complete":"2026-10-10T16:34:31.838Z"} |
| compiler-dependency-2/local-reference/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/after.json | {"start":"2026-10-10T16:34:31.841Z","agentStart":"2026-10-10T16:34:34.447Z","agentEnd":"2026-10-10T16:36:41.726Z","judgeStart":"2026-10-10T16:36:41.740Z","judgeEnd":"2026-10-10T16:36:43.271Z","complete":"2026-10-10T16:36:43.300Z"} |
| compiler-dependency-2/local-reference/2 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/2/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/2/after.json | {"start":"2026-10-10T16:36:43.303Z","agentStart":"2026-10-10T16:36:46.260Z","agentEnd":"2026-10-10T16:37:39.305Z","judgeStart":"2026-10-10T16:37:39.320Z","judgeEnd":"2026-10-10T16:37:40.828Z","complete":"2026-10-10T16:37:40.854Z"} |
| compiler-dependency-2/native-codex/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/after.json | {"start":"2026-10-10T16:37:40.858Z","agentStart":"2026-10-10T16:37:43.680Z","agentEnd":"2026-10-10T16:40:57.797Z","judgeStart":"2026-10-10T16:40:57.800Z","judgeEnd":"2026-10-10T16:40:59.321Z","complete":"2026-10-10T16:40:59.356Z"} |
| compiler-dependency-2/native-codex/2 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/2/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/2/after.json | {"start":"2026-10-10T16:40:59.360Z","agentStart":"2026-10-10T16:41:01.984Z","agentEnd":"2026-10-10T16:43:17.655Z","judgeStart":"2026-10-10T16:43:17.659Z","judgeEnd":"2026-10-10T16:43:19.166Z","complete":"2026-10-10T16:43:19.195Z"} |

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
| compiler-dependency-2 | evaluation/app | rifty | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [-0.921, 0.921] | {"setup":2} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty-no-coi | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [-0.921, 0.921] | {"setup":2} | 0/0 |
| compiler-dependency-2 | evaluation/app | local-reference | 0/2 | 0 | 0/0 | 0.000 | [0.000, 0.842] | 0.000 | [0.000, 0.000] | {"functional":2} | 125451/4941 |
| compiler-dependency-2 | evaluation/app | native-codex | 2/2 | 0 | 0/0 | 1.000 | [0.158, 1.000] | separate reference | unavailable | {} | 818588/9152 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | app | rifty-no-coi | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | all | rifty-no-coi | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [-0.921, 0.921] |
| evaluation | app | local-reference | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 1/1 | 0/2 | 0 | 0.000 | [0.000, 0.921] | 0.000 | [0.000, 0.000] |
| evaluation | app | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 1/1 | 2/2 | 0 | 1.000 | [0.079, 1.000] | separate reference | unavailable |
