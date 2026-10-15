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
| indexed-data-1 | rifty | 1 | pass | done | 36.4 | 24 | 42447 | 1882 | 0 | 0 | 2 | 0 | 15 | — | — |
| indexed-data-1 | rifty-no-coi | 1 | pass | done | 38.2 | 22 | 33804 | 1375 | 0 | 0 | 2 | 0 | 15 | — | — |
| indexed-data-1 | local-reference | 1 | pass | done | 31.8 | 9 | 44575 | 1847 | 0 | 0 | 0 | 0 | 9 | — | — |
| indexed-data-1 | native-codex | 1 | pass | done | 219.7 | 11 | 277310 | 5783 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | ed034985a353d4fd086eed79f877ada0133885733baa7c44457c87263b4d28df |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| indexed-data-1/rifty/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/after.json | {"start":"2026-10-10T15:28:43.007Z","agentStart":"2026-10-10T15:28:52.131Z","agentEnd":"2026-10-10T15:29:28.535Z","judgeStart":"2026-10-10T15:29:28.657Z","judgeEnd":"2026-10-10T15:29:30.026Z","complete":"2026-10-10T15:29:30.215Z"} |
| indexed-data-1/rifty-no-coi/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T15:29:30.218Z","agentStart":"2026-10-10T15:29:33.050Z","agentEnd":"2026-10-10T15:30:11.249Z","judgeStart":"2026-10-10T15:30:11.281Z","judgeEnd":"2026-10-10T15:30:12.783Z","complete":"2026-10-10T15:30:12.826Z"} |
| indexed-data-1/local-reference/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/after.json | {"start":"2026-10-10T15:30:12.828Z","agentStart":"2026-10-10T15:30:15.440Z","agentEnd":"2026-10-10T15:30:47.202Z","judgeStart":"2026-10-10T15:30:47.216Z","judgeEnd":"2026-10-10T15:30:48.591Z","complete":"2026-10-10T15:30:48.625Z"} |
| indexed-data-1/native-codex/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/after.json | {"start":"2026-10-10T15:30:48.628Z","agentStart":"2026-10-10T15:30:50.893Z","agentEnd":"2026-10-10T15:34:30.598Z","judgeStart":"2026-10-10T15:34:30.601Z","judgeEnd":"2026-10-10T15:34:33.452Z","complete":"2026-10-10T15:34:33.484Z"} |

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
| indexed-data-1 | evaluation/app | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 42447/1882 |
| indexed-data-1 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.994, 0.994] | {} | 33804/1375 |
| indexed-data-1 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 44575/1847 |
| indexed-data-1 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 277310/5783 |

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
