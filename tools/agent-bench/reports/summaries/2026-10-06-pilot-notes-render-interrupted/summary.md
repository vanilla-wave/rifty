# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v3; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: db494579e4bde3aa61525f416c33633784654b08; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 72; retained 63.
Incomplete series is partial evidence; missing work is never success.
Series error: Cleanup failed: Error: page.evaluate: Target page, context or browser has been closed

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| markdown-notes-v2 | rifty-no-coi | 1 | missing | unfinished |
| markdown-notes-v2 | rifty-no-coi | 2 | missing | not started |
| markdown-notes-v2 | rifty-no-coi | 3 | missing | not started |
| markdown-notes-v2 | local-reference | 1 | missing | not started |
| markdown-notes-v2 | local-reference | 2 | missing | not started |
| markdown-notes-v2 | local-reference | 3 | missing | not started |
| markdown-notes-v2 | native-codex | 1 | missing | not started |
| markdown-notes-v2 | native-codex | 2 | missing | not started |
| markdown-notes-v2 | native-codex | 3 | missing | not started |
| ms-negative | rifty | 1 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 8.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 6.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 6.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 20.1 | 6 | 18636 | 533 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | pass | done | 18.5 | 6 | 15760 | 580 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 3 | pass | done | 19.1 | 8 | 15702 | 629 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 44.2 | 10 | 155391 | 988 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 53.8 | 9 | 148808 | 895 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 48.5 | 7 | 151064 | 1003 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 4.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 17.4 | 7 | 14009 | 493 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 21.5 | 10 | 32038 | 569 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 18.5 | 8 | 18297 | 547 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 45.1 | 7 | 132084 | 1059 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 41.5 | 7 | 131904 | 954 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 40.3 | 6 | 112115 | 1000 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 8.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 8.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 54.7 | 16 | 77761 | 1649 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 21.9 | 5 | 13924 | 600 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 35.8 | 9 | 19978 | 922 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 77.3 | 15 | 231832 | 1980 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 90.2 | 15 | 266957 | 2274 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 66.4 | 12 | 199857 | 1472 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 3.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 73.8 | 16 | 77097 | 2372 | 0 | 0 | 0 | 1 | 0 | — | — |
| queue-clear | local-reference | 2 | pass | done | 45.6 | 10 | 35936 | 1620 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 3 | pass | done | 54.3 | 12 | 40800 | 1865 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | pass | done | 87.1 | 11 | 221562 | 2847 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 86.5 | 11 | 174402 | 2681 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 90.5 | 9 | 222318 | 2675 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v3 | rifty | 1 | pass | done | 88.3 | 7 | 19374 | 3531 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty | 2 | pass | done | 105.2 | 7 | 21916 | 4697 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty | 3 | pass | done | 77.2 | 8 | 19854 | 3559 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 1 | pass | done | 70.8 | 7 | 17148 | 3289 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 2 | pass | done | 84.4 | 8 | 18329 | 3782 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 3 | pass | done | 89.1 | 8 | 18571 | 3800 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | local-reference | 1 | pass | done | 95.0 | 5 | 18460 | 4165 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | local-reference | 2 | pass | done | 104.2 | 8 | 20930 | 4946 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | local-reference | 3 | pass | done | 87.9 | 7 | 18812 | 4031 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | native-codex | 1 | pass | done | 160.5 | 7 | 169114 | 6432 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v3 | native-codex | 2 | pass | done | 150.1 | 7 | 163576 | 6212 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v3 | native-codex | 3 | pass | done | 153.5 | 8 | 175986 | 6139 | unknown | unknown | unknown | unknown | unknown | — | — |
| markdown-notes-v2 | rifty | 1 | fail | done | 84.8 | 6 | 14773 | 3714 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v2 | rifty | 2 | pass | done | 110.3 | 8 | 23246 | 4649 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v2 | rifty | 3 | fail | done | 93.6 | 6 | 16488 | 4579 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | 4cc4b4d552218cb69b7b4749f22c2873cc73891a11ec999a5cdfa9ed4ee00637 |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 84079bb9c8a46e180eaa237dcfc6b47032574b4772ace17160362ac2df6ecbb9 |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 1eeff323c30ad473c0cb0df1b71265857c192d36542de04cc418b95560dc5296 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 86b3ccdf2e6c6dcfac0c29e08d5a1a4f19e4743e3b62c8ed4d247959fea85c09 |
| csv-workflow-v3 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | ac42b356fb70f007660f267b8c3878056dba0ded31e73a3f2e373feba4a2a338 |
| markdown-notes-v2 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | 527a601ca7bc13db37b9f074cc85051f0b4db20417b7152db542a364c1cd93e3 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:07.697Z","complete":"2026-10-05T21:26:16.400Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:16.403Z","complete":"2026-10-05T21:26:24.711Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:24.715Z","complete":"2026-10-05T21:26:33.407Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:33.411Z","complete":"2026-10-05T21:26:39.796Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:39.802Z","complete":"2026-10-05T21:26:46.056Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:26:46.060Z","complete":"2026-10-05T21:26:52.042Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-05T21:26:52.048Z","agentStart":"2026-10-05T21:26:53.076Z","agentEnd":"2026-10-05T21:27:13.186Z","judgeStart":"2026-10-05T21:27:13.191Z","judgeEnd":"2026-10-05T21:27:13.259Z","complete":"2026-10-05T21:27:13.273Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-05T21:27:13.285Z","agentStart":"2026-10-05T21:27:14.306Z","agentEnd":"2026-10-05T21:27:32.789Z","judgeStart":"2026-10-05T21:27:32.796Z","judgeEnd":"2026-10-05T21:27:32.854Z","complete":"2026-10-05T21:27:32.860Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-05T21:27:32.864Z","agentStart":"2026-10-05T21:27:33.851Z","agentEnd":"2026-10-05T21:27:53.000Z","judgeStart":"2026-10-05T21:27:53.007Z","judgeEnd":"2026-10-05T21:27:53.066Z","complete":"2026-10-05T21:27:53.072Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-05T21:27:53.077Z","agentStart":"2026-10-05T21:27:54.112Z","agentEnd":"2026-10-05T21:28:38.303Z","judgeStart":"2026-10-05T21:28:38.306Z","judgeEnd":"2026-10-05T21:28:38.366Z","complete":"2026-10-05T21:28:38.374Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-05T21:28:38.381Z","agentStart":"2026-10-05T21:28:39.529Z","agentEnd":"2026-10-05T21:29:33.291Z","judgeStart":"2026-10-05T21:29:33.296Z","judgeEnd":"2026-10-05T21:29:33.367Z","complete":"2026-10-05T21:29:33.376Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-05T21:29:33.382Z","agentStart":"2026-10-05T21:29:34.506Z","agentEnd":"2026-10-05T21:30:22.996Z","judgeStart":"2026-10-05T21:30:23.001Z","judgeEnd":"2026-10-05T21:30:23.059Z","complete":"2026-10-05T21:30:23.067Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:23.073Z","complete":"2026-10-05T21:30:28.848Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:28.854Z","complete":"2026-10-05T21:30:34.626Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:34.631Z","complete":"2026-10-05T21:30:40.287Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:40.293Z","complete":"2026-10-05T21:30:44.015Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:44.035Z","complete":"2026-10-05T21:30:48.333Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:30:48.339Z","complete":"2026-10-05T21:30:52.190Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-05T21:30:52.194Z","agentStart":"2026-10-05T21:30:52.678Z","agentEnd":"2026-10-05T21:31:10.125Z","judgeStart":"2026-10-05T21:31:10.131Z","judgeEnd":"2026-10-05T21:31:10.194Z","complete":"2026-10-05T21:31:10.202Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-05T21:31:10.207Z","agentStart":"2026-10-05T21:31:10.676Z","agentEnd":"2026-10-05T21:31:32.180Z","judgeStart":"2026-10-05T21:31:32.187Z","judgeEnd":"2026-10-05T21:31:32.270Z","complete":"2026-10-05T21:31:32.276Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-05T21:31:32.281Z","agentStart":"2026-10-05T21:31:32.731Z","agentEnd":"2026-10-05T21:31:51.182Z","judgeStart":"2026-10-05T21:31:51.189Z","judgeEnd":"2026-10-05T21:31:51.260Z","complete":"2026-10-05T21:31:51.272Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-05T21:31:51.290Z","agentStart":"2026-10-05T21:31:51.788Z","agentEnd":"2026-10-05T21:32:36.930Z","judgeStart":"2026-10-05T21:32:36.934Z","judgeEnd":"2026-10-05T21:32:36.993Z","complete":"2026-10-05T21:32:37.000Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-05T21:32:37.007Z","agentStart":"2026-10-05T21:32:37.525Z","agentEnd":"2026-10-05T21:33:19.056Z","judgeStart":"2026-10-05T21:33:19.058Z","judgeEnd":"2026-10-05T21:33:19.101Z","complete":"2026-10-05T21:33:19.106Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-05T21:33:19.112Z","agentStart":"2026-10-05T21:33:19.664Z","agentEnd":"2026-10-05T21:34:00.011Z","judgeStart":"2026-10-05T21:34:00.016Z","judgeEnd":"2026-10-05T21:34:00.079Z","complete":"2026-10-05T21:34:00.087Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:34:00.095Z","complete":"2026-10-05T21:35:31.617Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:35:31.627Z","complete":"2026-10-05T21:37:03.090Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:37:03.096Z","complete":"2026-10-05T21:38:34.565Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:38:34.576Z","complete":"2026-10-05T21:38:43.692Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:38:43.701Z","complete":"2026-10-05T21:38:52.630Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:38:52.637Z","complete":"2026-10-05T21:39:01.435Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-05T21:39:01.441Z","agentStart":"2026-10-05T21:39:02.625Z","agentEnd":"2026-10-05T21:39:57.304Z","judgeStart":"2026-10-05T21:39:57.313Z","judgeEnd":"2026-10-05T21:39:57.353Z","complete":"2026-10-05T21:39:57.359Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-05T21:39:57.365Z","agentStart":"2026-10-05T21:39:58.577Z","agentEnd":"2026-10-05T21:40:20.498Z","judgeStart":"2026-10-05T21:40:20.508Z","judgeEnd":"2026-10-05T21:40:20.559Z","complete":"2026-10-05T21:40:20.566Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-05T21:40:20.573Z","agentStart":"2026-10-05T21:40:21.848Z","agentEnd":"2026-10-05T21:40:57.694Z","judgeStart":"2026-10-05T21:40:57.717Z","judgeEnd":"2026-10-05T21:40:57.777Z","complete":"2026-10-05T21:40:57.785Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-05T21:40:57.795Z","agentStart":"2026-10-05T21:40:59.245Z","agentEnd":"2026-10-05T21:42:16.553Z","judgeStart":"2026-10-05T21:42:16.562Z","judgeEnd":"2026-10-05T21:42:16.621Z","complete":"2026-10-05T21:42:16.630Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-05T21:42:16.641Z","agentStart":"2026-10-05T21:42:17.894Z","agentEnd":"2026-10-05T21:43:48.096Z","judgeStart":"2026-10-05T21:43:48.105Z","judgeEnd":"2026-10-05T21:43:48.174Z","complete":"2026-10-05T21:43:48.184Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-05T21:43:48.195Z","agentStart":"2026-10-05T21:43:49.437Z","agentEnd":"2026-10-05T21:44:55.817Z","judgeStart":"2026-10-05T21:44:55.825Z","judgeEnd":"2026-10-05T21:44:55.881Z","complete":"2026-10-05T21:44:55.892Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:44:55.904Z","complete":"2026-10-05T21:46:27.394Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:46:27.411Z","complete":"2026-10-05T21:46:31.172Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:46:31.183Z","complete":"2026-10-05T21:48:02.695Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:48:02.731Z","complete":"2026-10-05T21:48:04.530Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:48:04.544Z","complete":"2026-10-05T21:48:06.342Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T21:48:06.352Z","complete":"2026-10-05T21:48:08.161Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-05T21:48:08.175Z","agentStart":"2026-10-05T21:48:31.571Z","agentEnd":"2026-10-05T21:49:45.359Z","judgeStart":"2026-10-05T21:49:45.374Z","judgeEnd":"2026-10-05T21:49:46.956Z","complete":"2026-10-05T21:49:46.968Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-05T21:49:46.985Z","agentStart":"2026-10-05T21:50:02.670Z","agentEnd":"2026-10-05T21:50:48.246Z","judgeStart":"2026-10-05T21:50:48.256Z","judgeEnd":"2026-10-05T21:50:49.877Z","complete":"2026-10-05T21:50:49.894Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-05T21:50:49.925Z","agentStart":"2026-10-05T21:51:05.273Z","agentEnd":"2026-10-05T21:51:59.533Z","judgeStart":"2026-10-05T21:51:59.544Z","judgeEnd":"2026-10-05T21:52:01.143Z","complete":"2026-10-05T21:52:01.159Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-05T21:52:01.178Z","agentStart":"2026-10-05T21:52:15.930Z","agentEnd":"2026-10-05T21:53:42.996Z","judgeStart":"2026-10-05T21:53:43.003Z","judgeEnd":"2026-10-05T21:53:44.593Z","complete":"2026-10-05T21:53:44.602Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-05T21:53:44.614Z","agentStart":"2026-10-05T21:53:59.757Z","agentEnd":"2026-10-05T21:55:26.281Z","judgeStart":"2026-10-05T21:55:26.296Z","judgeEnd":"2026-10-05T21:55:27.862Z","complete":"2026-10-05T21:55:27.873Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-05T21:55:27.886Z","agentStart":"2026-10-05T21:55:42.363Z","agentEnd":"2026-10-05T21:57:12.906Z","judgeStart":"2026-10-05T21:57:12.912Z","judgeEnd":"2026-10-05T21:57:14.515Z","complete":"2026-10-05T21:57:14.529Z"} |
| csv-workflow-v3/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/after.json | {"start":"2026-10-05T21:57:14.547Z","agentStart":"2026-10-05T21:57:22.806Z","agentEnd":"2026-10-05T21:58:51.071Z","judgeStart":"2026-10-05T21:58:51.360Z","judgeEnd":"2026-10-05T21:58:53.057Z","complete":"2026-10-05T21:58:53.317Z"} |
| csv-workflow-v3/rifty/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/after.json | {"start":"2026-10-05T21:58:53.330Z","agentStart":"2026-10-05T21:59:00.277Z","agentEnd":"2026-10-05T22:00:45.495Z","judgeStart":"2026-10-05T22:00:45.865Z","judgeEnd":"2026-10-05T22:00:47.325Z","complete":"2026-10-05T22:00:47.708Z"} |
| csv-workflow-v3/rifty/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/after.json | {"start":"2026-10-05T22:00:47.721Z","agentStart":"2026-10-05T22:00:54.004Z","agentEnd":"2026-10-05T22:02:11.199Z","judgeStart":"2026-10-05T22:02:11.463Z","judgeEnd":"2026-10-05T22:02:19.511Z","complete":"2026-10-05T22:02:19.808Z"} |
| csv-workflow-v3/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/after.json | {"start":"2026-10-05T22:02:19.829Z","agentStart":"2026-10-05T22:02:23.744Z","agentEnd":"2026-10-05T22:03:34.581Z","judgeStart":"2026-10-05T22:03:34.725Z","judgeEnd":"2026-10-05T22:03:42.165Z","complete":"2026-10-05T22:03:42.337Z"} |
| csv-workflow-v3/rifty-no-coi/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/after.json | {"start":"2026-10-05T22:03:42.352Z","agentStart":"2026-10-05T22:03:48.384Z","agentEnd":"2026-10-05T22:05:12.793Z","judgeStart":"2026-10-05T22:05:13.086Z","judgeEnd":"2026-10-05T22:05:20.858Z","complete":"2026-10-05T22:05:21.700Z"} |
| csv-workflow-v3/rifty-no-coi/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/after.json | {"start":"2026-10-05T22:05:21.730Z","agentStart":"2026-10-05T22:05:27.269Z","agentEnd":"2026-10-05T22:06:56.401Z","judgeStart":"2026-10-05T22:06:56.650Z","judgeEnd":"2026-10-05T22:07:04.203Z","complete":"2026-10-05T22:07:04.410Z"} |
| csv-workflow-v3/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/after.json | {"start":"2026-10-05T22:07:04.432Z","agentStart":"2026-10-05T22:07:07.033Z","agentEnd":"2026-10-05T22:08:42.061Z","judgeStart":"2026-10-05T22:08:42.073Z","judgeEnd":"2026-10-05T22:08:49.371Z","complete":"2026-10-05T22:08:49.443Z"} |
| csv-workflow-v3/local-reference/2 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/2/after.json | {"start":"2026-10-05T22:08:49.462Z","agentStart":"2026-10-05T22:08:51.832Z","agentEnd":"2026-10-05T22:10:35.982Z","judgeStart":"2026-10-05T22:10:35.998Z","judgeEnd":"2026-10-05T22:10:37.746Z","complete":"2026-10-05T22:10:37.850Z"} |
| csv-workflow-v3/local-reference/3 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/3/after.json | {"start":"2026-10-05T22:10:37.879Z","agentStart":"2026-10-05T22:10:40.689Z","agentEnd":"2026-10-05T22:12:08.603Z","judgeStart":"2026-10-05T22:12:08.629Z","judgeEnd":"2026-10-05T22:12:16.578Z","complete":"2026-10-05T22:12:16.657Z"} |
| csv-workflow-v3/native-codex/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/after.json | {"start":"2026-10-05T22:12:16.681Z","agentStart":"2026-10-05T22:12:20.051Z","agentEnd":"2026-10-05T22:15:00.515Z","judgeStart":"2026-10-05T22:15:00.517Z","judgeEnd":"2026-10-05T22:15:08.101Z","complete":"2026-10-05T22:15:08.137Z"} |
| csv-workflow-v3/native-codex/2 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/2/after.json | {"start":"2026-10-05T22:15:08.152Z","agentStart":"2026-10-05T22:15:10.916Z","agentEnd":"2026-10-05T22:17:41.002Z","judgeStart":"2026-10-05T22:17:41.006Z","judgeEnd":"2026-10-05T22:17:48.247Z","complete":"2026-10-05T22:17:48.289Z"} |
| csv-workflow-v3/native-codex/3 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/3/after.json | {"start":"2026-10-05T22:17:48.307Z","agentStart":"2026-10-05T22:17:51.033Z","agentEnd":"2026-10-05T22:20:24.484Z","judgeStart":"2026-10-05T22:20:24.488Z","judgeEnd":"2026-10-05T22:20:32.202Z","complete":"2026-10-05T22:20:32.239Z"} |
| markdown-notes-v2/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/1/after.json | {"start":"2026-10-05T22:20:32.257Z","agentStart":"2026-10-05T22:20:39.627Z","agentEnd":"2026-10-05T22:22:04.447Z","judgeStart":"2026-10-05T22:22:04.939Z","judgeEnd":"2026-10-05T22:22:06.139Z","complete":"2026-10-05T22:22:06.515Z"} |
| markdown-notes-v2/rifty/2 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/2/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/2/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/2/after.json | {"start":"2026-10-05T22:22:06.530Z","agentStart":"2026-10-05T22:22:12.839Z","agentEnd":"2026-10-05T22:24:03.155Z","judgeStart":"2026-10-05T22:24:03.827Z","judgeEnd":"2026-10-05T22:24:05.003Z","complete":"2026-10-05T22:24:05.495Z"} |
| markdown-notes-v2/rifty/3 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/3/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/3/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v2/rifty/3/after.json | {"start":"2026-10-05T22:24:05.510Z","agentStart":"2026-10-05T22:24:12.817Z","agentEnd":"2026-10-05T22:25:46.411Z","judgeStart":"2026-10-05T22:25:47.183Z","judgeEnd":"2026-10-05T22:26:18.159Z","complete":"2026-10-05T22:26:18.679Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 72; retained 63; missing 9.
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
| ms-negative | calibration/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 50098/1742 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 455263/2886 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 64344/1609 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 376103/3013 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 111663/3171 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 698646/5726 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 153833/5857 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 618282/8203 |
| csv-workflow-v3 | evaluation/app | rifty | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [-0.899, 0.899] | {} | 61144/11787 |
| csv-workflow-v3 | evaluation/app | rifty-no-coi | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [-0.899, 0.899] | {} | 54048/10871 |
| csv-workflow-v3 | evaluation/app | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 58202/13142 |
| csv-workflow-v3 | evaluation/app | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 508676/18783 |
| markdown-notes-v2 | evaluation/app | rifty | 1/3 | 0 | 0/0 | 0.333 | [0.008, 0.906] | unavailable | unavailable | {"functional":2} | 54507/12942 |
| markdown-notes-v2 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v2 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v2 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | all | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | project-change | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | all | rifty-no-coi | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | project-change | rifty-no-coi | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | all | local-reference | 2/1 | 6/6 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | project-change | local-reference | 2/1 | 6/6 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 6/6 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 6/6 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| calibration | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | all | rifty | 4/4 | 4/12 | 0 | 0.333 | [0.025, 0.945] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | all | rifty-no-coi | 4/4 | 3/12 | 3 | unavailable | [0.025, 0.949] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 4/4 | 9/12 | 3 | unavailable | [0.076, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/4 | 9/12 | 3 | unavailable | [0.076, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/2 | 4/6 | 0 | 0.667 | [0.051, 0.991] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 3/6 | 3 | unavailable | [0.051, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 3/6 | 3 | unavailable | [0.051, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 3/6 | 3 | unavailable | [0.051, 1.000] | separate reference | unavailable |
