# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 76caef479bd2e09c14134d82362d8a982f007e51; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| compiler-dependency-2 | rifty | 1 | fail | not-run | 4.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty-no-coi | 1 | fail | not-run | 2.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
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
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 2d07e98eec02ac65b5e46d9eff1e6ced388796c22d60e9e65b82068813515d7e |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | f7b420fb72becf946dcd45c8c3422102a646b09f2a124ccca82f64377c3aa6ae |
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | d658f55d3603f0e081e5bfcdc621c5dc1252fb15dac414eeb053a66b9a9cf651 |
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | a6dc26a95d93d4b894933ef70e92e8666b5ba250f2b16c7bbc4bcb8bfe26d322 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | 97e59f7d57c4e9d425f501c188838037b90070e7849b3cfc978b027fad5d2f9c |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | 64379231345fc3fb92f31ade48da1d98690b89e140ed0a205ed8397197b4cd68 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-09T18:49:39.563Z","judgeStart":"2026-10-09T18:49:46.840Z","judgeEnd":"2026-10-09T18:49:47.373Z","complete":"2026-10-09T18:49:47.417Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:49:47.420Z","judgeStart":"2026-10-09T18:49:50.082Z","judgeEnd":"2026-10-09T18:49:50.124Z","complete":"2026-10-09T18:49:50.132Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-09T18:49:50.136Z","judgeStart":"2026-10-09T18:49:51.344Z","judgeEnd":"2026-10-09T18:49:51.381Z","complete":"2026-10-09T18:49:51.385Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-09T18:49:51.387Z","judgeStart":"2026-10-09T18:49:52.481Z","judgeEnd":"2026-10-09T18:49:52.521Z","complete":"2026-10-09T18:49:52.525Z"} |
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-09T18:49:52.527Z","judgeStart":"2026-10-09T18:49:56.987Z","judgeEnd":"2026-10-09T18:49:57.540Z","complete":"2026-10-09T18:49:57.583Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:49:57.586Z","judgeStart":"2026-10-09T18:50:00.073Z","judgeEnd":"2026-10-09T18:50:00.114Z","complete":"2026-10-09T18:50:00.120Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-09T18:50:00.123Z","judgeStart":"2026-10-09T18:50:01.282Z","judgeEnd":"2026-10-09T18:50:01.321Z","complete":"2026-10-09T18:50:01.324Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-09T18:50:01.327Z","judgeStart":"2026-10-09T18:50:02.425Z","judgeEnd":"2026-10-09T18:50:02.464Z","complete":"2026-10-09T18:50:02.467Z"} |
| compiler-dependency-1/rifty/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/after.json | {"start":"2026-10-09T18:50:02.470Z","judgeStart":"2026-10-09T18:50:09.244Z","judgeEnd":"2026-10-09T18:50:10.139Z","complete":"2026-10-09T18:50:10.173Z"} |
| compiler-dependency-1/rifty-no-coi/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:50:10.175Z","judgeStart":"2026-10-09T18:50:13.192Z","judgeEnd":"2026-10-09T18:50:13.839Z","complete":"2026-10-09T18:50:13.848Z"} |
| compiler-dependency-1/local-reference/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/after.json | {"start":"2026-10-09T18:50:13.851Z","judgeStart":"2026-10-09T18:50:16.315Z","judgeEnd":"2026-10-09T18:50:16.731Z","complete":"2026-10-09T18:50:16.741Z"} |
| compiler-dependency-1/native-codex/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/after.json | {"start":"2026-10-09T18:50:16.743Z","judgeStart":"2026-10-09T18:50:18.985Z","judgeEnd":"2026-10-09T18:50:19.398Z","complete":"2026-10-09T18:50:19.408Z"} |
| compiler-dependency-2/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T18:50:19.411Z","complete":"2026-10-09T18:50:24.071Z"} |
| compiler-dependency-2/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T18:50:24.075Z","complete":"2026-10-09T18:50:26.744Z"} |
| compiler-dependency-2/local-reference/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/after.json | {"start":"2026-10-09T18:50:26.748Z","judgeStart":"2026-10-09T18:50:29.331Z","judgeEnd":"2026-10-09T18:50:29.723Z","complete":"2026-10-09T18:50:29.733Z"} |
| compiler-dependency-2/native-codex/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/after.json | {"start":"2026-10-09T18:50:29.736Z","judgeStart":"2026-10-09T18:50:32.436Z","judgeEnd":"2026-10-09T18:50:32.848Z","complete":"2026-10-09T18:50:32.862Z"} |
| indexed-data-1/rifty/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/after.json | {"start":"2026-10-09T18:50:32.869Z","judgeStart":"2026-10-09T18:50:39.473Z","judgeEnd":"2026-10-09T18:50:40.365Z","complete":"2026-10-09T18:50:40.402Z"} |
| indexed-data-1/rifty-no-coi/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:50:40.405Z","judgeStart":"2026-10-09T18:50:42.683Z","judgeEnd":"2026-10-09T18:50:43.324Z","complete":"2026-10-09T18:50:43.331Z"} |
| indexed-data-1/local-reference/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/after.json | {"start":"2026-10-09T18:50:43.335Z","judgeStart":"2026-10-09T18:50:45.482Z","judgeEnd":"2026-10-09T18:50:45.881Z","complete":"2026-10-09T18:50:45.890Z"} |
| indexed-data-1/native-codex/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/after.json | {"start":"2026-10-09T18:50:45.893Z","judgeStart":"2026-10-09T18:50:47.811Z","judgeEnd":"2026-10-09T18:50:48.206Z","complete":"2026-10-09T18:50:48.215Z"} |
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-09T18:50:48.218Z","judgeStart":"2026-10-09T18:50:54.171Z","judgeEnd":"2026-10-09T18:50:55.064Z","complete":"2026-10-09T18:50:55.100Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:50:55.103Z","judgeStart":"2026-10-09T18:50:57.621Z","judgeEnd":"2026-10-09T18:50:58.248Z","complete":"2026-10-09T18:50:58.256Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-09T18:50:58.259Z","judgeStart":"2026-10-09T18:51:00.275Z","judgeEnd":"2026-10-09T18:51:00.663Z","complete":"2026-10-09T18:51:00.674Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-09T18:51:00.677Z","judgeStart":"2026-10-09T18:51:02.546Z","judgeEnd":"2026-10-09T18:51:02.923Z","complete":"2026-10-09T18:51:02.933Z"} |

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
| evaluation | feature | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/3 | 0/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/3 | 0/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/3 | 0/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/3 | 0/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/2 | 0/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
