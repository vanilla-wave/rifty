# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: boundary-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: e8e9d830c37b88a9eff17dc89ae2d15ff6e747d9; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 32; retained 12.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| async-search-2 | rifty | 1 | missing | unfinished |
| async-search-2 | rifty-no-coi | 1 | missing | not started |
| async-search-2 | local-reference | 1 | missing | not started |
| async-search-2 | native-codex | 1 | missing | not started |
| compiler-dependency-1 | rifty | 1 | missing | not started |
| compiler-dependency-1 | rifty-no-coi | 1 | missing | not started |
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
| linked-import-1 | rifty | 1 | pass | done | 45.3 | 18 | 33005 | 3008 | 0 | 0 | 1 | 0 | 11 | — | — |
| linked-import-1 | rifty-no-coi | 1 | pass | done | 30.1 | 14 | 25256 | 2187 | 0 | 0 | 1 | 0 | 8 | — | — |
| linked-import-1 | local-reference | 1 | pass | done | 128.5 | 11 | 57390 | 3238 | 0 | 0 | 0 | 1 | 0 | — | — |
| linked-import-1 | native-codex | 1 | pass | done | 97.7 | 6 | 133243 | 3551 | unknown | unknown | unknown | unknown | unknown | — | — |
| linked-import-2 | rifty | 1 | pass | done | 41.0 | 18 | 38534 | 3263 | 0 | 0 | 2 | 0 | 10 | — | — |
| linked-import-2 | rifty-no-coi | 1 | fail | done | 33.7 | 10 | 19658 | 2796 | 0 | 0 | 1 | 0 | 3 | — | — |
| linked-import-2 | local-reference | 1 | fail | done | 59.1 | 16 | 76475 | 3086 | 0 | 0 | 0 | 0 | 8 | — | — |
| linked-import-2 | native-codex | 1 | pass | done | 91.3 | 5 | 112537 | 3750 | unknown | unknown | unknown | unknown | unknown | — | — |
| async-search-1 | rifty | 1 | fail | done | 27.1 | 18 | 20216 | 1303 | 0 | 0 | 1 | 0 | 11 | — | — |
| async-search-1 | rifty-no-coi | 1 | fail | done | 86.3 | 8 | 16882 | 1808 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | local-reference | 1 | pass | done | 43.4 | 5 | 10598 | 1910 | 0 | 0 | 0 | 0 | 0 | — | — |
| async-search-1 | native-codex | 1 | pass | done | 83.9 | 8 | 130739 | 2947 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| linked-import-1 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 90b0d011c0703c7c2553d2ac0ba23d79fbd4743fd256b0a346088ffe03ad5d33 | 58687f73031e66f3f738f789869909534784bce18646e866530e2ad1fc088dd0 |
| linked-import-2 | evaluation/linked-data-import | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 916cd6321eb7025fd6ce328774b49e85c7907410d89150bc07a5da162f6bc00c | e4b89c1a9ed19f5317a480003d4eec110261c856d645ad1c73592bce7043b7f8 |
| async-search-1 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c5b9b682ace5afa01c511a43717b069cb4925539a295f8a3bca5e87cff91a68b | ad6cf6ef7175ecb7fee63a9c66e60565b9fca7a3b811a54ca75c43cda82ce926 |
| async-search-2 | evaluation/async-search-state | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 814acca91a49a2ee5622faab982c16719917deab6bba78767d7cf2d629792a62 | 976195bc3e44101108501720994e191397fb17a63d562a799fbc5e7355bf231d |
| compiler-dependency-1 | evaluation/compiler-integration | 77afac0d8da340be8de9ed3c22f032575ba1260b841bd11dab05dc512da6b532 | ab79717c04f9984cf459145e044f3602814e265590c17ff5af35611f51c56607 | 7fda100471e63b241cd481e724097297fba5d3620b6d0ce0161ceb718082c77c | d658f55d3603f0e081e5bfcdc621c5dc1252fb15dac414eeb053a66b9a9cf651 |
| compiler-dependency-2 | evaluation/compiler-integration | a9f88f3a62e3f861c815046723dccf2e9f813887fc2e2148ad949a4ae52431ef | 693030aad1de7fbd52b3822c4e13b28955c821af0fa32dfe5c9b8be9875660ba | d24643777aa6f0cd9b049f0ea3034f3ec5f5ab5b72fcb568cb5dff8fcf57da96 | a6dc26a95d93d4b894933ef70e92e8666b5ba250f2b16c7bbc4bcb8bfe26d322 |
| indexed-data-1 | evaluation/indexed-resource | dadc38a60d4698aa2eaa1297f4876adc87e4491419ae8fceacb846c708f47ed1 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | 61c3e53dff4bc9a9217c23d9a3232736d278978b307e33a47bc5219d247a755a | ed034985a353d4fd086eed79f877ada0133885733baa7c44457c87263b4d28df |
| indexed-data-2 | evaluation/indexed-resource | 84379689bb761f1e17ab3204dca3a7bf043afc81acd28ec8f92ac897358e6cd5 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | d896da35fbb07ecdc00c4a20df3f9002be7f22dd8c9d7fe7ceb932be4296b940 | b73ef8c869946995cc72ba033db882eee255692a6670e7993b2beea45b302d30 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| linked-import-1/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty/1/after.json | {"start":"2026-10-10T12:50:37.490Z","agentStart":"2026-10-10T12:50:44.691Z","agentEnd":"2026-10-10T12:51:30.004Z","judgeStart":"2026-10-10T12:51:30.136Z","judgeEnd":"2026-10-10T12:51:33.643Z","complete":"2026-10-10T12:51:33.889Z"} |
| linked-import-1/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:51:33.893Z","agentStart":"2026-10-10T12:51:36.741Z","agentEnd":"2026-10-10T12:52:06.803Z","judgeStart":"2026-10-10T12:52:06.889Z","judgeEnd":"2026-10-10T12:52:07.760Z","complete":"2026-10-10T12:52:07.832Z"} |
| linked-import-1/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/local-reference/1/after.json | {"start":"2026-10-10T12:52:07.840Z","agentStart":"2026-10-10T12:52:09.271Z","agentEnd":"2026-10-10T12:54:17.803Z","judgeStart":"2026-10-10T12:54:17.819Z","judgeEnd":"2026-10-10T12:54:18.505Z","complete":"2026-10-10T12:54:18.518Z"} |
| linked-import-1/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-1/native-codex/1/after.json | {"start":"2026-10-10T12:54:18.523Z","agentStart":"2026-10-10T12:54:19.916Z","agentEnd":"2026-10-10T12:55:57.652Z","judgeStart":"2026-10-10T12:55:57.656Z","judgeEnd":"2026-10-10T12:55:58.257Z","complete":"2026-10-10T12:55:58.270Z"} |
| linked-import-2/rifty/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty/1/after.json | {"start":"2026-10-10T12:55:58.275Z","agentStart":"2026-10-10T12:56:03.279Z","agentEnd":"2026-10-10T12:56:44.296Z","judgeStart":"2026-10-10T12:56:44.471Z","judgeEnd":"2026-10-10T12:56:47.976Z","complete":"2026-10-10T12:56:48.216Z"} |
| linked-import-2/rifty-no-coi/1 | db6cf27375342fb5da3aec40ec3544657894a07ba3e6fc7ec10eaff439a156a0/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/rifty-no-coi/1/after.json | {"start":"2026-10-10T12:56:48.220Z","agentStart":"2026-10-10T12:56:50.604Z","agentEnd":"2026-10-10T12:57:24.331Z","judgeStart":"2026-10-10T12:57:24.457Z","judgeEnd":"2026-10-10T12:57:25.315Z","complete":"2026-10-10T12:57:25.395Z"} |
| linked-import-2/local-reference/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/local-reference/1/after.json | {"start":"2026-10-10T12:57:25.401Z","agentStart":"2026-10-10T12:57:26.849Z","agentEnd":"2026-10-10T12:58:25.928Z","judgeStart":"2026-10-10T12:58:25.944Z","judgeEnd":"2026-10-10T12:58:26.509Z","complete":"2026-10-10T12:58:26.522Z"} |
| linked-import-2/native-codex/1 | b4627d6e37ee31782d5c64122917603a3c491733fd9006bb32d7404e601251a7/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/before.json / [bundle](source-artifacts.json.gz): linked-import-2/native-codex/1/after.json | {"start":"2026-10-10T12:58:26.529Z","agentStart":"2026-10-10T12:58:27.803Z","agentEnd":"2026-10-10T12:59:59.090Z","judgeStart":"2026-10-10T12:59:59.092Z","judgeEnd":"2026-10-10T12:59:59.664Z","complete":"2026-10-10T12:59:59.678Z"} |
| async-search-1/rifty/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty/1/after.json | {"start":"2026-10-10T12:59:59.683Z","agentStart":"2026-10-10T13:00:05.452Z","agentEnd":"2026-10-10T13:00:32.582Z","judgeStart":"2026-10-10T13:00:32.655Z","judgeEnd":"2026-10-10T13:00:36.640Z","complete":"2026-10-10T13:00:36.792Z"} |
| async-search-1/rifty-no-coi/1 | b0382f7046a0a957c6dbe3cf9530459bcb0bda6aef9f37a5f311ad17571280b8/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/rifty-no-coi/1/after.json | {"start":"2026-10-10T13:00:36.797Z","agentStart":"2026-10-10T13:00:39.172Z","agentEnd":"2026-10-10T13:02:05.446Z","judgeStart":"2026-10-10T13:02:05.516Z","judgeEnd":"2026-10-10T13:02:06.562Z","complete":"2026-10-10T13:02:06.600Z"} |
| async-search-1/local-reference/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/local-reference/1/after.json | {"start":"2026-10-10T13:02:06.605Z","agentStart":"2026-10-10T13:02:08.134Z","agentEnd":"2026-10-10T13:02:51.504Z","judgeStart":"2026-10-10T13:02:51.513Z","judgeEnd":"2026-10-10T13:02:52.238Z","complete":"2026-10-10T13:02:52.251Z"} |
| async-search-1/native-codex/1 | e7224c5315ef8361aeb84d7e7cdd352ce016c6b3170087dc2f4bce37f1be74e9/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/before.json / [bundle](source-artifacts.json.gz): async-search-1/native-codex/1/after.json | {"start":"2026-10-10T13:02:52.256Z","agentStart":"2026-10-10T13:02:53.514Z","agentEnd":"2026-10-10T13:04:17.384Z","judgeStart":"2026-10-10T13:04:17.388Z","judgeEnd":"2026-10-10T13:04:18.173Z","complete":"2026-10-10T13:04:18.190Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 32; retained 12; missing 20.
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
| linked-import-1 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.999, 0.999] | {} | 33005/3008 |
| linked-import-1 | evaluation/feature | rifty-no-coi | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [-0.999, 0.999] | {} | 25256/2187 |
| linked-import-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 57390/3238 |
| linked-import-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 133243/3551 |
| linked-import-2 | evaluation/feature | rifty | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 1.000 | [-0.998, 1.000] | {} | 38534/3263 |
| linked-import-2 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [-0.999, 0.999] | {"functional":1} | 19658/2796 |
| linked-import-2 | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | 0.000 | [0.000, 0.000] | {"functional":1} | 76475/3086 |
| linked-import-2 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 112537/3750 |
| async-search-1 | evaluation/feature | rifty | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | -1.000 | [-1.000, 0.998] | {"functional":1} | 20216/1303 |
| async-search-1 | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | 0.000 | [0.000, 0.975] | -1.000 | [-1.000, 0.998] | {"functional":1} | 16882/1808 |
| async-search-1 | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | 0.000 | [0.000, 0.000] | {} | 10598/1910 |
| async-search-1 | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | 1.000 | [0.025, 1.000] | separate reference | unavailable | {} | 130739/2947 |
| async-search-2 | evaluation/feature | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| async-search-2 | evaluation/feature | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| compiler-dependency-1 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
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
| evaluation | feature | rifty | 4/2 | 2/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 8/4 | 2/8 | 5 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 4/2 | 2/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 4/2 | 1/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 8/4 | 1/8 | 5 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 4/2 | 1/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 4/2 | 2/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 8/4 | 2/8 | 5 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 4/2 | 2/4 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 4/2 | 3/4 | 1 | unavailable | [0.001, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 8/4 | 3/8 | 5 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 4/2 | 3/4 | 1 | unavailable | [0.001, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/2 | 0/4 | 4 | unavailable | [0.000, 1.000] | separate reference | unavailable |
