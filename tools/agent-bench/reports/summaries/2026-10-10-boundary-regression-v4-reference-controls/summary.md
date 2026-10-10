# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 32530444ffa7634edfec68816bb036ab0511130c; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 24; retained 24.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| linked-import-1 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| linked-import-1 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | f8fba33eb016125b9ab81a33d3d428b7e8ed5c01c220f01535f5b5c324f92a54 |
| linked-import-2 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | 81e899bb134f645ff6a5eefd0f7e6d3b2f508b09e1557a3a7bc43958a9ddf35d |
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | ad6cf6ef7175ecb7fee63a9c66e60565b9fca7a3b811a54ca75c43cda82ce926 |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 1c03a761e355cac968e07e13fcaa4a2d6efc87ddfd1a95c1e0dcbfc3cb1a0f07 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | ed034985a353d4fd086eed79f877ada0133885733baa7c44457c87263b4d28df |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | b73ef8c869946995cc72ba033db882eee255692a6670e7993b2beea45b302d30 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| linked-import-1/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/after.json | {"start":"2026-10-10T10:10:38.240Z","judgeStart":"2026-10-10T10:10:44.741Z","judgeEnd":"2026-10-10T10:10:48.674Z","complete":"2026-10-10T10:10:48.763Z"} |
| linked-import-1/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:10:48.766Z","judgeStart":"2026-10-10T10:10:51.320Z","judgeEnd":"2026-10-10T10:10:52.409Z","complete":"2026-10-10T10:10:52.414Z"} |
| linked-import-1/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/after.json | {"start":"2026-10-10T10:10:52.417Z","judgeStart":"2026-10-10T10:10:53.631Z","judgeEnd":"2026-10-10T10:10:55.010Z","complete":"2026-10-10T10:10:55.020Z"} |
| linked-import-1/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/after.json | {"start":"2026-10-10T10:10:55.023Z","judgeStart":"2026-10-10T10:10:56.134Z","judgeEnd":"2026-10-10T10:10:57.420Z","complete":"2026-10-10T10:10:57.431Z"} |
| linked-import-2/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/after.json | {"start":"2026-10-10T10:10:57.436Z","judgeStart":"2026-10-10T10:11:02.214Z","judgeEnd":"2026-10-10T10:11:06.100Z","complete":"2026-10-10T10:11:06.172Z"} |
| linked-import-2/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:11:06.177Z","judgeStart":"2026-10-10T10:11:08.469Z","judgeEnd":"2026-10-10T10:11:09.552Z","complete":"2026-10-10T10:11:09.559Z"} |
| linked-import-2/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/after.json | {"start":"2026-10-10T10:11:09.562Z","judgeStart":"2026-10-10T10:11:10.634Z","judgeEnd":"2026-10-10T10:11:11.895Z","complete":"2026-10-10T10:11:11.906Z"} |
| linked-import-2/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/after.json | {"start":"2026-10-10T10:11:11.910Z","judgeStart":"2026-10-10T10:11:13.190Z","judgeEnd":"2026-10-10T10:11:14.401Z","complete":"2026-10-10T10:11:14.411Z"} |
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-10T10:11:14.415Z","judgeStart":"2026-10-10T10:11:19.251Z","judgeEnd":"2026-10-10T10:11:23.746Z","complete":"2026-10-10T10:11:23.831Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:11:23.836Z","judgeStart":"2026-10-10T10:11:26.117Z","judgeEnd":"2026-10-10T10:11:27.392Z","complete":"2026-10-10T10:11:27.399Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-10T10:11:27.403Z","judgeStart":"2026-10-10T10:11:28.459Z","judgeEnd":"2026-10-10T10:11:29.935Z","complete":"2026-10-10T10:11:29.945Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-10T10:11:29.949Z","judgeStart":"2026-10-10T10:11:31.121Z","judgeEnd":"2026-10-10T10:11:32.553Z","complete":"2026-10-10T10:11:32.564Z"} |
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-10T10:11:32.568Z","judgeStart":"2026-10-10T10:11:37.657Z","judgeEnd":"2026-10-10T10:11:42.158Z","complete":"2026-10-10T10:11:42.255Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:11:42.265Z","judgeStart":"2026-10-10T10:11:44.432Z","judgeEnd":"2026-10-10T10:11:45.901Z","complete":"2026-10-10T10:11:45.908Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-10T10:11:45.911Z","judgeStart":"2026-10-10T10:11:47.029Z","judgeEnd":"2026-10-10T10:11:48.568Z","complete":"2026-10-10T10:11:48.578Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-10T10:11:48.582Z","judgeStart":"2026-10-10T10:11:49.695Z","judgeEnd":"2026-10-10T10:11:51.327Z","complete":"2026-10-10T10:11:51.338Z"} |
| indexed-data-1/rifty/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/after.json | {"start":"2026-10-10T10:11:51.342Z","judgeStart":"2026-10-10T10:11:57.802Z","judgeEnd":"2026-10-10T10:11:59.675Z","complete":"2026-10-10T10:11:59.785Z"} |
| indexed-data-1/rifty-no-coi/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:11:59.789Z","judgeStart":"2026-10-10T10:12:02.329Z","judgeEnd":"2026-10-10T10:12:03.962Z","complete":"2026-10-10T10:12:03.995Z"} |
| indexed-data-1/local-reference/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/after.json | {"start":"2026-10-10T10:12:04.000Z","judgeStart":"2026-10-10T10:12:05.909Z","judgeEnd":"2026-10-10T10:12:07.295Z","complete":"2026-10-10T10:12:07.323Z"} |
| indexed-data-1/native-codex/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/after.json | {"start":"2026-10-10T10:12:07.327Z","judgeStart":"2026-10-10T10:12:09.473Z","judgeEnd":"2026-10-10T10:12:10.871Z","complete":"2026-10-10T10:12:10.907Z"} |
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-10T10:12:10.911Z","judgeStart":"2026-10-10T10:12:16.983Z","judgeEnd":"2026-10-10T10:12:23.129Z","complete":"2026-10-10T10:12:23.250Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:12:23.258Z","judgeStart":"2026-10-10T10:12:25.453Z","judgeEnd":"2026-10-10T10:12:31.911Z","complete":"2026-10-10T10:12:31.951Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-10T10:12:31.955Z","judgeStart":"2026-10-10T10:12:33.871Z","judgeEnd":"2026-10-10T10:12:40.014Z","complete":"2026-10-10T10:12:40.058Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-10T10:12:40.063Z","judgeStart":"2026-10-10T10:12:41.970Z","judgeEnd":"2026-10-10T10:12:48.111Z","complete":"2026-10-10T10:12:48.150Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 24; retained 24; missing 0.
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
| linked-import-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| linked-import-2 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-2 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-2 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| linked-import-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
