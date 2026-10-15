# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 2340764968bd974d4feb0f357031109642a925e0; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

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
| pending-count-zero-1 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-1 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-1 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-1 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-1 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-1 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-1 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-1 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-2 | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-2 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-2 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-zero-2 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-count-busy-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-2 | rifty | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-2 | rifty-no-coi | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-2 | local-reference | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| pending-missing-2 | native-codex | 1 | fail | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| pending-count-zero-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 719dcc96dbac331c1e4af2d1ef85625d7fb6bb6fc4634376e3bff5fbe59cbc04 |
| pending-count-busy-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 719dcc96dbac331c1e4af2d1ef85625d7fb6bb6fc4634376e3bff5fbe59cbc04 |
| pending-missing-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | 719dcc96dbac331c1e4af2d1ef85625d7fb6bb6fc4634376e3bff5fbe59cbc04 |
| pending-count-zero-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 37590fc920349f8b81563912de74043e16f01d208d6fbc83310eaafe6d5c10d0 |
| pending-count-busy-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 37590fc920349f8b81563912de74043e16f01d208d6fbc83310eaafe6d5c10d0 |
| pending-missing-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 37590fc920349f8b81563912de74043e16f01d208d6fbc83310eaafe6d5c10d0 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| pending-count-zero-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty/1/after.json | {"start":"2026-10-10T14:43:19.991Z","judgeStart":"2026-10-10T14:43:26.386Z","judgeEnd":"2026-10-10T14:43:30.445Z","complete":"2026-10-10T14:43:30.538Z"} |
| pending-count-zero-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:43:30.541Z","judgeStart":"2026-10-10T14:43:33.215Z","judgeEnd":"2026-10-10T14:43:34.685Z","complete":"2026-10-10T14:43:34.692Z"} |
| pending-count-zero-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-zero-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-1/local-reference/1/after.json | {"start":"2026-10-10T14:43:34.695Z","judgeStart":"2026-10-10T14:43:35.893Z","judgeEnd":"2026-10-10T14:43:37.497Z","complete":"2026-10-10T14:43:37.508Z"} |
| pending-count-zero-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-zero-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-1/native-codex/1/after.json | {"start":"2026-10-10T14:43:37.511Z","judgeStart":"2026-10-10T14:43:38.611Z","judgeEnd":"2026-10-10T14:43:40.247Z","complete":"2026-10-10T14:43:40.257Z"} |
| pending-count-busy-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty/1/after.json | {"start":"2026-10-10T14:43:40.260Z","judgeStart":"2026-10-10T14:43:45.321Z","judgeEnd":"2026-10-10T14:43:49.310Z","complete":"2026-10-10T14:43:49.381Z"} |
| pending-count-busy-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:43:49.384Z","judgeStart":"2026-10-10T14:43:51.558Z","judgeEnd":"2026-10-10T14:43:52.738Z","complete":"2026-10-10T14:43:52.744Z"} |
| pending-count-busy-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-busy-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-1/local-reference/1/after.json | {"start":"2026-10-10T14:43:52.748Z","judgeStart":"2026-10-10T14:43:53.960Z","judgeEnd":"2026-10-10T14:43:55.289Z","complete":"2026-10-10T14:43:55.305Z"} |
| pending-count-busy-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-busy-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-1/native-codex/1/after.json | {"start":"2026-10-10T14:43:55.311Z","judgeStart":"2026-10-10T14:43:56.548Z","judgeEnd":"2026-10-10T14:43:57.897Z","complete":"2026-10-10T14:43:57.908Z"} |
| pending-missing-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-missing-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-1/rifty/1/after.json | {"start":"2026-10-10T14:43:57.911Z","judgeStart":"2026-10-10T14:44:02.920Z","judgeEnd":"2026-10-10T14:44:06.886Z","complete":"2026-10-10T14:44:06.958Z"} |
| pending-missing-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-missing-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:44:06.961Z","judgeStart":"2026-10-10T14:44:09.666Z","judgeEnd":"2026-10-10T14:44:10.840Z","complete":"2026-10-10T14:44:10.850Z"} |
| pending-missing-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-missing-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-1/local-reference/1/after.json | {"start":"2026-10-10T14:44:10.855Z","judgeStart":"2026-10-10T14:44:12.133Z","judgeEnd":"2026-10-10T14:44:13.581Z","complete":"2026-10-10T14:44:13.590Z"} |
| pending-missing-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-missing-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-1/native-codex/1/after.json | {"start":"2026-10-10T14:44:13.594Z","judgeStart":"2026-10-10T14:44:14.795Z","judgeEnd":"2026-10-10T14:44:16.239Z","complete":"2026-10-10T14:44:16.248Z"} |
| pending-count-zero-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty/1/after.json | {"start":"2026-10-10T14:44:16.251Z","judgeStart":"2026-10-10T14:44:22.377Z","judgeEnd":"2026-10-10T14:44:27.412Z","complete":"2026-10-10T14:44:27.492Z"} |
| pending-count-zero-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:44:27.496Z","judgeStart":"2026-10-10T14:44:29.930Z","judgeEnd":"2026-10-10T14:44:31.774Z","complete":"2026-10-10T14:44:31.780Z"} |
| pending-count-zero-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-zero-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-2/local-reference/1/after.json | {"start":"2026-10-10T14:44:31.784Z","judgeStart":"2026-10-10T14:44:32.992Z","judgeEnd":"2026-10-10T14:44:34.905Z","complete":"2026-10-10T14:44:34.915Z"} |
| pending-count-zero-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-zero-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-zero-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-count-zero-2/native-codex/1/after.json | {"start":"2026-10-10T14:44:34.919Z","judgeStart":"2026-10-10T14:44:36.157Z","judgeEnd":"2026-10-10T14:44:38.064Z","complete":"2026-10-10T14:44:38.073Z"} |
| pending-count-busy-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty/1/after.json | {"start":"2026-10-10T14:44:38.077Z","judgeStart":"2026-10-10T14:44:42.567Z","judgeEnd":"2026-10-10T14:44:46.554Z","complete":"2026-10-10T14:44:46.635Z"} |
| pending-count-busy-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:44:46.639Z","judgeStart":"2026-10-10T14:44:48.911Z","judgeEnd":"2026-10-10T14:44:50.080Z","complete":"2026-10-10T14:44:50.087Z"} |
| pending-count-busy-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-busy-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-2/local-reference/1/after.json | {"start":"2026-10-10T14:44:50.091Z","judgeStart":"2026-10-10T14:44:51.214Z","judgeEnd":"2026-10-10T14:44:52.564Z","complete":"2026-10-10T14:44:52.574Z"} |
| pending-count-busy-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-count-busy-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-count-busy-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-count-busy-2/native-codex/1/after.json | {"start":"2026-10-10T14:44:52.578Z","judgeStart":"2026-10-10T14:44:53.676Z","judgeEnd":"2026-10-10T14:44:55.006Z","complete":"2026-10-10T14:44:55.016Z"} |
| pending-missing-2/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-missing-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-2/rifty/1/after.json | {"start":"2026-10-10T14:44:55.020Z","judgeStart":"2026-10-10T14:45:00.203Z","judgeEnd":"2026-10-10T14:45:04.653Z","complete":"2026-10-10T14:45:04.733Z"} |
| pending-missing-2/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): pending-missing-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T14:45:04.737Z","judgeStart":"2026-10-10T14:45:07.273Z","judgeEnd":"2026-10-10T14:45:08.424Z","complete":"2026-10-10T14:45:08.431Z"} |
| pending-missing-2/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-missing-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-2/local-reference/1/after.json | {"start":"2026-10-10T14:45:08.436Z","judgeStart":"2026-10-10T14:45:09.732Z","judgeEnd":"2026-10-10T14:45:11.173Z","complete":"2026-10-10T14:45:11.183Z"} |
| pending-missing-2/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): pending-missing-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): pending-missing-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): pending-missing-2/native-codex/1/after.json | {"start":"2026-10-10T14:45:11.187Z","judgeStart":"2026-10-10T14:45:12.331Z","judgeEnd":"2026-10-10T14:45:13.773Z","complete":"2026-10-10T14:45:13.782Z"} |

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
| pending-count-zero-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| pending-count-busy-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-1 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-1 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| pending-missing-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-1 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-1 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| pending-count-zero-2 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-2 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-2 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| pending-count-zero-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| pending-count-busy-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-count-busy-2 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |
| pending-missing-2 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| pending-missing-2 | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"functional":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| evaluation | feature | rifty | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 6/1 | 2/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
