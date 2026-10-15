# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: be73f0d1c6ea924fdf244a1baaeeb3cd85d41aa0; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 32; retained 17.
Incomplete series is partial evidence; missing work is never success.
Series error: Cleanup failed: Error: page.evaluate: Target page, context or browser has been closed

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| compiler-dependency-1 | rifty-no-coi | 1 | missing | unfinished |
| compiler-dependency-1 | local-reference | 1 | missing | not started |
| compiler-dependency-1 | native-codex | 1 | missing | not started |
| compiler-dependency-2 | rifty | 1 | missing | not started |
| compiler-dependency-2 | rifty-no-coi | 1 | missing | not started |
| compiler-dependency-2 | local-reference | 1 | missing | not started |
| compiler-dependency-2 | native-codex | 1 | missing | not started |
| indexed-data-1 | rifty | 1 | missing | not started |
| indexed-data-1 | rifty-no-coi | 1 | missing | not started |
| indexed-data-1 | local-reference | 1 | missing | not started |
| indexed-data-1 | native-codex | 1 | missing | not started |
| indexed-data-2 | rifty | 1 | missing | not started |
| indexed-data-2 | rifty-no-coi | 1 | missing | not started |
| indexed-data-2 | local-reference | 1 | missing | not started |
| indexed-data-2 | native-codex | 1 | missing | not started |
| linked-import-1 | rifty | 1 | fail | done | 32.6 | 20 | 27774 | 2256 | 0 | 0 | 2 | 0 | 14 | — | — |
| linked-import-1 | rifty-no-coi | 1 | fail | done | 29.8 | 10 | 19556 | 2654 | 0 | 0 | 1 | 0 | 3 | — | — |
| linked-import-1 | local-reference | 1 | fail | done | 24.5 | 5 | 17240 | 2270 | 0 | 0 | 0 | 0 | 2 | — | — |
| linked-import-1 | native-codex | 1 | pass | done | 80.6 | 5 | 115443 | 3194 | unknown | unknown | unknown | unknown | unknown | — | — |
| linked-import-2 | rifty | 1 | fail | done | 35.1 | 10 | 26783 | 3186 | 0 | 0 | 0 | 0 | 2 | — | — |
| linked-import-2 | rifty-no-coi | 1 | fail | done | 30.2 | 9 | 16806 | 2579 | 0 | 0 | 0 | 0 | 0 | — | — |
| linked-import-2 | local-reference | 1 | fail | done | 34.6 | 6 | 24566 | 2009 | 0 | 0 | 0 | 0 | 6 | — | — |
| linked-import-2 | native-codex | 1 | pass | done | 105.3 | 8 | 172348 | 3864 | unknown | unknown | unknown | unknown | unknown | — | — |
| async-search-1 | rifty | 1 | pass | done | 36.2 | 12 | 16752 | 1816 | 0 | 0 | 1 | 0 | 3 | — | — |
| async-search-1 | rifty-no-coi | 1 | pass | done | 31.4 | 13 | 26440 | 2231 | 0 | 0 | 1 | 0 | 4 | — | — |
| async-search-1 | local-reference | 1 | pass | done | 29.3 | 7 | 28092 | 2246 | 0 | 0 | 0 | 0 | 4 | — | — |
| async-search-1 | native-codex | 1 | pass | done | 126.7 | 9 | 137737 | 5417 | unknown | unknown | unknown | unknown | unknown | — | — |
| async-search-2 | rifty | 1 | fail | done | 45.0 | 18 | 38942 | 3123 | 0 | 0 | 1 | 0 | 7 | — | — |
| async-search-2 | rifty-no-coi | 1 | fail | done | 78.1 | 32 | 101249 | 4587 | 0 | 0 | 2 | 0 | 12 | — | — |
| async-search-2 | local-reference | 1 | fail | done | 67.2 | 10 | 42429 | 3954 | 0 | 0 | 0 | 0 | 5 | — | — |
| async-search-2 | native-codex | 1 | pass | done | 108.3 | 8 | 159640 | 3788 | unknown | unknown | unknown | unknown | unknown | — | — |
| compiler-dependency-1 | rifty | 1 | pass | done | 27.7 | 11 | 13633 | 838 | 0 | 0 | 1 | 0 | 4 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| linked-import-1 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | f8fba33eb016125b9ab81a33d3d428b7e8ed5c01c220f01535f5b5c324f92a54 |
| linked-import-2 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | 81e899bb134f645ff6a5eefd0f7e6d3b2f508b09e1557a3a7bc43958a9ddf35d |
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | ad6cf6ef7175ecb7fee63a9c66e60565b9fca7a3b811a54ca75c43cda82ce926 |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 1c03a761e355cac968e07e13fcaa4a2d6efc87ddfd1a95c1e0dcbfc3cb1a0f07 |
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | d658f55d3603f0e081e5bfcdc621c5dc1252fb15dac414eeb053a66b9a9cf651 |
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | a6dc26a95d93d4b894933ef70e92e8666b5ba250f2b16c7bbc4bcb8bfe26d322 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | ed034985a353d4fd086eed79f877ada0133885733baa7c44457c87263b4d28df |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | b73ef8c869946995cc72ba033db882eee255692a6670e7993b2beea45b302d30 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| linked-import-1/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/after.json | {"start":"2026-10-10T10:42:43.517Z","agentStart":"2026-10-10T10:42:49.827Z","agentEnd":"2026-10-10T10:43:22.468Z","judgeStart":"2026-10-10T10:43:22.619Z","judgeEnd":"2026-10-10T10:43:26.132Z","complete":"2026-10-10T10:43:26.334Z"} |
| linked-import-1/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:43:26.337Z","agentStart":"2026-10-10T10:43:28.916Z","agentEnd":"2026-10-10T10:43:58.732Z","judgeStart":"2026-10-10T10:43:58.871Z","judgeEnd":"2026-10-10T10:43:59.722Z","complete":"2026-10-10T10:43:59.826Z"} |
| linked-import-1/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/after.json | {"start":"2026-10-10T10:43:59.834Z","agentStart":"2026-10-10T10:44:01.341Z","agentEnd":"2026-10-10T10:44:25.827Z","judgeStart":"2026-10-10T10:44:25.839Z","judgeEnd":"2026-10-10T10:44:26.406Z","complete":"2026-10-10T10:44:26.419Z"} |
| linked-import-1/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/after.json | {"start":"2026-10-10T10:44:26.424Z","agentStart":"2026-10-10T10:44:27.548Z","agentEnd":"2026-10-10T10:45:48.150Z","judgeStart":"2026-10-10T10:45:48.152Z","judgeEnd":"2026-10-10T10:45:48.715Z","complete":"2026-10-10T10:45:48.728Z"} |
| linked-import-2/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/after.json | {"start":"2026-10-10T10:45:48.732Z","agentStart":"2026-10-10T10:45:53.770Z","agentEnd":"2026-10-10T10:46:28.875Z","judgeStart":"2026-10-10T10:46:29.070Z","judgeEnd":"2026-10-10T10:46:32.550Z","complete":"2026-10-10T10:46:32.798Z"} |
| linked-import-2/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:46:32.802Z","agentStart":"2026-10-10T10:46:35.220Z","agentEnd":"2026-10-10T10:47:05.419Z","judgeStart":"2026-10-10T10:47:05.525Z","judgeEnd":"2026-10-10T10:47:06.386Z","complete":"2026-10-10T10:47:06.468Z"} |
| linked-import-2/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/after.json | {"start":"2026-10-10T10:47:06.473Z","agentStart":"2026-10-10T10:47:07.889Z","agentEnd":"2026-10-10T10:47:42.505Z","judgeStart":"2026-10-10T10:47:42.515Z","judgeEnd":"2026-10-10T10:47:43.084Z","complete":"2026-10-10T10:47:43.096Z"} |
| linked-import-2/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/after.json | {"start":"2026-10-10T10:47:43.101Z","agentStart":"2026-10-10T10:47:44.317Z","agentEnd":"2026-10-10T10:49:29.586Z","judgeStart":"2026-10-10T10:49:29.590Z","judgeEnd":"2026-10-10T10:49:30.151Z","complete":"2026-10-10T10:49:30.165Z"} |
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-10T10:49:30.170Z","agentStart":"2026-10-10T10:49:35.750Z","agentEnd":"2026-10-10T10:50:11.961Z","judgeStart":"2026-10-10T10:50:12.023Z","judgeEnd":"2026-10-10T10:50:16.053Z","complete":"2026-10-10T10:50:16.200Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:50:16.204Z","agentStart":"2026-10-10T10:50:18.516Z","agentEnd":"2026-10-10T10:50:49.888Z","judgeStart":"2026-10-10T10:50:49.958Z","judgeEnd":"2026-10-10T10:50:50.994Z","complete":"2026-10-10T10:50:51.045Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-10T10:50:51.050Z","agentStart":"2026-10-10T10:50:52.409Z","agentEnd":"2026-10-10T10:51:21.713Z","judgeStart":"2026-10-10T10:51:21.724Z","judgeEnd":"2026-10-10T10:51:22.487Z","complete":"2026-10-10T10:51:22.500Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-10T10:51:22.505Z","agentStart":"2026-10-10T10:51:23.613Z","agentEnd":"2026-10-10T10:53:30.271Z","judgeStart":"2026-10-10T10:53:30.275Z","judgeEnd":"2026-10-10T10:53:31.052Z","complete":"2026-10-10T10:53:31.067Z"} |
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-10T10:53:31.073Z","agentStart":"2026-10-10T10:53:35.955Z","agentEnd":"2026-10-10T10:54:20.907Z","judgeStart":"2026-10-10T10:54:21.049Z","judgeEnd":"2026-10-10T10:54:25.035Z","complete":"2026-10-10T10:54:25.267Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T10:54:25.273Z","agentStart":"2026-10-10T10:54:27.792Z","agentEnd":"2026-10-10T10:55:45.887Z","judgeStart":"2026-10-10T10:55:46.009Z","judgeEnd":"2026-10-10T10:55:47.117Z","complete":"2026-10-10T10:55:47.205Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-10T10:55:47.211Z","agentStart":"2026-10-10T10:55:48.632Z","agentEnd":"2026-10-10T10:56:55.855Z","judgeStart":"2026-10-10T10:56:55.875Z","judgeEnd":"2026-10-10T10:56:56.522Z","complete":"2026-10-10T10:56:56.539Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-10T10:56:56.545Z","agentStart":"2026-10-10T10:56:57.812Z","agentEnd":"2026-10-10T10:58:46.162Z","judgeStart":"2026-10-10T10:58:46.165Z","judgeEnd":"2026-10-10T10:58:47.165Z","complete":"2026-10-10T10:58:47.182Z"} |
| compiler-dependency-1/rifty/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/after.json | {"start":"2026-10-10T10:58:47.188Z","agentStart":"2026-10-10T10:58:53.580Z","agentEnd":"2026-10-10T10:59:21.305Z","judgeStart":"2026-10-10T10:59:21.404Z","judgeEnd":"2026-10-10T10:59:23.303Z","complete":"2026-10-10T10:59:23.482Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 32; retained 17; missing 15.
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
| linked-import-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 27774/2256 |
| linked-import-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 19556/2654 |
| linked-import-1 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [0.000, 0.000] | {"functional":1} | 17240/2270 |
| linked-import-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 115443/3194 |
| linked-import-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 26783/3186 |
| linked-import-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 16806/2579 |
| linked-import-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [0.000, 0.000] | {"functional":1} | 24566/2009 |
| linked-import-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 172348/3864 |
| async-search-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.999, 0.999] | {} | 16752/1816 |
| async-search-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.999, 0.999] | {} | 26440/2231 |
| async-search-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 28092/2246 |
| async-search-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 137737/5417 |
| async-search-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 38942/3123 |
| async-search-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 101249/4587 |
| async-search-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [0.000, 0.000] | {"functional":1} | 42429/3954 |
| async-search-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 159640/3788 |
| compiler-dependency-1 | evaluation/app | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | unavailable | unavailable | {} | 13633/838 |
| compiler-dependency-1 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-1 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| indexed-data-2 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [-0.999, 0.999] |
| evaluation | all | rifty | 8/4 | 2/8 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [-0.999, 0.999] |
| evaluation | feature | rifty-no-coi | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [-0.999, 0.999] |
| evaluation | all | rifty-no-coi | 8/4 | 1/8 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [-0.999, 0.999] |
| evaluation | feature | local-reference | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 8/4 | 1/8 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 4/2 | 1/4 | 0 | 0.250 | [0.000, 0.999] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 4/2 | 4/4 | 0 | 1.000 | [0.001, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 8/4 | 4/8 | 4 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 4/2 | 4/4 | 0 | 1.000 | [0.001, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/2 | 1/4 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | separate reference | unavailable |
