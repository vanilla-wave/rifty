# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v3; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: a93beb5e3b6faa50385be6626e7b589d603fe19a; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: running; selected 96; retained 35.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| stringify-boxed | native-codex | 3 | missing | not started |
| queue-clear | rifty | 1 | missing | not started |
| queue-clear | rifty | 2 | missing | not started |
| queue-clear | rifty | 3 | missing | not started |
| queue-clear | rifty-no-coi | 1 | missing | not started |
| queue-clear | rifty-no-coi | 2 | missing | not started |
| queue-clear | rifty-no-coi | 3 | missing | not started |
| queue-clear | local-reference | 1 | missing | not started |
| queue-clear | local-reference | 2 | missing | not started |
| queue-clear | local-reference | 3 | missing | not started |
| queue-clear | native-codex | 1 | missing | not started |
| queue-clear | native-codex | 2 | missing | not started |
| queue-clear | native-codex | 3 | missing | not started |
| csv-workflow-v4 | rifty | 1 | missing | not started |
| csv-workflow-v4 | rifty | 2 | missing | not started |
| csv-workflow-v4 | rifty | 3 | missing | not started |
| csv-workflow-v4 | rifty-no-coi | 1 | missing | not started |
| csv-workflow-v4 | rifty-no-coi | 2 | missing | not started |
| csv-workflow-v4 | rifty-no-coi | 3 | missing | not started |
| csv-workflow-v4 | local-reference | 1 | missing | not started |
| csv-workflow-v4 | local-reference | 2 | missing | not started |
| csv-workflow-v4 | local-reference | 3 | missing | not started |
| csv-workflow-v4 | native-codex | 1 | missing | not started |
| csv-workflow-v4 | native-codex | 2 | missing | not started |
| csv-workflow-v4 | native-codex | 3 | missing | not started |
| markdown-notes-v3 | rifty | 1 | missing | not started |
| markdown-notes-v3 | rifty | 2 | missing | not started |
| markdown-notes-v3 | rifty | 3 | missing | not started |
| markdown-notes-v3 | rifty-no-coi | 1 | missing | not started |
| markdown-notes-v3 | rifty-no-coi | 2 | missing | not started |
| markdown-notes-v3 | rifty-no-coi | 3 | missing | not started |
| markdown-notes-v3 | local-reference | 1 | missing | not started |
| markdown-notes-v3 | local-reference | 2 | missing | not started |
| markdown-notes-v3 | local-reference | 3 | missing | not started |
| markdown-notes-v3 | native-codex | 1 | missing | not started |
| markdown-notes-v3 | native-codex | 2 | missing | not started |
| markdown-notes-v3 | native-codex | 3 | missing | not started |
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
| ms-negative | rifty | 1 | fail | error | 9.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 5.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 6.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 37.4 | 7 | 29191 | 741 | 1 | 0 | 0 | 0 | 5 | — | — |
| ms-negative | local-reference | 2 | pass | done | 20.9 | 8 | 30852 | 612 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 3 | pass | done | 19.1 | 7 | 22038 | 630 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 41.5 | 9 | 150565 | 841 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 46.6 | 9 | 150674 | 863 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 53.2 | 9 | 150220 | 1170 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 2.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 39.7 | 10 | 34162 | 989 | 0 | 0 | 0 | 0 | 2 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 38.0 | 7 | 21890 | 722 | 0 | 0 | 0 | 0 | 5 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 15.0 | 7 | 14975 | 461 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 58.1 | 6 | 111251 | 986 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 57.7 | 7 | 112845 | 1172 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 47.4 | 6 | 112067 | 1020 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 91.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 11.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 10.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 10.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 13.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 26.5 | 6 | 20389 | 795 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 37.9 | 12 | 24098 | 1011 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 53.6 | 9 | 20981 | 874 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 77.7 | 12 | 198692 | 1739 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 90.8 | 12 | 222513 | 1913 | unknown | unknown | unknown | unknown | unknown | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | c7f5e81afd61a945580c4b67c24fd5d92dbc639a5b6339e62b08b924bac9654c |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | f4450669e7e76e48d82b17a54d23cfcff85a8112a6f3cc13d1d1b9b6030d8955 |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 2a7f0fedfa7ecd037f3a95facc43f7abea6f18ea1084445084fa7cb42c209aa3 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 5112c62584ed7f9f43fa211ed561c990d1832f7ae8b76bf1584060a8beae0485 |
| csv-workflow-v4 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | 437e58e298ef391c61815cbb3d9fedbc0108e67e70ce235502bf3247f4a2e316 |
| markdown-notes-v3 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | a9a08b6f6adeb121b6112a6f08e6e62719f15b0a113215c64bd96d200503519b |
| booking-workflow-v2 | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | e13b6df3100cba0c3ec0ca8cff61e62d8522feee885dc58c79d925f112dc300d |
| expense-settlement-v2 | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | 98495ba74e8c2254527a5507ef14436e2133246d489eecee38ed3e62b0e3999a |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:21:40.215Z","complete":"2026-10-06T13:21:50.052Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:21:50.055Z","complete":"2026-10-06T13:21:58.795Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:21:58.799Z","complete":"2026-10-06T13:22:07.460Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:22:07.464Z","complete":"2026-10-06T13:22:13.778Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:22:13.783Z","complete":"2026-10-06T13:22:19.607Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:22:19.610Z","complete":"2026-10-06T13:22:25.782Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-06T13:22:25.788Z","agentStart":"2026-10-06T13:22:26.740Z","agentEnd":"2026-10-06T13:23:04.156Z","judgeStart":"2026-10-06T13:23:04.164Z","judgeEnd":"2026-10-06T13:23:04.216Z","complete":"2026-10-06T13:23:04.224Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-06T13:23:04.227Z","agentStart":"2026-10-06T13:23:05.173Z","agentEnd":"2026-10-06T13:23:26.065Z","judgeStart":"2026-10-06T13:23:26.072Z","judgeEnd":"2026-10-06T13:23:26.123Z","complete":"2026-10-06T13:23:26.131Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-06T13:23:26.135Z","agentStart":"2026-10-06T13:23:27.081Z","agentEnd":"2026-10-06T13:23:46.172Z","judgeStart":"2026-10-06T13:23:46.176Z","judgeEnd":"2026-10-06T13:23:46.233Z","complete":"2026-10-06T13:23:46.238Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-06T13:23:46.242Z","agentStart":"2026-10-06T13:23:47.372Z","agentEnd":"2026-10-06T13:24:28.832Z","judgeStart":"2026-10-06T13:24:28.836Z","judgeEnd":"2026-10-06T13:24:28.900Z","complete":"2026-10-06T13:24:28.905Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-06T13:24:28.909Z","agentStart":"2026-10-06T13:24:29.972Z","agentEnd":"2026-10-06T13:25:16.542Z","judgeStart":"2026-10-06T13:25:16.545Z","judgeEnd":"2026-10-06T13:25:16.603Z","complete":"2026-10-06T13:25:16.609Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-06T13:25:16.614Z","agentStart":"2026-10-06T13:25:17.589Z","agentEnd":"2026-10-06T13:26:10.819Z","judgeStart":"2026-10-06T13:26:10.823Z","judgeEnd":"2026-10-06T13:26:10.876Z","complete":"2026-10-06T13:26:10.881Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:10.886Z","complete":"2026-10-06T13:26:16.522Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:16.528Z","complete":"2026-10-06T13:26:22.123Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:22.128Z","complete":"2026-10-06T13:26:27.750Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:27.756Z","complete":"2026-10-06T13:26:30.769Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:30.775Z","complete":"2026-10-06T13:26:33.712Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:26:33.720Z","complete":"2026-10-06T13:26:36.805Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-06T13:26:36.810Z","agentStart":"2026-10-06T13:26:37.579Z","agentEnd":"2026-10-06T13:27:17.308Z","judgeStart":"2026-10-06T13:27:17.317Z","judgeEnd":"2026-10-06T13:27:17.366Z","complete":"2026-10-06T13:27:17.372Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-06T13:27:17.376Z","agentStart":"2026-10-06T13:27:17.814Z","agentEnd":"2026-10-06T13:27:55.805Z","judgeStart":"2026-10-06T13:27:55.812Z","judgeEnd":"2026-10-06T13:27:55.861Z","complete":"2026-10-06T13:27:55.866Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-06T13:27:55.871Z","agentStart":"2026-10-06T13:27:56.281Z","agentEnd":"2026-10-06T13:28:11.281Z","judgeStart":"2026-10-06T13:28:11.286Z","judgeEnd":"2026-10-06T13:28:11.338Z","complete":"2026-10-06T13:28:11.344Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-06T13:28:11.349Z","agentStart":"2026-10-06T13:28:11.803Z","agentEnd":"2026-10-06T13:29:09.939Z","judgeStart":"2026-10-06T13:29:09.941Z","judgeEnd":"2026-10-06T13:29:09.997Z","complete":"2026-10-06T13:29:10.004Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-06T13:29:10.011Z","agentStart":"2026-10-06T13:29:10.532Z","agentEnd":"2026-10-06T13:30:08.272Z","judgeStart":"2026-10-06T13:30:08.275Z","judgeEnd":"2026-10-06T13:30:08.340Z","complete":"2026-10-06T13:30:08.346Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-06T13:30:08.352Z","agentStart":"2026-10-06T13:30:08.800Z","agentEnd":"2026-10-06T13:30:56.222Z","judgeStart":"2026-10-06T13:30:56.225Z","judgeEnd":"2026-10-06T13:30:56.282Z","complete":"2026-10-06T13:30:56.288Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:30:56.294Z","complete":"2026-10-06T13:32:27.856Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:32:27.867Z","complete":"2026-10-06T13:32:39.430Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:32:39.436Z","complete":"2026-10-06T13:32:49.726Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:32:49.732Z","complete":"2026-10-06T13:32:58.854Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:32:58.863Z","complete":"2026-10-06T13:33:09.603Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T13:33:09.612Z","complete":"2026-10-06T13:33:22.992Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-06T13:33:23.003Z","agentStart":"2026-10-06T13:33:24.171Z","agentEnd":"2026-10-06T13:33:50.704Z","judgeStart":"2026-10-06T13:33:50.715Z","judgeEnd":"2026-10-06T13:33:50.762Z","complete":"2026-10-06T13:33:50.768Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-06T13:33:50.775Z","agentStart":"2026-10-06T13:33:51.939Z","agentEnd":"2026-10-06T13:34:29.861Z","judgeStart":"2026-10-06T13:34:29.874Z","judgeEnd":"2026-10-06T13:34:29.920Z","complete":"2026-10-06T13:34:29.926Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-06T13:34:29.934Z","agentStart":"2026-10-06T13:34:31.091Z","agentEnd":"2026-10-06T13:35:24.702Z","judgeStart":"2026-10-06T13:35:24.715Z","judgeEnd":"2026-10-06T13:35:24.771Z","complete":"2026-10-06T13:35:24.779Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-06T13:35:24.787Z","agentStart":"2026-10-06T13:35:25.965Z","agentEnd":"2026-10-06T13:36:43.683Z","judgeStart":"2026-10-06T13:36:43.691Z","judgeEnd":"2026-10-06T13:36:43.740Z","complete":"2026-10-06T13:36:43.748Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-06T13:36:43.759Z","agentStart":"2026-10-06T13:36:45.037Z","agentEnd":"2026-10-06T13:38:15.829Z","judgeStart":"2026-10-06T13:38:15.837Z","judgeEnd":"2026-10-06T13:38:15.888Z","complete":"2026-10-06T13:38:15.896Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 96; retained 35; missing 61.
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
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 82081/1983 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 451459/2874 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 71027/2172 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 336163/3178 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 65468/2680 |
| stringify-boxed | evaluation/bug | native-codex | 2/3 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 421205/3652 |
| queue-clear | evaluation/feature | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| csv-workflow-v4 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v4 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v4 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v4 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
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
| evaluation | all | rifty | 6/6 | 0/18 | 15 | unavailable | [0.000, 0.985] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 3 | unavailable | [0.000, 0.954] | unavailable | unavailable |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | all | rifty-no-coi | 6/6 | 0/18 | 15 | unavailable | [0.000, 0.985] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 3 | unavailable | [0.000, 0.954] | unavailable | unavailable |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 6/6 | 3/18 | 15 | unavailable | [0.015, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 3/6 | 3 | unavailable | [0.046, 1.000] | unavailable | unavailable |
| evaluation | bug | native-codex | 1/1 | 2/3 | 1 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 2/18 | 16 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 2/6 | 4 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | separate reference | unavailable |
