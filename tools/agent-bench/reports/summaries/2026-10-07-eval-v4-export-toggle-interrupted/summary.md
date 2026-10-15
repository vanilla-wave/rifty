# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v4; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 4e0283a3060c03a7a26bdf1257447d5cae23bebd; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 96; retained 55.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| csv-workflow-v4 | local-reference | 2 | missing | unfinished |
| csv-workflow-v4 | local-reference | 3 | missing | not started |
| csv-workflow-v4 | native-codex | 1 | missing | not started |
| csv-workflow-v4 | native-codex | 2 | missing | not started |
| csv-workflow-v4 | native-codex | 3 | missing | not started |
| markdown-notes-v4 | rifty | 1 | missing | not started |
| markdown-notes-v4 | rifty | 2 | missing | not started |
| markdown-notes-v4 | rifty | 3 | missing | not started |
| markdown-notes-v4 | rifty-no-coi | 1 | missing | not started |
| markdown-notes-v4 | rifty-no-coi | 2 | missing | not started |
| markdown-notes-v4 | rifty-no-coi | 3 | missing | not started |
| markdown-notes-v4 | local-reference | 1 | missing | not started |
| markdown-notes-v4 | local-reference | 2 | missing | not started |
| markdown-notes-v4 | local-reference | 3 | missing | not started |
| markdown-notes-v4 | native-codex | 1 | missing | not started |
| markdown-notes-v4 | native-codex | 2 | missing | not started |
| markdown-notes-v4 | native-codex | 3 | missing | not started |
| booking-workflow-v2 | rifty | 1 | missing | not started |
| booking-workflow-v2 | rifty | 2 | missing | not started |
| booking-workflow-v2 | rifty | 3 | missing | not started |
| booking-workflow-v2 | rifty-no-coi | 1 | missing | not started |
| booking-workflow-v2 | rifty-no-coi | 2 | missing | not started |
| booking-workflow-v2 | rifty-no-coi | 3 | missing | not started |
| booking-workflow-v2 | local-reference | 1 | missing | not started |
| booking-workflow-v2 | local-reference | 2 | missing | not started |
| booking-workflow-v2 | local-reference | 3 | missing | not started |
| booking-workflow-v2 | native-codex | 1 | missing | not started |
| booking-workflow-v2 | native-codex | 2 | missing | not started |
| booking-workflow-v2 | native-codex | 3 | missing | not started |
| expense-settlement-v2 | rifty | 1 | missing | not started |
| expense-settlement-v2 | rifty | 2 | missing | not started |
| expense-settlement-v2 | rifty | 3 | missing | not started |
| expense-settlement-v2 | rifty-no-coi | 1 | missing | not started |
| expense-settlement-v2 | rifty-no-coi | 2 | missing | not started |
| expense-settlement-v2 | rifty-no-coi | 3 | missing | not started |
| expense-settlement-v2 | local-reference | 1 | missing | not started |
| expense-settlement-v2 | local-reference | 2 | missing | not started |
| expense-settlement-v2 | local-reference | 3 | missing | not started |
| expense-settlement-v2 | native-codex | 1 | missing | not started |
| expense-settlement-v2 | native-codex | 2 | missing | not started |
| expense-settlement-v2 | native-codex | 3 | missing | not started |
| ms-negative | rifty | 1 | fail | error | 11.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 7.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 7.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 5.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 5.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 16.8 | 6 | 15412 | 511 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | pass | done | 18.4 | 6 | 17146 | 664 | 0 | 0 | 0 | 0 | 2 | — | — |
| ms-negative | local-reference | 3 | pass | done | 40.1 | 6 | 29922 | 959 | 0 | 0 | 0 | 0 | 8 | — | — |
| ms-negative | native-codex | 1 | pass | done | 37.3 | 8 | 149191 | 949 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 42.5 | 8 | 151241 | 982 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 39.3 | 9 | 150548 | 822 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 24.6 | 9 | 21993 | 724 | 0 | 0 | 0 | 0 | 4 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 19.8 | 7 | 21880 | 698 | 0 | 0 | 0 | 0 | 5 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 29.4 | 8 | 37257 | 1105 | 0 | 0 | 0 | 0 | 8 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 34.7 | 7 | 136905 | 969 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 34.8 | 7 | 131821 | 972 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 34.2 | 7 | 131861 | 1036 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 10.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 10.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 12.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 12.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 25.3 | 10 | 27905 | 1056 | 0 | 0 | 0 | 0 | 4 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 25.0 | 10 | 27868 | 744 | 0 | 0 | 0 | 0 | 2 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 21.5 | 8 | 19752 | 1000 | 0 | 0 | 0 | 0 | 4 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 54.1 | 11 | 205062 | 1704 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 72.0 | 12 | 207016 | 2428 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 58.1 | 11 | 195465 | 1872 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 26.9 | 8 | 24311 | 1186 | 0 | 0 | 0 | 0 | 2 | — | — |
| queue-clear | local-reference | 2 | pass | done | 65.9 | 17 | 85121 | 2052 | 0 | 0 | 0 | 0 | 12 | — | — |
| queue-clear | local-reference | 3 | pass | done | 62.1 | 13 | 103993 | 2052 | 0 | 0 | 0 | 0 | 18 | — | — |
| queue-clear | native-codex | 1 | pass | done | 64.9 | 8 | 225557 | 2499 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 79.0 | 9 | 276235 | 2715 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 70.7 | 8 | 248792 | 2572 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v4 | rifty | 1 | fail | done | 77.7 | 10 | 26114 | 5318 | 0 | 0 | 1 | 0 | 3 | — | — |
| csv-workflow-v4 | rifty | 2 | fail | done | 51.2 | 9 | 37601 | 4967 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | rifty | 3 | pass | done | 55.4 | 14 | 43844 | 5709 | 0 | 0 | 1 | 0 | 6 | — | — |
| csv-workflow-v4 | rifty-no-coi | 1 | pass | done | 75.1 | 14 | 28805 | 5356 | 0 | 0 | 1 | 0 | 7 | — | — |
| csv-workflow-v4 | rifty-no-coi | 2 | pass | done | 65.1 | 11 | 21382 | 4054 | 0 | 0 | 1 | 0 | 4 | — | — |
| csv-workflow-v4 | rifty-no-coi | 3 | pass | done | 63.2 | 8 | 20247 | 4604 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | local-reference | 1 | pass | done | 74.5 | 7 | 23832 | 5630 | 0 | 0 | 0 | 0 | 2 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | e43a990bfa50e67361709d521e3321734bab4cd9305268b2b91bec3ad504f60c |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | e1365c0d4a806cde2117e28c674221b8469b805e9cc8784e5904636595eea69e |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 3d700155630918e9d4e9ff15ba1c2b204ac7726b8dcdfe8c72e9f85678db5ec8 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 75a00764cb2d7673d88f9c82c077ecd8f5aeef05e2451d70da79a46ce510c4be |
| csv-workflow-v4 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | 12cc2cda1d51973b523cf3a96886a915a5a6faef92ec7cb741ab579c1c6110ae |
| markdown-notes-v4 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | c4ca2c7bb0812d4fb4c100381168487cc89cfcc328c309af1c5870e6b20baf45 |
| booking-workflow-v2 | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | 3923aeb464a97b83f16e8e4add0c8047f7b29436ef32218060a863beb133c86a |
| expense-settlement-v2 | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | dae1b69446eb3fbb5939606ac23276f185f9fe56dad650af3b016ea98ad20ae9 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:34:39.197Z","complete":"2026-10-06T21:34:50.509Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:34:50.516Z","complete":"2026-10-06T21:34:58.251Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:34:58.257Z","complete":"2026-10-06T21:35:05.992Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:35:05.999Z","complete":"2026-10-06T21:35:11.583Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:35:11.598Z","complete":"2026-10-06T21:35:16.980Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:35:16.985Z","complete":"2026-10-06T21:35:22.382Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-06T21:35:22.387Z","agentStart":"2026-10-06T21:35:23.899Z","agentEnd":"2026-10-06T21:35:40.728Z","judgeStart":"2026-10-06T21:35:40.739Z","judgeEnd":"2026-10-06T21:35:40.810Z","complete":"2026-10-06T21:35:40.828Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-06T21:35:40.835Z","agentStart":"2026-10-06T21:35:42.180Z","agentEnd":"2026-10-06T21:36:00.601Z","judgeStart":"2026-10-06T21:36:00.606Z","judgeEnd":"2026-10-06T21:36:00.651Z","complete":"2026-10-06T21:36:00.660Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-06T21:36:00.666Z","agentStart":"2026-10-06T21:36:02.046Z","agentEnd":"2026-10-06T21:36:42.177Z","judgeStart":"2026-10-06T21:36:42.185Z","judgeEnd":"2026-10-06T21:36:42.231Z","complete":"2026-10-06T21:36:42.244Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-06T21:36:42.253Z","agentStart":"2026-10-06T21:36:43.815Z","agentEnd":"2026-10-06T21:37:21.127Z","judgeStart":"2026-10-06T21:37:21.142Z","judgeEnd":"2026-10-06T21:37:21.193Z","complete":"2026-10-06T21:37:21.205Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-06T21:37:21.212Z","agentStart":"2026-10-06T21:37:23.263Z","agentEnd":"2026-10-06T21:38:05.801Z","judgeStart":"2026-10-06T21:38:05.804Z","judgeEnd":"2026-10-06T21:38:05.857Z","complete":"2026-10-06T21:38:05.866Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-06T21:38:05.871Z","agentStart":"2026-10-06T21:38:07.253Z","agentEnd":"2026-10-06T21:38:46.583Z","judgeStart":"2026-10-06T21:38:46.586Z","judgeEnd":"2026-10-06T21:38:46.635Z","complete":"2026-10-06T21:38:46.650Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:38:46.658Z","complete":"2026-10-06T21:38:51.898Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:38:51.905Z","complete":"2026-10-06T21:38:57.523Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:38:57.529Z","complete":"2026-10-06T21:39:03.393Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:39:03.399Z","complete":"2026-10-06T21:39:06.483Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:39:06.490Z","complete":"2026-10-06T21:39:09.813Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:39:09.819Z","complete":"2026-10-06T21:39:13.016Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-06T21:39:13.023Z","agentStart":"2026-10-06T21:39:13.725Z","agentEnd":"2026-10-06T21:39:38.322Z","judgeStart":"2026-10-06T21:39:38.327Z","judgeEnd":"2026-10-06T21:39:38.369Z","complete":"2026-10-06T21:39:38.383Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-06T21:39:38.393Z","agentStart":"2026-10-06T21:39:39.094Z","agentEnd":"2026-10-06T21:39:58.860Z","judgeStart":"2026-10-06T21:39:58.865Z","judgeEnd":"2026-10-06T21:39:58.914Z","complete":"2026-10-06T21:39:58.933Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-06T21:39:58.940Z","agentStart":"2026-10-06T21:39:59.890Z","agentEnd":"2026-10-06T21:40:29.301Z","judgeStart":"2026-10-06T21:40:29.309Z","judgeEnd":"2026-10-06T21:40:29.353Z","complete":"2026-10-06T21:40:29.363Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-06T21:40:29.369Z","agentStart":"2026-10-06T21:40:30.122Z","agentEnd":"2026-10-06T21:41:04.840Z","judgeStart":"2026-10-06T21:41:04.844Z","judgeEnd":"2026-10-06T21:41:04.884Z","complete":"2026-10-06T21:41:04.895Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-06T21:41:04.901Z","agentStart":"2026-10-06T21:41:05.737Z","agentEnd":"2026-10-06T21:41:40.585Z","judgeStart":"2026-10-06T21:41:40.588Z","judgeEnd":"2026-10-06T21:41:40.651Z","complete":"2026-10-06T21:41:40.667Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-06T21:41:40.675Z","agentStart":"2026-10-06T21:41:41.530Z","agentEnd":"2026-10-06T21:42:15.728Z","judgeStart":"2026-10-06T21:42:15.732Z","judgeEnd":"2026-10-06T21:42:15.779Z","complete":"2026-10-06T21:42:15.792Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:42:15.800Z","complete":"2026-10-06T21:42:26.553Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:42:26.569Z","complete":"2026-10-06T21:42:37.466Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:42:37.474Z","complete":"2026-10-06T21:42:49.461Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:42:49.469Z","complete":"2026-10-06T21:42:58.755Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:42:58.763Z","complete":"2026-10-06T21:43:07.745Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:43:07.753Z","complete":"2026-10-06T21:43:20.210Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-06T21:43:20.236Z","agentStart":"2026-10-06T21:43:22.556Z","agentEnd":"2026-10-06T21:43:47.843Z","judgeStart":"2026-10-06T21:43:47.864Z","judgeEnd":"2026-10-06T21:43:47.913Z","complete":"2026-10-06T21:43:47.965Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-06T21:43:47.974Z","agentStart":"2026-10-06T21:43:50.457Z","agentEnd":"2026-10-06T21:44:15.470Z","judgeStart":"2026-10-06T21:44:15.479Z","judgeEnd":"2026-10-06T21:44:15.542Z","complete":"2026-10-06T21:44:15.559Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-06T21:44:15.567Z","agentStart":"2026-10-06T21:44:17.529Z","agentEnd":"2026-10-06T21:44:38.995Z","judgeStart":"2026-10-06T21:44:39.006Z","judgeEnd":"2026-10-06T21:44:39.061Z","complete":"2026-10-06T21:44:39.078Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-06T21:44:39.087Z","agentStart":"2026-10-06T21:44:41.071Z","agentEnd":"2026-10-06T21:45:35.133Z","judgeStart":"2026-10-06T21:45:35.142Z","judgeEnd":"2026-10-06T21:45:35.193Z","complete":"2026-10-06T21:45:35.209Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-06T21:45:35.229Z","agentStart":"2026-10-06T21:45:36.853Z","agentEnd":"2026-10-06T21:46:48.890Z","judgeStart":"2026-10-06T21:46:48.900Z","judgeEnd":"2026-10-06T21:46:48.945Z","complete":"2026-10-06T21:46:48.962Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-06T21:46:48.971Z","agentStart":"2026-10-06T21:46:50.583Z","agentEnd":"2026-10-06T21:47:48.673Z","judgeStart":"2026-10-06T21:47:48.680Z","judgeEnd":"2026-10-06T21:47:48.721Z","complete":"2026-10-06T21:47:48.737Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:47:48.749Z","complete":"2026-10-06T21:49:20.190Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:49:20.200Z","complete":"2026-10-06T21:49:23.501Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:49:23.512Z","complete":"2026-10-06T21:50:54.979Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:50:54.990Z","complete":"2026-10-06T21:50:56.815Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:50:56.824Z","complete":"2026-10-06T21:50:58.547Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T21:50:58.556Z","complete":"2026-10-06T21:51:00.440Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-06T21:51:00.450Z","agentStart":"2026-10-06T21:51:46.130Z","agentEnd":"2026-10-06T21:52:13.071Z","judgeStart":"2026-10-06T21:52:13.079Z","judgeEnd":"2026-10-06T21:52:14.657Z","complete":"2026-10-06T21:52:14.680Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-06T21:52:14.695Z","agentStart":"2026-10-06T21:52:34.425Z","agentEnd":"2026-10-06T21:53:40.282Z","judgeStart":"2026-10-06T21:53:40.294Z","judgeEnd":"2026-10-06T21:53:41.864Z","complete":"2026-10-06T21:53:41.884Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-06T21:53:41.896Z","agentStart":"2026-10-06T21:53:59.437Z","agentEnd":"2026-10-06T21:55:01.581Z","judgeStart":"2026-10-06T21:55:01.595Z","judgeEnd":"2026-10-06T21:55:03.160Z","complete":"2026-10-06T21:55:03.180Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-06T21:55:03.195Z","agentStart":"2026-10-06T21:55:24.038Z","agentEnd":"2026-10-06T21:56:28.982Z","judgeStart":"2026-10-06T21:56:28.988Z","judgeEnd":"2026-10-06T21:56:30.558Z","complete":"2026-10-06T21:56:30.579Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-06T21:56:30.591Z","agentStart":"2026-10-06T21:56:52.339Z","agentEnd":"2026-10-06T21:58:11.339Z","judgeStart":"2026-10-06T21:58:11.346Z","judgeEnd":"2026-10-06T21:58:12.926Z","complete":"2026-10-06T21:58:12.947Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-06T21:58:12.960Z","agentStart":"2026-10-06T21:58:32.873Z","agentEnd":"2026-10-06T21:59:43.534Z","judgeStart":"2026-10-06T21:59:43.540Z","judgeEnd":"2026-10-06T21:59:45.110Z","complete":"2026-10-06T21:59:45.133Z"} |
| csv-workflow-v4/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/after.json | {"start":"2026-10-06T21:59:45.149Z","agentStart":"2026-10-06T21:59:52.593Z","agentEnd":"2026-10-06T22:01:10.266Z","judgeStart":"2026-10-06T22:01:10.773Z","judgeEnd":"2026-10-06T22:01:24.433Z","complete":"2026-10-06T22:01:24.955Z"} |
| csv-workflow-v4/rifty/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/after.json | {"start":"2026-10-06T22:01:24.967Z","agentStart":"2026-10-06T22:01:32.299Z","agentEnd":"2026-10-06T22:02:23.467Z","judgeStart":"2026-10-06T22:02:23.941Z","judgeEnd":"2026-10-06T22:02:55.507Z","complete":"2026-10-06T22:02:55.895Z"} |
| csv-workflow-v4/rifty/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/after.json | {"start":"2026-10-06T22:02:55.908Z","agentStart":"2026-10-06T22:03:03.136Z","agentEnd":"2026-10-06T22:03:58.533Z","judgeStart":"2026-10-06T22:03:59.295Z","judgeEnd":"2026-10-06T22:04:12.710Z","complete":"2026-10-06T22:04:13.264Z"} |
| csv-workflow-v4/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/after.json | {"start":"2026-10-06T22:04:13.277Z","agentStart":"2026-10-06T22:04:17.324Z","agentEnd":"2026-10-06T22:05:32.466Z","judgeStart":"2026-10-06T22:05:32.846Z","judgeEnd":"2026-10-06T22:05:36.319Z","complete":"2026-10-06T22:05:36.638Z"} |
| csv-workflow-v4/rifty-no-coi/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/after.json | {"start":"2026-10-06T22:05:36.652Z","agentStart":"2026-10-06T22:05:40.395Z","agentEnd":"2026-10-06T22:06:45.500Z","judgeStart":"2026-10-06T22:06:45.730Z","judgeEnd":"2026-10-06T22:06:47.321Z","complete":"2026-10-06T22:06:47.495Z"} |
| csv-workflow-v4/rifty-no-coi/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/after.json | {"start":"2026-10-06T22:06:47.509Z","agentStart":"2026-10-06T22:06:51.654Z","agentEnd":"2026-10-06T22:07:54.871Z","judgeStart":"2026-10-06T22:07:55.172Z","judgeEnd":"2026-10-06T22:07:56.687Z","complete":"2026-10-06T22:07:56.927Z"} |
| csv-workflow-v4/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/after.json | {"start":"2026-10-06T22:07:56.944Z","agentStart":"2026-10-06T22:07:59.591Z","agentEnd":"2026-10-06T22:09:14.105Z","judgeStart":"2026-10-06T22:09:14.119Z","judgeEnd":"2026-10-06T22:09:27.657Z","complete":"2026-10-06T22:09:27.736Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 96; retained 55; missing 41.
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
| ms-negative | calibration/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 62480/2134 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 450980/2753 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 81130/2527 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 400587/2977 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 75525/2800 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 607543/6004 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 213425/5290 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 750584/7786 |
| csv-workflow-v4 | evaluation/app | rifty | 1/3 | 0 | 0/0 | 0.333 | [0.008, 0.906] | unavailable | unavailable | {"functional":2} | 107559/15994 |
| csv-workflow-v4 | evaluation/app | rifty-no-coi | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | unavailable | unavailable | {} | 70434/14014 |
| csv-workflow-v4 | evaluation/app | local-reference | 1/3 | 2 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 23832/5630 |
| csv-workflow-v4 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v4 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v4 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v4 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v4 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow-v2 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v2 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v2 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow-v2 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| expense-settlement-v2 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement-v2 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement-v2 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement-v2 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | all | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | project-change | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | all | rifty-no-coi | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | project-change | rifty-no-coi | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | all | local-reference | 2/1 | 6/6 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | project-change | local-reference | 2/1 | 6/6 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 6/6 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 6/6 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| calibration | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| calibration | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | all | rifty | 6/6 | 1/18 | 9 | unavailable | [0.000, 0.967] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | all | rifty-no-coi | 6/6 | 3/18 | 9 | unavailable | [0.015, 0.969] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 6/6 | 7/18 | 11 | unavailable | [0.031, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 6/18 | 12 | unavailable | [0.031, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 1/12 | 9 | unavailable | [0.000, 0.996] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 3/12 | 9 | unavailable | [0.023, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 1/12 | 11 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | separate reference | unavailable |
