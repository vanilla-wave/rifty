# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v12; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: fe6a80fdf57621fa2267f4f2f876da143a300907 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 16; retained 16.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| booking-workflow-v9-original | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-original | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-original | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-original | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-discard | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-discard | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-discard | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-discard | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-decorated | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-decorated | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-decorated | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-decorated | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-asymmetric | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-asymmetric | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-asymmetric | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v9-asymmetric | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| booking-workflow-v9-original | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 45989f4d3894b86975895bb2b741dba9d68e0752f180548cc41680be9fca1698 |
| booking-workflow-v9-discard | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 45989f4d3894b86975895bb2b741dba9d68e0752f180548cc41680be9fca1698 |
| booking-workflow-v9-decorated | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 45989f4d3894b86975895bb2b741dba9d68e0752f180548cc41680be9fca1698 |
| booking-workflow-v9-asymmetric | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 45989f4d3894b86975895bb2b741dba9d68e0752f180548cc41680be9fca1698 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| booking-workflow-v9-original/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-original/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty/1/trace.json) | [booking-workflow-v9-original/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty/1/before.json) / [booking-workflow-v9-original/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty/1/after.json) | {"start":"2026-10-08T20:20:17.758Z","judgeStart":"2026-10-08T20:20:27.231Z","judgeEnd":"2026-10-08T20:20:57.727Z","complete":"2026-10-08T20:20:58.592Z"} |
| booking-workflow-v9-original/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-original/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty-no-coi/1/trace.json) | [booking-workflow-v9-original/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty-no-coi/1/before.json) / [booking-workflow-v9-original/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v9-original/rifty-no-coi/1/after.json) | {"start":"2026-10-08T20:20:58.595Z","judgeStart":"2026-10-08T20:21:01.601Z","judgeEnd":"2026-10-08T20:21:30.287Z","complete":"2026-10-08T20:21:30.742Z"} |
| booking-workflow-v9-original/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-original/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-original/local-reference/1/trace.json) | [booking-workflow-v9-original/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v9-original/local-reference/1/before.json) / [booking-workflow-v9-original/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v9-original/local-reference/1/after.json) | {"start":"2026-10-08T20:21:30.745Z","judgeStart":"2026-10-08T20:21:33.497Z","judgeEnd":"2026-10-08T20:21:57.312Z","complete":"2026-10-08T20:21:57.720Z"} |
| booking-workflow-v9-original/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-original/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-original/native-codex/1/trace.json) | [booking-workflow-v9-original/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v9-original/native-codex/1/before.json) / [booking-workflow-v9-original/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v9-original/native-codex/1/after.json) | {"start":"2026-10-08T20:21:57.724Z","judgeStart":"2026-10-08T20:22:00.347Z","judgeEnd":"2026-10-08T20:22:24.115Z","complete":"2026-10-08T20:22:24.524Z"} |
| booking-workflow-v9-discard/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-discard/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty/1/trace.json) | [booking-workflow-v9-discard/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty/1/before.json) / [booking-workflow-v9-discard/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty/1/after.json) | {"start":"2026-10-08T20:22:24.529Z","judgeStart":"2026-10-08T20:22:33.943Z","judgeEnd":"2026-10-08T20:23:05.169Z","complete":"2026-10-08T20:23:06.010Z"} |
| booking-workflow-v9-discard/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-discard/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty-no-coi/1/trace.json) | [booking-workflow-v9-discard/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty-no-coi/1/before.json) / [booking-workflow-v9-discard/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v9-discard/rifty-no-coi/1/after.json) | {"start":"2026-10-08T20:23:06.014Z","judgeStart":"2026-10-08T20:23:09.066Z","judgeEnd":"2026-10-08T20:23:37.747Z","complete":"2026-10-08T20:23:38.194Z"} |
| booking-workflow-v9-discard/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-discard/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-discard/local-reference/1/trace.json) | [booking-workflow-v9-discard/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v9-discard/local-reference/1/before.json) / [booking-workflow-v9-discard/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v9-discard/local-reference/1/after.json) | {"start":"2026-10-08T20:23:38.199Z","judgeStart":"2026-10-08T20:23:40.921Z","judgeEnd":"2026-10-08T20:24:04.955Z","complete":"2026-10-08T20:24:05.388Z"} |
| booking-workflow-v9-discard/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-discard/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-discard/native-codex/1/trace.json) | [booking-workflow-v9-discard/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v9-discard/native-codex/1/before.json) / [booking-workflow-v9-discard/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v9-discard/native-codex/1/after.json) | {"start":"2026-10-08T20:24:05.394Z","judgeStart":"2026-10-08T20:24:08.037Z","judgeEnd":"2026-10-08T20:24:31.850Z","complete":"2026-10-08T20:24:32.254Z"} |
| booking-workflow-v9-decorated/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-decorated/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty/1/trace.json) | [booking-workflow-v9-decorated/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty/1/before.json) / [booking-workflow-v9-decorated/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty/1/after.json) | {"start":"2026-10-08T20:24:32.260Z","judgeStart":"2026-10-08T20:24:41.228Z","judgeEnd":"2026-10-08T20:25:11.678Z","complete":"2026-10-08T20:25:12.519Z"} |
| booking-workflow-v9-decorated/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-decorated/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty-no-coi/1/trace.json) | [booking-workflow-v9-decorated/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty-no-coi/1/before.json) / [booking-workflow-v9-decorated/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v9-decorated/rifty-no-coi/1/after.json) | {"start":"2026-10-08T20:25:12.525Z","judgeStart":"2026-10-08T20:25:14.676Z","judgeEnd":"2026-10-08T20:25:43.091Z","complete":"2026-10-08T20:25:43.530Z"} |
| booking-workflow-v9-decorated/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-decorated/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-decorated/local-reference/1/trace.json) | [booking-workflow-v9-decorated/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v9-decorated/local-reference/1/before.json) / [booking-workflow-v9-decorated/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v9-decorated/local-reference/1/after.json) | {"start":"2026-10-08T20:25:43.539Z","judgeStart":"2026-10-08T20:25:46.281Z","judgeEnd":"2026-10-08T20:26:10.140Z","complete":"2026-10-08T20:26:10.562Z"} |
| booking-workflow-v9-decorated/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-decorated/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-decorated/native-codex/1/trace.json) | [booking-workflow-v9-decorated/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v9-decorated/native-codex/1/before.json) / [booking-workflow-v9-decorated/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v9-decorated/native-codex/1/after.json) | {"start":"2026-10-08T20:26:10.570Z","judgeStart":"2026-10-08T20:26:13.209Z","judgeEnd":"2026-10-08T20:26:36.851Z","complete":"2026-10-08T20:26:37.262Z"} |
| booking-workflow-v9-asymmetric/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-asymmetric/rifty/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty/1/trace.json) | [booking-workflow-v9-asymmetric/rifty/1/before.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty/1/before.json) / [booking-workflow-v9-asymmetric/rifty/1/after.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty/1/after.json) | {"start":"2026-10-08T20:26:37.269Z","judgeStart":"2026-10-08T20:26:46.816Z","judgeEnd":"2026-10-08T20:27:17.759Z","complete":"2026-10-08T20:27:18.511Z"} |
| booking-workflow-v9-asymmetric/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [booking-workflow-v9-asymmetric/rifty-no-coi/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty-no-coi/1/trace.json) | [booking-workflow-v9-asymmetric/rifty-no-coi/1/before.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty-no-coi/1/before.json) / [booking-workflow-v9-asymmetric/rifty-no-coi/1/after.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/rifty-no-coi/1/after.json) | {"start":"2026-10-08T20:27:18.523Z","judgeStart":"2026-10-08T20:27:21.550Z","judgeEnd":"2026-10-08T20:27:50.179Z","complete":"2026-10-08T20:27:50.635Z"} |
| booking-workflow-v9-asymmetric/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-asymmetric/local-reference/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/local-reference/1/trace.json) | [booking-workflow-v9-asymmetric/local-reference/1/before.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/local-reference/1/before.json) / [booking-workflow-v9-asymmetric/local-reference/1/after.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/local-reference/1/after.json) | {"start":"2026-10-08T20:27:50.644Z","judgeStart":"2026-10-08T20:27:53.447Z","judgeEnd":"2026-10-08T20:28:17.421Z","complete":"2026-10-08T20:28:17.832Z"} |
| booking-workflow-v9-asymmetric/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [booking-workflow-v9-asymmetric/native-codex/1/trace.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/native-codex/1/trace.json) | [booking-workflow-v9-asymmetric/native-codex/1/before.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/native-codex/1/before.json) / [booking-workflow-v9-asymmetric/native-codex/1/after.json](source-artifacts.json.gz#booking-workflow-v9-asymmetric/native-codex/1/after.json) | {"start":"2026-10-08T20:28:17.841Z","judgeStart":"2026-10-08T20:28:20.412Z","judgeEnd":"2026-10-08T20:28:44.688Z","complete":"2026-10-08T20:28:45.132Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 16; retained 16; missing 0.
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
| booking-workflow-v9-original | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-original | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-original | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-original | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v9-discard | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-discard | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-discard | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-discard | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v9-decorated | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-decorated | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-decorated | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-decorated | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v9-asymmetric | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-asymmetric | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-asymmetric | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v9-asymmetric | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/1 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
