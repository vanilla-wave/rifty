# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 8065464894ec16515f5c6aaa5205ef4f04837410; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 32; retained 32.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| linked-import-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty | 1 | fail | not-run | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty-no-coi | 1 | fail | not-run | 2.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| indexed-data-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| linked-import-1 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | c3972f888152ad1fe9f5c94841db03f1e3296298d87b7b1d66bb5fc1891329f5 |
| linked-import-2 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | 7b3e96c54b04713f12fdc74300ef355a0a24e0b098ed6bae46e9fe3a1dcafb6e |
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 4fb78d0e83e6aa647e8efb860c293e6b0cb61f424d78bcd355a00c85b9fe2d76 |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 047287e24aec62d27798fedae2b69c0b3ab7f81448736b57962a3e8b5de413d3 |
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | 70a5c08defd562eff180c623393f79b21485539696f510bff5900c2fa7267385 |
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | 1db570781883fe6a9403e9aeae96c5e636135fe55cdaf18527b1b281845f8ad4 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | 21061ecb3e43d032b1625f7f154b88a6ea5483333a35c92f3ebef8499f6985ad |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | ff5c779c6edb7fc2eca7743b1fc1245049b3ca56710a90f1b786a092bd4fbb1a |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| linked-import-1/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/after.json | {"start":"2026-10-09T17:40:36.796Z","judgeStart":"2026-10-09T17:40:44.427Z","judgeEnd":"2026-10-09T17:40:45.063Z","complete":"2026-10-09T17:40:45.120Z"} |
| linked-import-1/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:40:45.124Z","judgeStart":"2026-10-09T17:40:48.395Z","judgeEnd":"2026-10-09T17:40:48.435Z","complete":"2026-10-09T17:40:48.442Z"} |
| linked-import-1/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/after.json | {"start":"2026-10-09T17:40:48.446Z","judgeStart":"2026-10-09T17:40:49.624Z","judgeEnd":"2026-10-09T17:40:49.663Z","complete":"2026-10-09T17:40:49.667Z"} |
| linked-import-1/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/after.json | {"start":"2026-10-09T17:40:49.670Z","judgeStart":"2026-10-09T17:40:50.741Z","judgeEnd":"2026-10-09T17:40:50.783Z","complete":"2026-10-09T17:40:50.788Z"} |
| linked-import-2/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/after.json | {"start":"2026-10-09T17:40:50.791Z","judgeStart":"2026-10-09T17:40:56.841Z","judgeEnd":"2026-10-09T17:40:57.410Z","complete":"2026-10-09T17:40:57.439Z"} |
| linked-import-2/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:40:57.442Z","judgeStart":"2026-10-09T17:41:00.180Z","judgeEnd":"2026-10-09T17:41:00.223Z","complete":"2026-10-09T17:41:00.229Z"} |
| linked-import-2/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/after.json | {"start":"2026-10-09T17:41:00.232Z","judgeStart":"2026-10-09T17:41:01.448Z","judgeEnd":"2026-10-09T17:41:01.486Z","complete":"2026-10-09T17:41:01.490Z"} |
| linked-import-2/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/after.json | {"start":"2026-10-09T17:41:01.493Z","judgeStart":"2026-10-09T17:41:02.579Z","judgeEnd":"2026-10-09T17:41:02.617Z","complete":"2026-10-09T17:41:02.621Z"} |
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-09T17:41:02.624Z","judgeStart":"2026-10-09T17:41:08.168Z","judgeEnd":"2026-10-09T17:41:08.703Z","complete":"2026-10-09T17:41:08.750Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:41:08.753Z","judgeStart":"2026-10-09T17:41:12.052Z","judgeEnd":"2026-10-09T17:41:12.096Z","complete":"2026-10-09T17:41:12.103Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-09T17:41:12.107Z","judgeStart":"2026-10-09T17:41:13.615Z","judgeEnd":"2026-10-09T17:41:13.655Z","complete":"2026-10-09T17:41:13.659Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-09T17:41:13.662Z","judgeStart":"2026-10-09T17:41:14.796Z","judgeEnd":"2026-10-09T17:41:14.835Z","complete":"2026-10-09T17:41:14.840Z"} |
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-09T17:41:14.843Z","judgeStart":"2026-10-09T17:41:21.007Z","judgeEnd":"2026-10-09T17:41:21.559Z","complete":"2026-10-09T17:41:21.596Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:41:21.599Z","judgeStart":"2026-10-09T17:41:24.809Z","judgeEnd":"2026-10-09T17:41:24.855Z","complete":"2026-10-09T17:41:24.861Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-09T17:41:24.865Z","judgeStart":"2026-10-09T17:41:26.112Z","judgeEnd":"2026-10-09T17:41:26.150Z","complete":"2026-10-09T17:41:26.154Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-09T17:41:26.157Z","judgeStart":"2026-10-09T17:41:27.275Z","judgeEnd":"2026-10-09T17:41:27.314Z","complete":"2026-10-09T17:41:27.319Z"} |
| compiler-dependency-1/rifty/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/after.json | {"start":"2026-10-09T17:41:27.322Z","judgeStart":"2026-10-09T17:41:34.792Z","judgeEnd":"2026-10-09T17:42:35.730Z","complete":"2026-10-09T17:42:36.010Z"} |
| compiler-dependency-1/rifty-no-coi/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:42:36.019Z","judgeStart":"2026-10-09T17:42:39.478Z","judgeEnd":"2026-10-09T17:43:39.647Z","complete":"2026-10-09T17:43:39.670Z"} |
| compiler-dependency-1/local-reference/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/after.json | {"start":"2026-10-09T17:43:39.676Z","judgeStart":"2026-10-09T17:43:42.255Z","judgeEnd":"2026-10-09T17:44:42.228Z","complete":"2026-10-09T17:44:42.255Z"} |
| compiler-dependency-1/native-codex/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/after.json | {"start":"2026-10-09T17:44:42.261Z","judgeStart":"2026-10-09T17:44:44.883Z","judgeEnd":"2026-10-09T17:45:44.872Z","complete":"2026-10-09T17:45:44.899Z"} |
| compiler-dependency-2/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T17:45:44.904Z","complete":"2026-10-09T17:45:50.637Z"} |
| compiler-dependency-2/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T17:45:50.647Z","complete":"2026-10-09T17:45:53.026Z"} |
| compiler-dependency-2/local-reference/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/after.json | {"start":"2026-10-09T17:45:53.030Z","judgeStart":"2026-10-09T17:45:55.715Z","judgeEnd":"2026-10-09T17:46:55.670Z","complete":"2026-10-09T17:46:55.694Z"} |
| compiler-dependency-2/native-codex/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/after.json | {"start":"2026-10-09T17:46:55.704Z","judgeStart":"2026-10-09T17:46:58.551Z","judgeEnd":"2026-10-09T17:47:58.575Z","complete":"2026-10-09T17:47:58.604Z"} |
| indexed-data-1/rifty/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/after.json | {"start":"2026-10-09T17:47:58.609Z","judgeStart":"2026-10-09T17:48:05.219Z","judgeEnd":"2026-10-09T17:48:06.122Z","complete":"2026-10-09T17:48:06.158Z"} |
| indexed-data-1/rifty-no-coi/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:48:06.162Z","judgeStart":"2026-10-09T17:48:08.673Z","judgeEnd":"2026-10-09T17:48:09.323Z","complete":"2026-10-09T17:48:09.331Z"} |
| indexed-data-1/local-reference/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/after.json | {"start":"2026-10-09T17:48:09.335Z","judgeStart":"2026-10-09T17:48:11.521Z","judgeEnd":"2026-10-09T17:48:11.914Z","complete":"2026-10-09T17:48:11.924Z"} |
| indexed-data-1/native-codex/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/after.json | {"start":"2026-10-09T17:48:11.928Z","judgeStart":"2026-10-09T17:48:13.873Z","judgeEnd":"2026-10-09T17:48:14.274Z","complete":"2026-10-09T17:48:14.284Z"} |
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-09T17:48:14.288Z","judgeStart":"2026-10-09T17:48:20.974Z","judgeEnd":"2026-10-09T17:48:21.865Z","complete":"2026-10-09T17:48:21.905Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T17:48:21.909Z","judgeStart":"2026-10-09T17:48:24.404Z","judgeEnd":"2026-10-09T17:48:25.050Z","complete":"2026-10-09T17:48:25.057Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-09T17:48:25.062Z","judgeStart":"2026-10-09T17:48:26.901Z","judgeEnd":"2026-10-09T17:48:27.307Z","complete":"2026-10-09T17:48:27.318Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-09T17:48:27.322Z","judgeStart":"2026-10-09T17:48:29.171Z","judgeEnd":"2026-10-09T17:48:29.558Z","complete":"2026-10-09T17:48:29.568Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 32; retained 32; missing 0.
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
| linked-import-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-1 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-1 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| linked-import-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| linked-import-2 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| async-search-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-1 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-1 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| async-search-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| async-search-2 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-1 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-1 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-1 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-1 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| indexed-data-1 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-1 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-1 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-1 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| indexed-data-2 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-2 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-2 | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| indexed-data-2 | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 8/4 | 0/8 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 8/4 | 0/8 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 8/4 | 0/8 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 8/4 | 0/8 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
