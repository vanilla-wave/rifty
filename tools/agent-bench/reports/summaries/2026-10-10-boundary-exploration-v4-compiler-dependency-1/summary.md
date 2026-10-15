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
| compiler-dependency-1 | rifty | 1 | pass | done | 28.7 | 11 | 15457 | 1020 | 0 | 0 | 1 | 0 | 3 | — | — |
| compiler-dependency-1 | rifty-no-coi | 1 | pass | done | 35.6 | 22 | 30508 | 1229 | 0 | 0 | 1 | 0 | 15 | — | — |
| compiler-dependency-1 | local-reference | 1 | pass | done | 52.2 | 7 | 26137 | 1602 | 0 | 0 | 0 | 0 | 10 | — | — |
| compiler-dependency-1 | native-codex | 1 | pass | done | 222.1 | 19 | 441935 | 4346 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | d658f55d3603f0e081e5bfcdc621c5dc1252fb15dac414eeb053a66b9a9cf651 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| compiler-dependency-1/rifty/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/after.json | {"start":"2026-10-10T15:11:56.310Z","agentStart":"2026-10-10T15:12:05.889Z","agentEnd":"2026-10-10T15:12:34.584Z","judgeStart":"2026-10-10T15:12:34.668Z","judgeEnd":"2026-10-10T15:12:36.621Z","complete":"2026-10-10T15:12:36.859Z"} |
| compiler-dependency-1/rifty-no-coi/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T15:12:36.861Z","agentStart":"2026-10-10T15:12:40.052Z","agentEnd":"2026-10-10T15:13:15.604Z","judgeStart":"2026-10-10T15:13:15.623Z","judgeEnd":"2026-10-10T15:13:18.609Z","complete":"2026-10-10T15:13:18.635Z"} |
| compiler-dependency-1/local-reference/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/after.json | {"start":"2026-10-10T15:13:18.640Z","agentStart":"2026-10-10T15:13:21.529Z","agentEnd":"2026-10-10T15:14:13.772Z","judgeStart":"2026-10-10T15:14:13.783Z","judgeEnd":"2026-10-10T15:14:14.843Z","complete":"2026-10-10T15:14:14.856Z"} |
| compiler-dependency-1/native-codex/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/after.json | {"start":"2026-10-10T15:14:14.859Z","agentStart":"2026-10-10T15:14:17.387Z","agentEnd":"2026-10-10T15:17:59.483Z","judgeStart":"2026-10-10T15:17:59.487Z","judgeEnd":"2026-10-10T15:18:00.367Z","complete":"2026-10-10T15:18:00.382Z"} |

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
| compiler-dependency-1 | evaluation/app | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 15457/1020 |
| compiler-dependency-1 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 30508/1229 |
| compiler-dependency-1 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 26137/1602 |
| compiler-dependency-1 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 441935/4346 |

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
