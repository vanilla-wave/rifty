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
| async-search-1 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty | 1 | fail | not-run | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | rifty-no-coi | 1 | fail | not-run | 3.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| compiler-dependency-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
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
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 2d07e98eec02ac65b5e46d9eff1e6ced388796c22d60e9e65b82068813515d7e |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | f7b420fb72becf946dcd45c8c3422102a646b09f2a124ccca82f64377c3aa6ae |
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | d658f55d3603f0e081e5bfcdc621c5dc1252fb15dac414eeb053a66b9a9cf651 |
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | a6dc26a95d93d4b894933ef70e92e8666b5ba250f2b16c7bbc4bcb8bfe26d322 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | 97e59f7d57c4e9d425f501c188838037b90070e7849b3cfc978b027fad5d2f9c |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | 64379231345fc3fb92f31ade48da1d98690b89e140ed0a205ed8397197b4cd68 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-09T18:52:19.064Z","judgeStart":"2026-10-09T18:52:26.620Z","judgeEnd":"2026-10-09T18:52:27.659Z","complete":"2026-10-09T18:52:27.709Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:52:27.712Z","judgeStart":"2026-10-09T18:52:30.340Z","judgeEnd":"2026-10-09T18:52:30.554Z","complete":"2026-10-09T18:52:30.560Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-09T18:52:30.564Z","judgeStart":"2026-10-09T18:52:31.769Z","judgeEnd":"2026-10-09T18:52:31.991Z","complete":"2026-10-09T18:52:31.997Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-09T18:52:32.014Z","judgeStart":"2026-10-09T18:52:33.122Z","judgeEnd":"2026-10-09T18:52:33.340Z","complete":"2026-10-09T18:52:33.345Z"} |
| async-search-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty/1/after.json | {"start":"2026-10-09T18:52:33.349Z","judgeStart":"2026-10-09T18:52:38.365Z","judgeEnd":"2026-10-09T18:52:39.510Z","complete":"2026-10-09T18:52:39.547Z"} |
| async-search-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:52:39.550Z","judgeStart":"2026-10-09T18:52:42.022Z","judgeEnd":"2026-10-09T18:52:42.440Z","complete":"2026-10-09T18:52:42.447Z"} |
| async-search-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/local-reference/1/after.json | {"start":"2026-10-09T18:52:42.451Z","judgeStart":"2026-10-09T18:52:43.632Z","judgeEnd":"2026-10-09T18:52:43.994Z","complete":"2026-10-09T18:52:43.998Z"} |
| async-search-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-2/native-codex/1/after.json | {"start":"2026-10-09T18:52:44.001Z","judgeStart":"2026-10-09T18:52:45.133Z","judgeEnd":"2026-10-09T18:52:45.506Z","complete":"2026-10-09T18:52:45.510Z"} |
| compiler-dependency-1/rifty/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty/1/after.json | {"start":"2026-10-09T18:52:45.513Z","judgeStart":"2026-10-09T18:52:51.665Z","judgeEnd":"2026-10-09T18:52:57.477Z","complete":"2026-10-09T18:52:57.604Z"} |
| compiler-dependency-1/rifty-no-coi/1 | b107729c6bf26ea11206cf5db562965c310e27b937cf3186c887daef30ca9ce3/64cab40d9315799ce7a4f31c2215600a80a2bc21ddd81718a9254ba5d024fab0 | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:52:57.607Z","judgeStart":"2026-10-09T18:53:00.774Z","judgeEnd":"2026-10-09T18:53:04.577Z","complete":"2026-10-09T18:53:04.586Z"} |
| compiler-dependency-1/local-reference/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/local-reference/1/after.json | {"start":"2026-10-09T18:53:04.590Z","judgeStart":"2026-10-09T18:53:07.007Z","judgeEnd":"2026-10-09T18:53:07.843Z","complete":"2026-10-09T18:53:07.855Z"} |
| compiler-dependency-1/native-codex/1 | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532/ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-1/native-codex/1/after.json | {"start":"2026-10-09T18:53:07.858Z","judgeStart":"2026-10-09T18:53:10.106Z","judgeEnd":"2026-10-09T18:53:10.967Z","complete":"2026-10-09T18:53:10.979Z"} |
| compiler-dependency-2/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T18:53:10.982Z","complete":"2026-10-09T18:53:16.672Z"} |
| compiler-dependency-2/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): compiler-dependency-2/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-09T18:53:16.677Z","complete":"2026-10-09T18:53:19.702Z"} |
| compiler-dependency-2/local-reference/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/local-reference/1/after.json | {"start":"2026-10-09T18:53:19.706Z","judgeStart":"2026-10-09T18:53:22.385Z","judgeEnd":"2026-10-09T18:53:24.288Z","complete":"2026-10-09T18:53:24.310Z"} |
| compiler-dependency-2/native-codex/1 | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef/693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): compiler-dependency-2/native-codex/1/after.json | {"start":"2026-10-09T18:53:24.314Z","judgeStart":"2026-10-09T18:53:27.022Z","judgeEnd":"2026-10-09T18:53:29.122Z","complete":"2026-10-09T18:53:29.149Z"} |
| indexed-data-1/rifty/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty/1/after.json | {"start":"2026-10-09T18:53:29.153Z","judgeStart":"2026-10-09T18:53:36.119Z","judgeEnd":"2026-10-09T18:53:38.030Z","complete":"2026-10-09T18:53:38.146Z"} |
| indexed-data-1/rifty-no-coi/1 | b3f91835dc330234fe3e1a33af5717f8b1b617f40139f4ce49082ebf65199136/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:53:38.150Z","judgeStart":"2026-10-09T18:53:40.924Z","judgeEnd":"2026-10-09T18:53:42.492Z","complete":"2026-10-09T18:53:42.517Z"} |
| indexed-data-1/local-reference/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/local-reference/1/after.json | {"start":"2026-10-09T18:53:42.521Z","judgeStart":"2026-10-09T18:53:44.359Z","judgeEnd":"2026-10-09T18:53:45.684Z","complete":"2026-10-09T18:53:45.711Z"} |
| indexed-data-1/native-codex/1 | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-1/native-codex/1/after.json | {"start":"2026-10-09T18:53:45.715Z","judgeStart":"2026-10-09T18:53:47.598Z","judgeEnd":"2026-10-09T18:53:48.967Z","complete":"2026-10-09T18:53:49.001Z"} |
| indexed-data-2/rifty/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty/1/after.json | {"start":"2026-10-09T18:53:49.004Z","judgeStart":"2026-10-09T18:53:55.367Z","judgeEnd":"2026-10-09T18:54:01.514Z","complete":"2026-10-09T18:54:01.639Z"} |
| indexed-data-2/rifty-no-coi/1 | 0f2aee19b6c10928371d949c678ce246045a8d5b821d472a0c740dac5bcb79b3/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/rifty-no-coi/1/after.json | {"start":"2026-10-09T18:54:01.643Z","judgeStart":"2026-10-09T18:54:04.169Z","judgeEnd":"2026-10-09T18:54:10.533Z","complete":"2026-10-09T18:54:10.567Z"} |
| indexed-data-2/local-reference/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/local-reference/1/after.json | {"start":"2026-10-09T18:54:10.575Z","judgeStart":"2026-10-09T18:54:12.701Z","judgeEnd":"2026-10-09T18:54:18.792Z","complete":"2026-10-09T18:54:18.832Z"} |
| indexed-data-2/native-codex/1 | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): indexed-data-2/native-codex/1/after.json | {"start":"2026-10-09T18:54:18.836Z","judgeStart":"2026-10-09T18:54:21.043Z","judgeEnd":"2026-10-09T18:54:27.175Z","complete":"2026-10-09T18:54:27.215Z"} |

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
| async-search-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| compiler-dependency-2 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| compiler-dependency-2 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
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
| evaluation | feature | rifty | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/3 | 5/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/3 | 5/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/3 | 6/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/2 | 3/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/2 | 3/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/2 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
