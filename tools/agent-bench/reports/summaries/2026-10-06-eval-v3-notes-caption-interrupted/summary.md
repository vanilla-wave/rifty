# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v3; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 8d9eef35a3a8f555a0902849191494adc760f228; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 96; retained 65.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| markdown-notes-v3 | rifty-no-coi | 3 | missing | unfinished |
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
| ms-negative | rifty | 1 | fail | error | 8.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 6.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 6.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 57.9 | 6 | 16954 | 507 | 0 | 0 | 0 | 0 | 2 | — | — |
| ms-negative | local-reference | 2 | pass | done | 179.8 | 7 | 23416 | 825 | 0 | 0 | 0 | 0 | 3 | — | — |
| ms-negative | local-reference | 3 | pass | done | 43.5 | 7 | 15909 | 670 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 52.9 | 9 | 151461 | 1020 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 53.1 | 8 | 174598 | 1069 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 42.9 | 7 | 155476 | 860 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 37.3 | 8 | 22328 | 790 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 49.0 | 10 | 33780 | 1175 | 0 | 0 | 0 | 0 | 2 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 38.6 | 9 | 35607 | 626 | 0 | 0 | 0 | 0 | 3 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 41.0 | 5 | 113654 | 1037 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 45.2 | 5 | 116249 | 1025 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 38.6 | 5 | 115777 | 854 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 10.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 10.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 9.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 57.0 | 11 | 23168 | 1016 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 49.5 | 9 | 19694 | 821 | 1 | 0 | 0 | 0 | 2 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 34.1 | 8 | 25931 | 1116 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 66.7 | 12 | 194644 | 1833 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 102.0 | 14 | 254581 | 2460 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 74.3 | 12 | 241917 | 1937 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 78.5 | 12 | 48093 | 1981 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 2 | pass | done | 70.6 | 12 | 50693 | 1255 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 3 | pass | done | 98.7 | 13 | 50023 | 2370 | 0 | 0 | 0 | 0 | 4 | — | — |
| queue-clear | native-codex | 1 | pass | done | 80.0 | 8 | 168807 | 2210 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 92.4 | 10 | 268553 | 2523 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 103.3 | 14 | 267270 | 2787 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v4 | rifty | 1 | pass | done | 102.0 | 7 | 22275 | 4784 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | rifty | 2 | pass | done | 109.4 | 7 | 22871 | 5056 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | rifty | 3 | pass | done | 112.8 | 7 | 23787 | 5420 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | rifty-no-coi | 1 | pass | done | 84.3 | 7 | 20827 | 4873 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | rifty-no-coi | 2 | pass | done | 79.9 | 8 | 18298 | 3698 | 0 | 0 | 0 | 0 | 1 | — | — |
| csv-workflow-v4 | rifty-no-coi | 3 | pass | done | 84.0 | 7 | 17778 | 3556 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | local-reference | 1 | pass | done | 77.9 | 6 | 21147 | 4978 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v4 | local-reference | 2 | pass | done | 95.2 | 5 | 21605 | 4731 | 0 | 0 | 0 | 0 | 2 | — | — |
| csv-workflow-v4 | local-reference | 3 | pass | done | 96.7 | 7 | 22150 | 4022 | 0 | 0 | 0 | 0 | 5 | — | — |
| csv-workflow-v4 | native-codex | 1 | pass | done | 174.9 | 6 | 149697 | 6980 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v4 | native-codex | 2 | pass | done | 135.5 | 6 | 141386 | 5305 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v4 | native-codex | 3 | pass | done | 212.2 | 7 | 172583 | 6801 | unknown | unknown | unknown | unknown | unknown | — | — |
| markdown-notes-v3 | rifty | 1 | fail | done | 121.6 | 12 | 39040 | 6105 | 0 | 0 | 1 | 0 | 3 | — | — |
| markdown-notes-v3 | rifty | 2 | fail | done | 94.1 | 11 | 46118 | 5675 | 0 | 0 | 0 | 0 | 1 | — | — |
| markdown-notes-v3 | rifty | 3 | pass | done | 92.3 | 6 | 15547 | 4213 | 1 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty-no-coi | 1 | pass | done | 44.9 | 6 | 14202 | 3931 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty-no-coi | 2 | pass | done | 64.8 | 9 | 13884 | 2692 | 0 | 0 | 1 | 0 | 3 | — | — |

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
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:10:02.499Z","complete":"2026-10-06T16:10:11.442Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:10:11.446Z","complete":"2026-10-06T16:11:42.932Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:11:42.935Z","complete":"2026-10-06T16:11:51.630Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:11:51.633Z","complete":"2026-10-06T16:11:57.297Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:11:57.299Z","complete":"2026-10-06T16:12:03.895Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:12:03.901Z","complete":"2026-10-06T16:12:10.561Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-06T16:12:10.567Z","agentStart":"2026-10-06T16:12:11.528Z","agentEnd":"2026-10-06T16:13:09.394Z","judgeStart":"2026-10-06T16:13:09.399Z","judgeEnd":"2026-10-06T16:13:09.449Z","complete":"2026-10-06T16:13:09.457Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-06T16:13:09.461Z","agentStart":"2026-10-06T16:13:10.391Z","agentEnd":"2026-10-06T16:16:10.169Z","judgeStart":"2026-10-06T16:16:10.178Z","judgeEnd":"2026-10-06T16:16:10.231Z","complete":"2026-10-06T16:16:10.238Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-06T16:16:10.243Z","agentStart":"2026-10-06T16:16:11.162Z","agentEnd":"2026-10-06T16:16:54.710Z","judgeStart":"2026-10-06T16:16:54.718Z","judgeEnd":"2026-10-06T16:16:54.768Z","complete":"2026-10-06T16:16:54.774Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-06T16:16:54.778Z","agentStart":"2026-10-06T16:16:55.711Z","agentEnd":"2026-10-06T16:17:48.649Z","judgeStart":"2026-10-06T16:17:48.653Z","judgeEnd":"2026-10-06T16:17:48.703Z","complete":"2026-10-06T16:17:48.711Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-06T16:17:48.716Z","agentStart":"2026-10-06T16:17:49.682Z","agentEnd":"2026-10-06T16:18:42.810Z","judgeStart":"2026-10-06T16:18:42.814Z","judgeEnd":"2026-10-06T16:18:42.865Z","complete":"2026-10-06T16:18:42.871Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-06T16:18:42.876Z","agentStart":"2026-10-06T16:18:43.820Z","agentEnd":"2026-10-06T16:19:26.690Z","judgeStart":"2026-10-06T16:19:26.693Z","judgeEnd":"2026-10-06T16:19:26.755Z","complete":"2026-10-06T16:19:26.762Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:26.767Z","complete":"2026-10-06T16:19:32.422Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:32.428Z","complete":"2026-10-06T16:19:38.044Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:38.049Z","complete":"2026-10-06T16:19:43.256Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:43.262Z","complete":"2026-10-06T16:19:47.112Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:47.117Z","complete":"2026-10-06T16:19:50.460Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:19:50.465Z","complete":"2026-10-06T16:19:53.682Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-06T16:19:53.687Z","agentStart":"2026-10-06T16:19:54.129Z","agentEnd":"2026-10-06T16:20:31.405Z","judgeStart":"2026-10-06T16:20:31.413Z","judgeEnd":"2026-10-06T16:20:31.479Z","complete":"2026-10-06T16:20:31.487Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-06T16:20:31.492Z","agentStart":"2026-10-06T16:20:31.920Z","agentEnd":"2026-10-06T16:21:20.897Z","judgeStart":"2026-10-06T16:21:20.903Z","judgeEnd":"2026-10-06T16:21:20.946Z","complete":"2026-10-06T16:21:20.952Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-06T16:21:20.957Z","agentStart":"2026-10-06T16:21:21.453Z","agentEnd":"2026-10-06T16:22:00.052Z","judgeStart":"2026-10-06T16:22:00.060Z","judgeEnd":"2026-10-06T16:22:00.113Z","complete":"2026-10-06T16:22:00.119Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-06T16:22:00.125Z","agentStart":"2026-10-06T16:22:00.572Z","agentEnd":"2026-10-06T16:22:41.551Z","judgeStart":"2026-10-06T16:22:41.553Z","judgeEnd":"2026-10-06T16:22:41.604Z","complete":"2026-10-06T16:22:41.611Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-06T16:22:41.616Z","agentStart":"2026-10-06T16:22:42.065Z","agentEnd":"2026-10-06T16:23:27.218Z","judgeStart":"2026-10-06T16:23:27.221Z","judgeEnd":"2026-10-06T16:23:27.282Z","complete":"2026-10-06T16:23:27.288Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-06T16:23:27.294Z","agentStart":"2026-10-06T16:23:27.737Z","agentEnd":"2026-10-06T16:24:06.387Z","judgeStart":"2026-10-06T16:24:06.390Z","judgeEnd":"2026-10-06T16:24:06.442Z","complete":"2026-10-06T16:24:06.449Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:24:06.455Z","complete":"2026-10-06T16:25:37.909Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:25:37.921Z","complete":"2026-10-06T16:27:09.402Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:27:09.409Z","complete":"2026-10-06T16:27:20.272Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:27:20.279Z","complete":"2026-10-06T16:27:29.556Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:27:29.569Z","complete":"2026-10-06T16:27:40.026Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:27:40.032Z","complete":"2026-10-06T16:27:49.884Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-06T16:27:49.899Z","agentStart":"2026-10-06T16:27:51.100Z","agentEnd":"2026-10-06T16:28:48.066Z","judgeStart":"2026-10-06T16:28:48.074Z","judgeEnd":"2026-10-06T16:28:48.118Z","complete":"2026-10-06T16:28:48.125Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-06T16:28:48.131Z","agentStart":"2026-10-06T16:28:49.249Z","agentEnd":"2026-10-06T16:29:38.738Z","judgeStart":"2026-10-06T16:29:38.750Z","judgeEnd":"2026-10-06T16:29:38.797Z","complete":"2026-10-06T16:29:38.805Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-06T16:29:38.813Z","agentStart":"2026-10-06T16:29:39.944Z","agentEnd":"2026-10-06T16:30:14.092Z","judgeStart":"2026-10-06T16:30:14.104Z","judgeEnd":"2026-10-06T16:30:14.161Z","complete":"2026-10-06T16:30:14.169Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-06T16:30:14.177Z","agentStart":"2026-10-06T16:30:15.337Z","agentEnd":"2026-10-06T16:31:21.991Z","judgeStart":"2026-10-06T16:31:21.997Z","judgeEnd":"2026-10-06T16:31:22.054Z","complete":"2026-10-06T16:31:22.064Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-06T16:31:22.074Z","agentStart":"2026-10-06T16:31:23.265Z","agentEnd":"2026-10-06T16:33:05.235Z","judgeStart":"2026-10-06T16:33:05.243Z","judgeEnd":"2026-10-06T16:33:05.294Z","complete":"2026-10-06T16:33:05.302Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-06T16:33:05.312Z","agentStart":"2026-10-06T16:33:06.571Z","agentEnd":"2026-10-06T16:34:20.921Z","judgeStart":"2026-10-06T16:34:20.930Z","judgeEnd":"2026-10-06T16:34:20.989Z","complete":"2026-10-06T16:34:20.998Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:34:21.007Z","complete":"2026-10-06T16:34:24.313Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:34:24.325Z","complete":"2026-10-06T16:35:55.807Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:35:55.822Z","complete":"2026-10-06T16:37:27.279Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:37:27.296Z","complete":"2026-10-06T16:37:29.169Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:37:29.182Z","complete":"2026-10-06T16:37:30.882Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T16:37:30.896Z","complete":"2026-10-06T16:37:32.645Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-06T16:37:32.655Z","agentStart":"2026-10-06T16:38:09.276Z","agentEnd":"2026-10-06T16:39:27.729Z","judgeStart":"2026-10-06T16:39:27.743Z","judgeEnd":"2026-10-06T16:39:29.315Z","complete":"2026-10-06T16:39:29.324Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-06T16:39:29.334Z","agentStart":"2026-10-06T16:39:45.625Z","agentEnd":"2026-10-06T16:40:56.193Z","judgeStart":"2026-10-06T16:40:56.207Z","judgeEnd":"2026-10-06T16:40:57.808Z","complete":"2026-10-06T16:40:57.820Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-06T16:40:57.833Z","agentStart":"2026-10-06T16:41:14.961Z","agentEnd":"2026-10-06T16:42:53.657Z","judgeStart":"2026-10-06T16:42:53.667Z","judgeEnd":"2026-10-06T16:42:55.255Z","complete":"2026-10-06T16:42:55.267Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-06T16:42:55.280Z","agentStart":"2026-10-06T16:43:12.909Z","agentEnd":"2026-10-06T16:44:32.876Z","judgeStart":"2026-10-06T16:44:32.882Z","judgeEnd":"2026-10-06T16:44:34.465Z","complete":"2026-10-06T16:44:34.476Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-06T16:44:34.499Z","agentStart":"2026-10-06T16:44:49.806Z","agentEnd":"2026-10-06T16:46:22.238Z","judgeStart":"2026-10-06T16:46:22.242Z","judgeEnd":"2026-10-06T16:46:23.847Z","complete":"2026-10-06T16:46:23.861Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-06T16:46:23.875Z","agentStart":"2026-10-06T16:46:38.839Z","agentEnd":"2026-10-06T16:48:22.139Z","judgeStart":"2026-10-06T16:48:22.145Z","judgeEnd":"2026-10-06T16:48:23.744Z","complete":"2026-10-06T16:48:23.757Z"} |
| csv-workflow-v4/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/1/after.json | {"start":"2026-10-06T16:48:23.773Z","agentStart":"2026-10-06T16:48:32.107Z","agentEnd":"2026-10-06T16:50:14.142Z","judgeStart":"2026-10-06T16:50:14.614Z","judgeEnd":"2026-10-06T16:50:28.070Z","complete":"2026-10-06T16:50:28.459Z"} |
| csv-workflow-v4/rifty/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/2/after.json | {"start":"2026-10-06T16:50:28.475Z","agentStart":"2026-10-06T16:50:35.701Z","agentEnd":"2026-10-06T16:52:25.094Z","judgeStart":"2026-10-06T16:52:25.594Z","judgeEnd":"2026-10-06T16:52:39.023Z","complete":"2026-10-06T16:52:39.458Z"} |
| csv-workflow-v4/rifty/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty/3/after.json | {"start":"2026-10-06T16:52:39.471Z","agentStart":"2026-10-06T16:52:46.251Z","agentEnd":"2026-10-06T16:54:39.095Z","judgeStart":"2026-10-06T16:54:39.683Z","judgeEnd":"2026-10-06T16:54:53.135Z","complete":"2026-10-06T16:54:53.597Z"} |
| csv-workflow-v4/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/1/after.json | {"start":"2026-10-06T16:54:53.610Z","agentStart":"2026-10-06T16:54:57.285Z","agentEnd":"2026-10-06T16:56:21.612Z","judgeStart":"2026-10-06T16:56:22.011Z","judgeEnd":"2026-10-06T16:56:35.491Z","complete":"2026-10-06T16:56:35.775Z"} |
| csv-workflow-v4/rifty-no-coi/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/2/after.json | {"start":"2026-10-06T16:56:35.789Z","agentStart":"2026-10-06T16:56:42.724Z","agentEnd":"2026-10-06T16:58:02.607Z","judgeStart":"2026-10-06T16:58:02.822Z","judgeEnd":"2026-10-06T16:58:04.238Z","complete":"2026-10-06T16:58:04.386Z"} |
| csv-workflow-v4/rifty-no-coi/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/rifty-no-coi/3/after.json | {"start":"2026-10-06T16:58:04.399Z","agentStart":"2026-10-06T16:58:08.545Z","agentEnd":"2026-10-06T16:59:32.591Z","judgeStart":"2026-10-06T16:59:32.770Z","judgeEnd":"2026-10-06T16:59:34.341Z","complete":"2026-10-06T16:59:34.488Z"} |
| csv-workflow-v4/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/1/after.json | {"start":"2026-10-06T16:59:34.501Z","agentStart":"2026-10-06T16:59:37.279Z","agentEnd":"2026-10-06T17:00:55.192Z","judgeStart":"2026-10-06T17:00:55.211Z","judgeEnd":"2026-10-06T17:00:56.712Z","complete":"2026-10-06T17:00:56.747Z"} |
| csv-workflow-v4/local-reference/2 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/2/after.json | {"start":"2026-10-06T17:00:56.760Z","agentStart":"2026-10-06T17:00:59.483Z","agentEnd":"2026-10-06T17:02:34.706Z","judgeStart":"2026-10-06T17:02:34.724Z","judgeEnd":"2026-10-06T17:02:36.361Z","complete":"2026-10-06T17:02:36.408Z"} |
| csv-workflow-v4/local-reference/3 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/local-reference/3/after.json | {"start":"2026-10-06T17:02:36.423Z","agentStart":"2026-10-06T17:02:39.404Z","agentEnd":"2026-10-06T17:04:16.151Z","judgeStart":"2026-10-06T17:04:16.167Z","judgeEnd":"2026-10-06T17:04:17.671Z","complete":"2026-10-06T17:04:17.710Z"} |
| csv-workflow-v4/native-codex/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/1/after.json | {"start":"2026-10-06T17:04:17.724Z","agentStart":"2026-10-06T17:04:20.495Z","agentEnd":"2026-10-06T17:07:15.422Z","judgeStart":"2026-10-06T17:07:15.426Z","judgeEnd":"2026-10-06T17:07:29.101Z","complete":"2026-10-06T17:07:29.150Z"} |
| csv-workflow-v4/native-codex/2 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/2/after.json | {"start":"2026-10-06T17:07:29.166Z","agentStart":"2026-10-06T17:07:31.868Z","agentEnd":"2026-10-06T17:09:47.386Z","judgeStart":"2026-10-06T17:09:47.389Z","judgeEnd":"2026-10-06T17:10:00.503Z","complete":"2026-10-06T17:10:00.544Z"} |
| csv-workflow-v4/native-codex/3 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v4/native-codex/3/after.json | {"start":"2026-10-06T17:10:00.560Z","agentStart":"2026-10-06T17:10:02.982Z","agentEnd":"2026-10-06T17:13:35.203Z","judgeStart":"2026-10-06T17:13:35.207Z","judgeEnd":"2026-10-06T17:13:48.438Z","complete":"2026-10-06T17:13:48.477Z"} |
| markdown-notes-v3/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/after.json | {"start":"2026-10-06T17:13:48.494Z","agentStart":"2026-10-06T17:13:54.922Z","agentEnd":"2026-10-06T17:15:56.566Z","judgeStart":"2026-10-06T17:15:57.093Z","judgeEnd":"2026-10-06T17:16:28.240Z","complete":"2026-10-06T17:16:28.633Z"} |
| markdown-notes-v3/rifty/2 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/2/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/2/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/2/after.json | {"start":"2026-10-06T17:16:28.651Z","agentStart":"2026-10-06T17:16:35.938Z","agentEnd":"2026-10-06T17:18:10.029Z","judgeStart":"2026-10-06T17:18:11.157Z","judgeEnd":"2026-10-06T17:18:42.264Z","complete":"2026-10-06T17:18:43.025Z"} |
| markdown-notes-v3/rifty/3 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/3/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/3/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/3/after.json | {"start":"2026-10-06T17:18:43.046Z","agentStart":"2026-10-06T17:18:49.882Z","agentEnd":"2026-10-06T17:20:22.215Z","judgeStart":"2026-10-06T17:20:22.820Z","judgeEnd":"2026-10-06T17:20:23.997Z","complete":"2026-10-06T17:20:24.414Z"} |
| markdown-notes-v3/rifty-no-coi/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/after.json | {"start":"2026-10-06T17:20:24.432Z","agentStart":"2026-10-06T17:20:26.993Z","agentEnd":"2026-10-06T17:21:11.899Z","judgeStart":"2026-10-06T17:21:12.409Z","judgeEnd":"2026-10-06T17:21:13.245Z","complete":"2026-10-06T17:21:13.517Z"} |
| markdown-notes-v3/rifty-no-coi/2 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/2/after.json | {"start":"2026-10-06T17:21:13.540Z","agentStart":"2026-10-06T17:21:16.643Z","agentEnd":"2026-10-06T17:22:21.425Z","judgeStart":"2026-10-06T17:22:21.813Z","judgeEnd":"2026-10-06T17:22:22.627Z","complete":"2026-10-06T17:22:22.758Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 96; retained 65; missing 31.
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
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 56279/2002 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 481535/2949 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 91715/2591 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 345680/2916 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 68793/2953 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 691142/6230 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 148809/5606 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 704630/7520 |
| csv-workflow-v4 | evaluation/app | rifty | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [-0.908, 0.908] | {} | 68933/15260 |
| csv-workflow-v4 | evaluation/app | rifty-no-coi | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [-0.908, 0.908] | {} | 56903/12127 |
| csv-workflow-v4 | evaluation/app | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 64902/13731 |
| csv-workflow-v4 | evaluation/app | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 463666/19086 |
| markdown-notes-v3 | evaluation/app | rifty | 1/3 | 0 | 0/0 | 0.333 | [0.008, 0.906] | unavailable | unavailable | {"functional":2} | 100705/15993 |
| markdown-notes-v3 | evaluation/app | rifty-no-coi | 2/3 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 28086/6623 |
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
| evaluation | all | rifty | 6/6 | 4/18 | 6 | unavailable | [0.015, 0.967] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | all | rifty-no-coi | 6/6 | 5/18 | 7 | unavailable | [0.015, 0.969] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 6/6 | 9/18 | 9 | unavailable | [0.046, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 9/18 | 9 | unavailable | [0.046, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 4/12 | 6 | unavailable | [0.023, 0.996] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 5/12 | 7 | unavailable | [0.023, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 3/12 | 9 | unavailable | [0.023, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 3/12 | 9 | unavailable | [0.023, 1.000] | separate reference | unavailable |
