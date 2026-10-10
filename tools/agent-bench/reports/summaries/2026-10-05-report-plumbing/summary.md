# Agent benchmark: scripted

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v1; runs/task: 1.
Limits: {"maxToolCalls":40,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"scripted","name":"scripted","provider":"bench","api":"openai-completions","baseUrl":"http://127.0.0.1:50245/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":false,"thinking":"off","compat":{},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: f620974430dc59dfc2a8bfc790227c6ac26dc779 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Series: completed; selected 24; retained 24.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| ms-negative | rifty | 1 | fail | error | 8.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | fail | done | 0.6 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 1 | fail | error | 11.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 2.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty | 1 | fail | done | 0.1 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty-no-coi | 1 | fail | done | 0.0 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | rifty | 1 | fail | done | 0.1 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | rifty-no-coi | 1 | fail | done | 0.0 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | local-reference | 1 | fail | done | 0.5 | 1 | 20 | 6 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes | native-codex | 1 | fail | error | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | 1e5483017e418b18d51d66c9c0756b2632cad7fbdaabaa85c38f319a98dc8166 |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 3b2fa87f4f9748e00d77b8ea472eed00a932af60cb1dc18b51981af7743e685b |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 630bed3b02e7d2ec7aa290282eb9c206d8d4abc0330b6b9aac22f001332e105e |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 86bf243d2e75331b3ebb585f1c2e12a8c24255b7020178c9154919148a41b031 |
| csv-workflow | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | 290b874ea634398db633d67cd051e84094dbc3676ecd3892b6c93f2982560813 |
| markdown-notes | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | 6836348a3d7a729bc0380b60884e38e79e40f9635569beb04d6a86ca06ceac3c |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:30:48.137Z","complete":"2026-10-05T16:30:56.942Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:30:56.945Z","complete":"2026-10-05T16:31:03.171Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-05T16:31:03.174Z","agentStart":"2026-10-05T16:31:04.133Z","agentEnd":"2026-10-05T16:31:04.747Z","judgeStart":"2026-10-05T16:31:04.749Z","judgeEnd":"2026-10-05T16:31:04.790Z","complete":"2026-10-05T16:31:04.798Z"} |
| ms-negative/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:04.805Z","complete":"2026-10-05T16:31:04.807Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:04.810Z","complete":"2026-10-05T16:31:10.425Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:10.428Z","complete":"2026-10-05T16:31:13.601Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-05T16:31:13.603Z","agentStart":"2026-10-05T16:31:14.044Z","agentEnd":"2026-10-05T16:31:14.543Z","judgeStart":"2026-10-05T16:31:14.545Z","judgeEnd":"2026-10-05T16:31:14.594Z","complete":"2026-10-05T16:31:14.599Z"} |
| ms-weeks/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:14.602Z","complete":"2026-10-05T16:31:14.604Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:14.607Z","complete":"2026-10-05T16:31:25.951Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:25.955Z","complete":"2026-10-05T16:31:34.927Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-05T16:31:34.933Z","agentStart":"2026-10-05T16:31:36.182Z","agentEnd":"2026-10-05T16:31:36.680Z","judgeStart":"2026-10-05T16:31:36.682Z","judgeEnd":"2026-10-05T16:31:36.722Z","complete":"2026-10-05T16:31:36.727Z"} |
| stringify-boxed/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:36.730Z","complete":"2026-10-05T16:31:36.733Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:31:36.736Z","complete":"2026-10-05T16:33:08.183Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:33:08.187Z","complete":"2026-10-05T16:33:10.164Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-05T16:33:10.168Z","agentStart":"2026-10-05T16:33:33.325Z","agentEnd":"2026-10-05T16:33:33.813Z","judgeStart":"2026-10-05T16:33:33.816Z","judgeEnd":"2026-10-05T16:33:33.889Z","complete":"2026-10-05T16:33:33.894Z"} |
| queue-clear/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:33:33.898Z","complete":"2026-10-05T16:33:33.899Z"} |
| csv-workflow/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/after.json | {"start":"2026-10-05T16:33:33.902Z","agentStart":"2026-10-05T16:33:40.809Z","agentEnd":"2026-10-05T16:33:40.951Z","judgeStart":"2026-10-05T16:33:41.106Z","judgeEnd":"2026-10-05T16:34:12.960Z","complete":"2026-10-05T16:34:13.087Z"} |
| csv-workflow/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/after.json | {"start":"2026-10-05T16:34:13.090Z","agentStart":"2026-10-05T16:34:16.394Z","agentEnd":"2026-10-05T16:34:16.414Z","judgeStart":"2026-10-05T16:34:16.415Z","judgeEnd":"2026-10-05T16:34:47.808Z","complete":"2026-10-05T16:34:47.819Z"} |
| csv-workflow/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/after.json | {"start":"2026-10-05T16:34:47.824Z","agentStart":"2026-10-05T16:34:50.274Z","agentEnd":"2026-10-05T16:34:50.754Z","judgeStart":"2026-10-05T16:34:50.755Z","judgeEnd":"2026-10-05T16:35:21.133Z","complete":"2026-10-05T16:35:21.147Z"} |
| csv-workflow/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): csv-workflow/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:35:21.152Z","complete":"2026-10-05T16:35:21.154Z"} |
| markdown-notes/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes/rifty/1/after.json | {"start":"2026-10-05T16:35:21.159Z","agentStart":"2026-10-05T16:35:26.909Z","agentEnd":"2026-10-05T16:35:26.997Z","judgeStart":"2026-10-05T16:35:27.076Z","judgeEnd":"2026-10-05T16:35:57.945Z","complete":"2026-10-05T16:35:58.044Z"} |
| markdown-notes/rifty-no-coi/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes/rifty-no-coi/1/after.json | {"start":"2026-10-05T16:35:58.048Z","agentStart":"2026-10-05T16:36:00.597Z","agentEnd":"2026-10-05T16:36:00.621Z","judgeStart":"2026-10-05T16:36:00.622Z","judgeEnd":"2026-10-05T16:36:31.175Z","complete":"2026-10-05T16:36:31.182Z"} |
| markdown-notes/local-reference/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes/local-reference/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes/local-reference/1/after.json | {"start":"2026-10-05T16:36:31.186Z","agentStart":"2026-10-05T16:36:33.115Z","agentEnd":"2026-10-05T16:36:33.588Z","judgeStart":"2026-10-05T16:36:33.589Z","judgeEnd":"2026-10-05T16:37:03.928Z","complete":"2026-10-05T16:37:03.938Z"} |
| markdown-notes/native-codex/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): markdown-notes/native-codex/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:37:03.942Z","complete":"2026-10-05T16:37:03.944Z"} |

## Fixed-matrix outcomes

Purpose: smoke; selected 24; retained 24; missing 0.
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
| ms-negative | calibration/bug | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-negative | calibration/bug | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-negative | calibration/bug | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| ms-negative | calibration/bug | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |
| ms-weeks | calibration/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| ms-weeks | calibration/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |
| stringify-boxed | evaluation/bug | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| stringify-boxed | evaluation/bug | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |
| queue-clear | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| queue-clear | evaluation/feature | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |
| csv-workflow | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| csv-workflow | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| csv-workflow | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| csv-workflow | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |
| markdown-notes | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| markdown-notes | evaluation/app | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| markdown-notes | evaluation/app | local-reference | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 20/6 |
| markdown-notes | evaluation/app | native-codex | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {"setup":1} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | local-reference | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | local-reference | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 4/4 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 4/4 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 4/4 | 0/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/4 | 0/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
