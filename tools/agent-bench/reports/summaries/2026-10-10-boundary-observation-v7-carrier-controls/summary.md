# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: d569a8d60e64be3a6a66deef005c5b4a66d1478e; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| obs-linked-message | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-message | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-message | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-message | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-bad-position | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-bad-position | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-bad-position | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-bad-position | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-undo-void | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-undo-void | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-undo-void | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-linked-undo-void | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-wrapped | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-wrapped | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-wrapped | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-wrapped | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-handled | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-handled | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-handled | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-handled | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-lost-query | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-lost-query | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-lost-query | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| obs-async-lost-query | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| obs-linked-message | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | 58687f73031e66f3f738f789869909534784bce18646e866530e2ad1fc088dd0 |
| obs-linked-bad-position | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | 58687f73031e66f3f738f789869909534784bce18646e866530e2ad1fc088dd0 |
| obs-linked-undo-void | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | e4b89c1a9ed19f5317a480003d4eec110261c856d645ad1c73592bce7043b7f8 |
| obs-async-wrapped | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 976195bc3e44101108501720994e191397fb17a63d562a799fbc5e7355bf231d |
| obs-async-handled | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 976195bc3e44101108501720994e191397fb17a63d562a799fbc5e7355bf231d |
| obs-async-lost-query | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 976195bc3e44101108501720994e191397fb17a63d562a799fbc5e7355bf231d |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| obs-linked-message/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-message/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-message/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-message/rifty/1/after.json | {"start":"2026-10-10T12:18:55.650Z","judgeStart":"2026-10-10T12:19:02.236Z","judgeEnd":"2026-10-10T12:19:05.703Z","complete":"2026-10-10T12:19:05.783Z"} |
| obs-linked-message/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-message/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-message/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-message/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:19:05.788Z","judgeStart":"2026-10-10T12:19:08.361Z","judgeEnd":"2026-10-10T12:19:09.447Z","complete":"2026-10-10T12:19:09.455Z"} |
| obs-linked-message/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-message/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-message/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-message/local-reference/1/after.json | {"start":"2026-10-10T12:19:09.458Z","judgeStart":"2026-10-10T12:19:10.679Z","judgeEnd":"2026-10-10T12:19:11.957Z","complete":"2026-10-10T12:19:11.968Z"} |
| obs-linked-message/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-message/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-message/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-message/native-codex/1/after.json | {"start":"2026-10-10T12:19:11.971Z","judgeStart":"2026-10-10T12:19:13.138Z","judgeEnd":"2026-10-10T12:19:14.389Z","complete":"2026-10-10T12:19:14.401Z"} |
| obs-linked-bad-position/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty/1/after.json | {"start":"2026-10-10T12:19:14.404Z","judgeStart":"2026-10-10T12:19:19.430Z","judgeEnd":"2026-10-10T12:19:22.870Z","complete":"2026-10-10T12:19:22.943Z"} |
| obs-linked-bad-position/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-bad-position/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:19:22.946Z","judgeStart":"2026-10-10T12:19:25.227Z","judgeEnd":"2026-10-10T12:19:26.306Z","complete":"2026-10-10T12:19:26.312Z"} |
| obs-linked-bad-position/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-bad-position/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-bad-position/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-bad-position/local-reference/1/after.json | {"start":"2026-10-10T12:19:26.316Z","judgeStart":"2026-10-10T12:19:27.452Z","judgeEnd":"2026-10-10T12:19:28.698Z","complete":"2026-10-10T12:19:28.709Z"} |
| obs-linked-bad-position/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-bad-position/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-bad-position/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-bad-position/native-codex/1/after.json | {"start":"2026-10-10T12:19:28.712Z","judgeStart":"2026-10-10T12:19:29.873Z","judgeEnd":"2026-10-10T12:19:31.031Z","complete":"2026-10-10T12:19:31.041Z"} |
| obs-linked-undo-void/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty/1/after.json | {"start":"2026-10-10T12:19:31.045Z","judgeStart":"2026-10-10T12:19:36.045Z","judgeEnd":"2026-10-10T12:19:39.983Z","complete":"2026-10-10T12:19:40.054Z"} |
| obs-linked-undo-void/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-undo-void/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:19:40.058Z","judgeStart":"2026-10-10T12:19:42.517Z","judgeEnd":"2026-10-10T12:19:43.585Z","complete":"2026-10-10T12:19:43.591Z"} |
| obs-linked-undo-void/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-undo-void/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-undo-void/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-undo-void/local-reference/1/after.json | {"start":"2026-10-10T12:19:43.595Z","judgeStart":"2026-10-10T12:19:44.773Z","judgeEnd":"2026-10-10T12:19:46.040Z","complete":"2026-10-10T12:19:46.050Z"} |
| obs-linked-undo-void/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-linked-undo-void/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-linked-undo-void/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-linked-undo-void/native-codex/1/after.json | {"start":"2026-10-10T12:19:46.053Z","judgeStart":"2026-10-10T12:19:47.202Z","judgeEnd":"2026-10-10T12:19:48.465Z","complete":"2026-10-10T12:19:48.475Z"} |
| obs-async-wrapped/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty/1/after.json | {"start":"2026-10-10T12:19:48.478Z","judgeStart":"2026-10-10T12:19:53.423Z","judgeEnd":"2026-10-10T12:19:57.835Z","complete":"2026-10-10T12:19:57.899Z"} |
| obs-async-wrapped/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-async-wrapped/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:19:57.903Z","judgeStart":"2026-10-10T12:20:00.151Z","judgeEnd":"2026-10-10T12:20:01.615Z","complete":"2026-10-10T12:20:01.622Z"} |
| obs-async-wrapped/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-wrapped/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-wrapped/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-async-wrapped/local-reference/1/after.json | {"start":"2026-10-10T12:20:01.626Z","judgeStart":"2026-10-10T12:20:02.708Z","judgeEnd":"2026-10-10T12:20:04.353Z","complete":"2026-10-10T12:20:04.363Z"} |
| obs-async-wrapped/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-wrapped/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-wrapped/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-async-wrapped/native-codex/1/after.json | {"start":"2026-10-10T12:20:04.367Z","judgeStart":"2026-10-10T12:20:05.469Z","judgeEnd":"2026-10-10T12:20:07.124Z","complete":"2026-10-10T12:20:07.135Z"} |
| obs-async-handled/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-handled/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-handled/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-async-handled/rifty/1/after.json | {"start":"2026-10-10T12:20:07.139Z","judgeStart":"2026-10-10T12:20:11.703Z","judgeEnd":"2026-10-10T12:20:15.663Z","complete":"2026-10-10T12:20:15.745Z"} |
| obs-async-handled/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-handled/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-handled/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-async-handled/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:20:15.749Z","judgeStart":"2026-10-10T12:20:18.154Z","judgeEnd":"2026-10-10T12:20:19.644Z","complete":"2026-10-10T12:20:19.650Z"} |
| obs-async-handled/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-handled/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-handled/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-async-handled/local-reference/1/after.json | {"start":"2026-10-10T12:20:19.654Z","judgeStart":"2026-10-10T12:20:20.928Z","judgeEnd":"2026-10-10T12:20:22.557Z","complete":"2026-10-10T12:20:22.568Z"} |
| obs-async-handled/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-handled/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-handled/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-async-handled/native-codex/1/after.json | {"start":"2026-10-10T12:20:22.571Z","judgeStart":"2026-10-10T12:20:23.682Z","judgeEnd":"2026-10-10T12:20:25.248Z","complete":"2026-10-10T12:20:25.258Z"} |
| obs-async-lost-query/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty/1/before.json / [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty/1/after.json | {"start":"2026-10-10T12:20:25.262Z","judgeStart":"2026-10-10T12:20:30.794Z","judgeEnd":"2026-10-10T12:20:34.771Z","complete":"2026-10-10T12:20:34.844Z"} |
| obs-async-lost-query/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): obs-async-lost-query/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:20:34.848Z","judgeStart":"2026-10-10T12:20:37.424Z","judgeEnd":"2026-10-10T12:20:38.774Z","complete":"2026-10-10T12:20:38.781Z"} |
| obs-async-lost-query/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-lost-query/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-lost-query/local-reference/1/before.json / [bundle](source-artifacts.json.gz): obs-async-lost-query/local-reference/1/after.json | {"start":"2026-10-10T12:20:38.785Z","judgeStart":"2026-10-10T12:20:39.919Z","judgeEnd":"2026-10-10T12:20:41.507Z","complete":"2026-10-10T12:20:41.517Z"} |
| obs-async-lost-query/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): obs-async-lost-query/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): obs-async-lost-query/native-codex/1/before.json / [bundle](source-artifacts.json.gz): obs-async-lost-query/native-codex/1/after.json | {"start":"2026-10-10T12:20:41.521Z","judgeStart":"2026-10-10T12:20:42.618Z","judgeEnd":"2026-10-10T12:20:44.108Z","complete":"2026-10-10T12:20:44.119Z"} |

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
| obs-linked-message | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-message | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-message | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-message | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| obs-linked-bad-position | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-linked-bad-position | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-linked-bad-position | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-linked-bad-position | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| obs-linked-undo-void | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-undo-void | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-undo-void | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-linked-undo-void | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| obs-async-wrapped | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-wrapped | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-wrapped | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-wrapped | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| obs-async-handled | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-handled | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-handled | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| obs-async-handled | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| obs-async-lost-query | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-async-lost-query | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-async-lost-query | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| obs-async-lost-query | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 6/2 | 4/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
