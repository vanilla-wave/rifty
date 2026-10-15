# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v11; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 61d327a9ee4611dc58226fe8670bb18f7139bb29 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 12; retained 12.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| booking-workflow-v8-original | rifty | 1 | pass | not-run | 0.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-original | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-original | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-original | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-discard | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-discard | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-discard | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-discard | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-decorated | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-decorated | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-decorated | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v8-decorated | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| booking-workflow-v8-original | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 7532c7d12e6d72aa7ecc69b98d0c186141577aedc43caccfe82b9ad790148f1e |
| booking-workflow-v8-discard | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 7532c7d12e6d72aa7ecc69b98d0c186141577aedc43caccfe82b9ad790148f1e |
| booking-workflow-v8-decorated | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 7532c7d12e6d72aa7ecc69b98d0c186141577aedc43caccfe82b9ad790148f1e |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| booking-workflow-v8-original/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-original/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty/1/trace.json) | [booking-workflow-v8-original/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty/1/before.json) / [booking-workflow-v8-original/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty/1/after.json) | {"start":"2026-10-08T19:29:24.567Z","judgeStart":"2026-10-08T19:29:40.344Z","judgeEnd":"2026-10-08T19:30:21.283Z","complete":"2026-10-08T19:30:22.397Z"} |
| booking-workflow-v8-original/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-original/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty-no-coi/1/trace.json) | [booking-workflow-v8-original/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty-no-coi/1/before.json) / [booking-workflow-v8-original/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v8-original/rifty-no-coi/1/after.json) | {"start":"2026-10-08T19:30:22.404Z","judgeStart":"2026-10-08T19:30:25.629Z","judgeEnd":"2026-10-08T19:31:02.917Z","complete":"2026-10-08T19:31:03.516Z"} |
| booking-workflow-v8-original/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-original/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-original/local-reference/1/trace.json) | [booking-workflow-v8-original/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v8-original/local-reference/1/before.json) / [booking-workflow-v8-original/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v8-original/local-reference/1/after.json) | {"start":"2026-10-08T19:31:03.521Z","judgeStart":"2026-10-08T19:31:05.955Z","judgeEnd":"2026-10-08T19:31:50.529Z","complete":"2026-10-08T19:31:51.843Z"} |
| booking-workflow-v8-original/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-original/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-original/native-codex/1/trace.json) | [booking-workflow-v8-original/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v8-original/native-codex/1/before.json) / [booking-workflow-v8-original/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v8-original/native-codex/1/after.json) | {"start":"2026-10-08T19:31:51.852Z","judgeStart":"2026-10-08T19:31:57.247Z","judgeEnd":"2026-10-08T19:33:08.119Z","complete":"2026-10-08T19:33:09.797Z"} |
| booking-workflow-v8-discard/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-discard/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty/1/trace.json) | [booking-workflow-v8-discard/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty/1/before.json) / [booking-workflow-v8-discard/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty/1/after.json) | {"start":"2026-10-08T19:33:09.809Z","judgeStart":"2026-10-08T19:33:22.763Z","judgeEnd":"2026-10-08T19:34:36.950Z","complete":"2026-10-08T19:34:38.297Z"} |
| booking-workflow-v8-discard/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-discard/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty-no-coi/1/trace.json) | [booking-workflow-v8-discard/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty-no-coi/1/before.json) / [booking-workflow-v8-discard/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v8-discard/rifty-no-coi/1/after.json) | {"start":"2026-10-08T19:34:38.308Z","judgeStart":"2026-10-08T19:34:40.769Z","judgeEnd":"2026-10-08T19:35:18.944Z","complete":"2026-10-08T19:35:19.579Z"} |
| booking-workflow-v8-discard/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-discard/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-discard/local-reference/1/trace.json) | [booking-workflow-v8-discard/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v8-discard/local-reference/1/before.json) / [booking-workflow-v8-discard/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v8-discard/local-reference/1/after.json) | {"start":"2026-10-08T19:35:19.587Z","judgeStart":"2026-10-08T19:35:22.364Z","judgeEnd":"2026-10-08T19:35:53.577Z","complete":"2026-10-08T19:35:54.251Z"} |
| booking-workflow-v8-discard/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-discard/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-discard/native-codex/1/trace.json) | [booking-workflow-v8-discard/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v8-discard/native-codex/1/before.json) / [booking-workflow-v8-discard/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v8-discard/native-codex/1/after.json) | {"start":"2026-10-08T19:35:54.260Z","judgeStart":"2026-10-08T19:35:56.933Z","judgeEnd":"2026-10-08T19:36:26.527Z","complete":"2026-10-08T19:36:27.000Z"} |
| booking-workflow-v8-decorated/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-decorated/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty/1/trace.json) | [booking-workflow-v8-decorated/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty/1/before.json) / [booking-workflow-v8-decorated/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty/1/after.json) | {"start":"2026-10-08T19:36:27.008Z","judgeStart":"2026-10-08T19:36:36.969Z","judgeEnd":"2026-10-08T19:37:13.551Z","complete":"2026-10-08T19:37:14.928Z"} |
| booking-workflow-v8-decorated/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v8-decorated/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty-no-coi/1/trace.json) | [booking-workflow-v8-decorated/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty-no-coi/1/before.json) / [booking-workflow-v8-decorated/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v8-decorated/rifty-no-coi/1/after.json) | {"start":"2026-10-08T19:37:14.939Z","judgeStart":"2026-10-08T19:37:17.895Z","judgeEnd":"2026-10-08T19:37:54.554Z","complete":"2026-10-08T19:37:55.084Z"} |
| booking-workflow-v8-decorated/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-decorated/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-decorated/local-reference/1/trace.json) | [booking-workflow-v8-decorated/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v8-decorated/local-reference/1/before.json) / [booking-workflow-v8-decorated/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v8-decorated/local-reference/1/after.json) | {"start":"2026-10-08T19:37:55.097Z","judgeStart":"2026-10-08T19:37:57.485Z","judgeEnd":"2026-10-08T19:38:26.785Z","complete":"2026-10-08T19:38:27.265Z"} |
| booking-workflow-v8-decorated/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v8-decorated/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v8-decorated/native-codex/1/trace.json) | [booking-workflow-v8-decorated/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v8-decorated/native-codex/1/before.json) / [booking-workflow-v8-decorated/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v8-decorated/native-codex/1/after.json) | {"start":"2026-10-08T19:38:27.273Z","judgeStart":"2026-10-08T19:38:30.010Z","judgeEnd":"2026-10-08T19:38:55.902Z","complete":"2026-10-08T19:38:56.363Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 12; retained 12; missing 0.
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
| booking-workflow-v8-original | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-original | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-original | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-original | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v8-discard | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-discard | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-discard | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-discard | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v8-decorated | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-decorated | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-decorated | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v8-decorated | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 3/1 | 3/3 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
