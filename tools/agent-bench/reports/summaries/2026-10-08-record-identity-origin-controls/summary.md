# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v10; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 631a8cb7064e09a2e979b72f60d50c1aaf19685e (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| booking-workflow-v7-original | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-original | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-original | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-original | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-discard | rifty | 1 | pass | not-run | 0.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-discard | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-discard | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v7-discard | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| booking-workflow-v7-original | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 7725af1fb5853ddfe6d358fdaeb4be8f330be78aba22f869bb671cd7c63a3b8a |
| booking-workflow-v7-discard | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 7725af1fb5853ddfe6d358fdaeb4be8f330be78aba22f869bb671cd7c63a3b8a |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| booking-workflow-v7-original/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v7-original/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty/1/trace.json) | [booking-workflow-v7-original/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty/1/before.json) / [booking-workflow-v7-original/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty/1/after.json) | {"start":"2026-10-08T18:56:25.684Z","judgeStart":"2026-10-08T18:56:36.418Z","judgeEnd":"2026-10-08T18:57:07.221Z","complete":"2026-10-08T18:57:08.048Z"} |
| booking-workflow-v7-original/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v7-original/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty-no-coi/1/trace.json) | [booking-workflow-v7-original/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty-no-coi/1/before.json) / [booking-workflow-v7-original/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v7-original/rifty-no-coi/1/after.json) | {"start":"2026-10-08T18:57:08.052Z","judgeStart":"2026-10-08T18:57:10.727Z","judgeEnd":"2026-10-08T18:57:53.308Z","complete":"2026-10-08T18:57:53.790Z"} |
| booking-workflow-v7-original/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v7-original/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-original/local-reference/1/trace.json) | [booking-workflow-v7-original/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v7-original/local-reference/1/before.json) / [booking-workflow-v7-original/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v7-original/local-reference/1/after.json) | {"start":"2026-10-08T18:57:53.796Z","judgeStart":"2026-10-08T18:57:56.327Z","judgeEnd":"2026-10-08T18:58:29.218Z","complete":"2026-10-08T18:58:29.817Z"} |
| booking-workflow-v7-original/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v7-original/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-original/native-codex/1/trace.json) | [booking-workflow-v7-original/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v7-original/native-codex/1/before.json) / [booking-workflow-v7-original/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v7-original/native-codex/1/after.json) | {"start":"2026-10-08T18:58:29.824Z","judgeStart":"2026-10-08T18:58:32.630Z","judgeEnd":"2026-10-08T18:58:59.816Z","complete":"2026-10-08T18:59:00.275Z"} |
| booking-workflow-v7-discard/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v7-discard/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty/1/trace.json) | [booking-workflow-v7-discard/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty/1/before.json) / [booking-workflow-v7-discard/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty/1/after.json) | {"start":"2026-10-08T18:59:00.283Z","judgeStart":"2026-10-08T18:59:10.339Z","judgeEnd":"2026-10-08T19:00:22.608Z","complete":"2026-10-08T19:00:26.286Z"} |
| booking-workflow-v7-discard/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v7-discard/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty-no-coi/1/trace.json) | [booking-workflow-v7-discard/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty-no-coi/1/before.json) / [booking-workflow-v7-discard/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v7-discard/rifty-no-coi/1/after.json) | {"start":"2026-10-08T19:00:26.309Z","judgeStart":"2026-10-08T19:00:32.892Z","judgeEnd":"2026-10-08T19:01:54.260Z","complete":"2026-10-08T19:01:54.946Z"} |
| booking-workflow-v7-discard/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v7-discard/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-discard/local-reference/1/trace.json) | [booking-workflow-v7-discard/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v7-discard/local-reference/1/before.json) / [booking-workflow-v7-discard/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v7-discard/local-reference/1/after.json) | {"start":"2026-10-08T19:01:54.958Z","judgeStart":"2026-10-08T19:01:57.634Z","judgeEnd":"2026-10-08T19:02:26.533Z","complete":"2026-10-08T19:02:26.998Z"} |
| booking-workflow-v7-discard/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v7-discard/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v7-discard/native-codex/1/trace.json) | [booking-workflow-v7-discard/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v7-discard/native-codex/1/before.json) / [booking-workflow-v7-discard/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v7-discard/native-codex/1/after.json) | {"start":"2026-10-08T19:02:27.004Z","judgeStart":"2026-10-08T19:02:29.813Z","judgeEnd":"2026-10-08T19:02:56.851Z","complete":"2026-10-08T19:02:57.298Z"} |

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
| booking-workflow-v7-original | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-original | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-original | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-original | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v7-discard | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-discard | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-discard | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v7-discard | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
