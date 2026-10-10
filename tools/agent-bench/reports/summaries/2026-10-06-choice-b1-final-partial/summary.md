# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v2; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 6326c8dd5ceeffd2dc1456f153f50c6fdbe790a4; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| booking-workflow-v2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v2 | rifty | 1 | fail | not-run | 0.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| booking-workflow-v2 | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | ba3943b0aa8fd36549e77cc19c3abaf9badf0f6e176a815c97763f31fcf80a49 |
| expense-settlement-v2 | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | 3ce40ac4a1eeeded3502ecfe40cb55eb7aa8b02e4b1a5965ceadecd533897add |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| booking-workflow-v2/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty/1/after.json | {"start":"2026-10-06T09:31:09.983Z","judgeStart":"2026-10-06T09:31:20.110Z","judgeEnd":"2026-10-06T09:31:31.021Z","complete":"2026-10-06T09:31:31.391Z"} |
| booking-workflow-v2/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v2/rifty-no-coi/1/after.json | {"start":"2026-10-06T09:31:31.403Z","judgeStart":"2026-10-06T09:31:34.451Z","judgeEnd":"2026-10-06T09:31:43.999Z","complete":"2026-10-06T09:31:44.192Z"} |
| booking-workflow-v2/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v2/local-reference/1/after.json | {"start":"2026-10-06T09:31:44.199Z","judgeStart":"2026-10-06T09:31:47.159Z","judgeEnd":"2026-10-06T09:31:53.191Z","complete":"2026-10-06T09:31:53.388Z"} |
| booking-workflow-v2/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v2/native-codex/1/after.json | {"start":"2026-10-06T09:31:53.392Z","judgeStart":"2026-10-06T09:31:56.032Z","judgeEnd":"2026-10-06T09:32:02.041Z","complete":"2026-10-06T09:32:02.210Z"} |
| expense-settlement-v2/rifty/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty/1/after.json | {"start":"2026-10-06T09:32:02.213Z","judgeStart":"2026-10-06T09:32:11.637Z","judgeEnd":"2026-10-06T09:32:14.054Z","complete":"2026-10-06T09:32:14.149Z"} |
| expense-settlement-v2/rifty-no-coi/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v2/rifty-no-coi/1/after.json | {"start":"2026-10-06T09:32:14.153Z","judgeStart":"2026-10-06T09:32:18.577Z","judgeEnd":"2026-10-06T09:32:25.240Z","complete":"2026-10-06T09:32:25.308Z"} |
| expense-settlement-v2/local-reference/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement-v2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v2/local-reference/1/after.json | {"start":"2026-10-06T09:32:25.313Z","judgeStart":"2026-10-06T09:32:28.222Z","judgeEnd":"2026-10-06T09:32:33.215Z","complete":"2026-10-06T09:32:33.287Z"} |
| expense-settlement-v2/native-codex/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement-v2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v2/native-codex/1/after.json | {"start":"2026-10-06T09:32:33.291Z","judgeStart":"2026-10-06T09:32:36.094Z","judgeEnd":"2026-10-06T09:32:40.640Z","complete":"2026-10-06T09:32:40.710Z"} |

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
| booking-workflow-v2 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| booking-workflow-v2 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| booking-workflow-v2 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| booking-workflow-v2 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| expense-settlement-v2 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| expense-settlement-v2 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| expense-settlement-v2 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| expense-settlement-v2 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
