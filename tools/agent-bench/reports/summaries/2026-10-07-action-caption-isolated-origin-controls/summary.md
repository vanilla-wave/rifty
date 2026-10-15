# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v8; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 2ffb1e063c458b4382462ccacb7ad1b6377a762f (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| booking-workflow-v5-yaml-alias-room-commit | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-room-commit | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-room-commit | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-room-commit | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-reservation-commit | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-reservation-commit | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-reservation-commit | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow-v5-yaml-alias-reservation-commit | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v5-yaml-alias-expense-commit | rifty | 1 | fail | not-run | 0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v5-yaml-alias-expense-commit | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v5-yaml-alias-expense-commit | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement-v5-yaml-alias-expense-commit | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| booking-workflow-v5-yaml-alias-room-commit | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 6f9d6eb342bbb3365e9a742fc33de81161cd12b3bbc8cd6296686ab0814fc3d5 |
| booking-workflow-v5-yaml-alias-reservation-commit | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 6f9d6eb342bbb3365e9a742fc33de81161cd12b3bbc8cd6296686ab0814fc3d5 |
| expense-settlement-v5-yaml-alias-expense-commit | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | cef58bbee5cd58c3fe71273b5ade66971b430b04c522ac4c46e531709c7c88fa |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| booking-workflow-v5-yaml-alias-room-commit/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty/1/after.json | {"start":"2026-10-07T14:58:04.404Z","judgeStart":"2026-10-07T14:58:15.425Z","judgeEnd":"2026-10-07T14:58:30.897Z","complete":"2026-10-07T14:58:31.461Z"} |
| booking-workflow-v5-yaml-alias-room-commit/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/rifty-no-coi/1/after.json | {"start":"2026-10-07T14:58:31.464Z","judgeStart":"2026-10-07T14:58:34.616Z","judgeEnd":"2026-10-07T14:58:48.991Z","complete":"2026-10-07T14:58:49.266Z"} |
| booking-workflow-v5-yaml-alias-room-commit/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/local-reference/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/local-reference/1/after.json | {"start":"2026-10-07T14:58:49.270Z","judgeStart":"2026-10-07T14:58:51.629Z","judgeEnd":"2026-10-07T14:59:01.766Z","complete":"2026-10-07T14:59:02.012Z"} |
| booking-workflow-v5-yaml-alias-room-commit/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/native-codex/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-room-commit/native-codex/1/after.json | {"start":"2026-10-07T14:59:02.016Z","judgeStart":"2026-10-07T14:59:04.325Z","judgeEnd":"2026-10-07T14:59:14.582Z","complete":"2026-10-07T14:59:14.815Z"} |
| booking-workflow-v5-yaml-alias-reservation-commit/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty/1/after.json | {"start":"2026-10-07T14:59:14.820Z","judgeStart":"2026-10-07T14:59:25.347Z","judgeEnd":"2026-10-07T14:59:43.667Z","complete":"2026-10-07T14:59:44.303Z"} |
| booking-workflow-v5-yaml-alias-reservation-commit/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/rifty-no-coi/1/after.json | {"start":"2026-10-07T14:59:44.312Z","judgeStart":"2026-10-07T14:59:46.571Z","judgeEnd":"2026-10-07T15:00:04.206Z","complete":"2026-10-07T15:00:04.544Z"} |
| booking-workflow-v5-yaml-alias-reservation-commit/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/local-reference/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/local-reference/1/after.json | {"start":"2026-10-07T15:00:04.550Z","judgeStart":"2026-10-07T15:00:07.267Z","judgeEnd":"2026-10-07T15:00:19.721Z","complete":"2026-10-07T15:00:20.015Z"} |
| booking-workflow-v5-yaml-alias-reservation-commit/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/native-codex/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow-v5-yaml-alias-reservation-commit/native-codex/1/after.json | {"start":"2026-10-07T15:00:20.021Z","judgeStart":"2026-10-07T15:00:22.350Z","judgeEnd":"2026-10-07T15:00:34.646Z","complete":"2026-10-07T15:00:34.933Z"} |
| expense-settlement-v5-yaml-alias-expense-commit/rifty/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty/1/after.json | {"start":"2026-10-07T15:00:34.939Z","judgeStart":"2026-10-07T15:00:43.161Z","judgeEnd":"2026-10-07T15:00:45.242Z","complete":"2026-10-07T15:00:45.324Z"} |
| expense-settlement-v5-yaml-alias-expense-commit/rifty-no-coi/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/rifty-no-coi/1/after.json | {"start":"2026-10-07T15:00:45.330Z","judgeStart":"2026-10-07T15:00:47.603Z","judgeEnd":"2026-10-07T15:00:55.937Z","complete":"2026-10-07T15:00:56.030Z"} |
| expense-settlement-v5-yaml-alias-expense-commit/local-reference/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/local-reference/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/local-reference/1/after.json | {"start":"2026-10-07T15:00:56.037Z","judgeStart":"2026-10-07T15:00:58.876Z","judgeEnd":"2026-10-07T15:01:05.795Z","complete":"2026-10-07T15:01:05.891Z"} |
| expense-settlement-v5-yaml-alias-expense-commit/native-codex/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/native-codex/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement-v5-yaml-alias-expense-commit/native-codex/1/after.json | {"start":"2026-10-07T15:01:05.897Z","judgeStart":"2026-10-07T15:01:08.690Z","judgeEnd":"2026-10-07T15:01:15.611Z","complete":"2026-10-07T15:01:15.706Z"} |

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
| booking-workflow-v5-yaml-alias-room-commit | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-room-commit | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-room-commit | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-room-commit | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-reservation-commit | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-reservation-commit | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-reservation-commit | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v5-yaml-alias-reservation-commit | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| expense-settlement-v5-yaml-alias-expense-commit | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| expense-settlement-v5-yaml-alias-expense-commit | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement-v5-yaml-alias-expense-commit | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement-v5-yaml-alias-expense-commit | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | app | rifty | 3/2 | 2/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 3/2 | 2/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 3/2 | 3/3 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
