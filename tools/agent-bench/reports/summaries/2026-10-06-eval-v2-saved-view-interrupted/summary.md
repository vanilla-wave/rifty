# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v2; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: c8e43eabceec10ac8148f37bf88f82dacc6d81b0; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: running; selected 96; retained 54.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| csv-workflow-v3 | local-reference | 1 | missing | unfinished |
| csv-workflow-v3 | local-reference | 2 | missing | not started |
| csv-workflow-v3 | local-reference | 3 | missing | not started |
| csv-workflow-v3 | native-codex | 1 | missing | not started |
| csv-workflow-v3 | native-codex | 2 | missing | not started |
| csv-workflow-v3 | native-codex | 3 | missing | not started |
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
| ms-negative | rifty | 1 | fail | error | 9.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 7.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 8.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 5.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 6.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 6.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 25.3 | 8 | 16039 | 825 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | pass | done | 145.3 | 6 | 24557 | 677 | 0 | 0 | 0 | 0 | 2 | — | — |
| ms-negative | local-reference | 3 | pass | done | 17.2 | 7 | 15830 | 597 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 42.9 | 9 | 151310 | 1008 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 50.0 | 11 | 177633 | 1044 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 46.1 | 9 | 151090 | 998 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 6.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 44.8 | 8 | 22388 | 694 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 25.9 | 4 | 14342 | 376 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 17.3 | 8 | 14994 | 530 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 47.5 | 6 | 118551 | 1144 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 46.5 | 7 | 137423 | 1071 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 42.2 | 7 | 132275 | 1065 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 11.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 9.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 9.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 34.1 | 12 | 31703 | 1035 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 39.3 | 8 | 16929 | 948 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 66.5 | 9 | 25142 | 996 | 0 | 0 | 0 | 0 | 2 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 79.5 | 11 | 201990 | 1997 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 71.7 | 11 | 205707 | 2032 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 70.5 | 11 | 177897 | 1754 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 4.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 3.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 2.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 61.6 | 11 | 40190 | 1602 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 2 | pass | done | 103.0 | 12 | 49602 | 1901 | 0 | 0 | 0 | 0 | 2 | — | — |
| queue-clear | local-reference | 3 | pass | done | 42.3 | 9 | 23247 | 1066 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | pass | done | 78.3 | 11 | 220404 | 2639 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 80.2 | 8 | 219595 | 2581 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 94.3 | 15 | 268663 | 2938 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v3 | rifty | 1 | pass | done | 77.0 | 8 | 21015 | 4209 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty | 2 | pass | done | 91.6 | 8 | 25402 | 5448 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty | 3 | fail | done | 80.8 | 7 | 19855 | 3551 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 1 | pass | done | 92.9 | 16 | 65232 | 4793 | 0 | 0 | 1 | 0 | 3 | — | — |
| csv-workflow-v3 | rifty-no-coi | 2 | pass | done | 84.9 | 10 | 22736 | 4761 | 0 | 0 | 1 | 0 | 3 | — | — |
| csv-workflow-v3 | rifty-no-coi | 3 | fail | done | 95.3 | 17 | 32261 | 4737 | 0 | 0 | 1 | 0 | 9 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | 242cdac45cd21e7580c7b178b70f2a4369991e8f9a27c4d2d9018489ab7d26bf |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 337fa7f3cf43dd556b96552cbc4868e43eeaa02d7ae44644fca313edcb67cdef |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 9931fc543c321bc5b3a87a193a4192cce0ec40b10bae03083a7973cb9f482598 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 77879f4360a64c24015bb41991e3b4e46c21ccaa2d4d2e24d9dba8e4f4441584 |
| csv-workflow-v3 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | cc6c15a80fa08c7dc57594fc66460eaa7892df23760ac2eb8383c3c3b95e63ba |
| markdown-notes-v3 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | 00e66d6d640cf824410f5a389923cb9a930f0af374d75136a6de5babd7fb9f70 |
| booking-workflow-v2 | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | ba3943b0aa8fd36549e77cc19c3abaf9badf0f6e176a815c97763f31fcf80a49 |
| expense-settlement-v2 | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | 3ce40ac4a1eeeded3502ecfe40cb55eb7aa8b02e4b1a5965ceadecd533897add |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:16:43.712Z","complete":"2026-10-06T10:16:52.876Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:16:52.880Z","complete":"2026-10-06T10:17:00.547Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:17:00.551Z","complete":"2026-10-06T10:17:08.842Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:17:08.846Z","complete":"2026-10-06T10:17:14.787Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:17:14.796Z","complete":"2026-10-06T10:17:21.015Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:17:21.021Z","complete":"2026-10-06T10:17:27.559Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-06T10:17:27.564Z","agentStart":"2026-10-06T10:17:28.538Z","agentEnd":"2026-10-06T10:17:53.832Z","judgeStart":"2026-10-06T10:17:53.838Z","judgeEnd":"2026-10-06T10:17:53.890Z","complete":"2026-10-06T10:17:53.899Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-06T10:17:53.904Z","agentStart":"2026-10-06T10:17:54.894Z","agentEnd":"2026-10-06T10:20:20.221Z","judgeStart":"2026-10-06T10:20:20.231Z","judgeEnd":"2026-10-06T10:20:20.282Z","complete":"2026-10-06T10:20:20.290Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-06T10:20:20.295Z","agentStart":"2026-10-06T10:20:21.548Z","agentEnd":"2026-10-06T10:20:38.769Z","judgeStart":"2026-10-06T10:20:38.776Z","judgeEnd":"2026-10-06T10:20:38.824Z","complete":"2026-10-06T10:20:38.830Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-06T10:20:38.835Z","agentStart":"2026-10-06T10:20:39.904Z","agentEnd":"2026-10-06T10:21:22.793Z","judgeStart":"2026-10-06T10:21:22.797Z","judgeEnd":"2026-10-06T10:21:22.849Z","complete":"2026-10-06T10:21:22.856Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-06T10:21:22.861Z","agentStart":"2026-10-06T10:21:23.900Z","agentEnd":"2026-10-06T10:22:13.868Z","judgeStart":"2026-10-06T10:22:13.871Z","judgeEnd":"2026-10-06T10:22:13.923Z","complete":"2026-10-06T10:22:13.928Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-06T10:22:13.933Z","agentStart":"2026-10-06T10:22:14.976Z","agentEnd":"2026-10-06T10:23:01.043Z","judgeStart":"2026-10-06T10:23:01.047Z","judgeEnd":"2026-10-06T10:23:01.114Z","complete":"2026-10-06T10:23:01.120Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:01.126Z","complete":"2026-10-06T10:23:06.359Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:06.365Z","complete":"2026-10-06T10:23:13.017Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:13.026Z","complete":"2026-10-06T10:23:18.624Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:18.631Z","complete":"2026-10-06T10:23:21.898Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:21.903Z","complete":"2026-10-06T10:23:25.236Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:23:25.243Z","complete":"2026-10-06T10:23:28.788Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-06T10:23:28.793Z","agentStart":"2026-10-06T10:23:29.233Z","agentEnd":"2026-10-06T10:24:14.081Z","judgeStart":"2026-10-06T10:24:14.090Z","judgeEnd":"2026-10-06T10:24:14.138Z","complete":"2026-10-06T10:24:14.145Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-06T10:24:14.150Z","agentStart":"2026-10-06T10:24:14.634Z","agentEnd":"2026-10-06T10:24:40.545Z","judgeStart":"2026-10-06T10:24:40.552Z","judgeEnd":"2026-10-06T10:24:40.613Z","complete":"2026-10-06T10:24:40.620Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-06T10:24:40.625Z","agentStart":"2026-10-06T10:24:41.078Z","agentEnd":"2026-10-06T10:24:58.397Z","judgeStart":"2026-10-06T10:24:58.401Z","judgeEnd":"2026-10-06T10:24:58.439Z","complete":"2026-10-06T10:24:58.445Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-06T10:24:58.463Z","agentStart":"2026-10-06T10:24:58.957Z","agentEnd":"2026-10-06T10:25:46.465Z","judgeStart":"2026-10-06T10:25:46.469Z","judgeEnd":"2026-10-06T10:25:46.530Z","complete":"2026-10-06T10:25:46.536Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-06T10:25:46.542Z","agentStart":"2026-10-06T10:25:47.006Z","agentEnd":"2026-10-06T10:26:33.539Z","judgeStart":"2026-10-06T10:26:33.543Z","judgeEnd":"2026-10-06T10:26:33.597Z","complete":"2026-10-06T10:26:33.605Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-06T10:26:33.612Z","agentStart":"2026-10-06T10:26:34.153Z","agentEnd":"2026-10-06T10:27:16.390Z","judgeStart":"2026-10-06T10:27:16.393Z","judgeEnd":"2026-10-06T10:27:16.442Z","complete":"2026-10-06T10:27:16.449Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:27:16.456Z","complete":"2026-10-06T10:28:47.892Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:28:47.900Z","complete":"2026-10-06T10:28:59.248Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:28:59.256Z","complete":"2026-10-06T10:30:30.732Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:30:30.739Z","complete":"2026-10-06T10:30:39.717Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:30:39.725Z","complete":"2026-10-06T10:30:49.273Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:30:49.280Z","complete":"2026-10-06T10:30:58.945Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-06T10:30:58.954Z","agentStart":"2026-10-06T10:31:00.209Z","agentEnd":"2026-10-06T10:31:34.338Z","judgeStart":"2026-10-06T10:31:34.351Z","judgeEnd":"2026-10-06T10:31:34.397Z","complete":"2026-10-06T10:31:34.404Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-06T10:31:34.411Z","agentStart":"2026-10-06T10:31:35.714Z","agentEnd":"2026-10-06T10:32:15.055Z","judgeStart":"2026-10-06T10:32:15.066Z","judgeEnd":"2026-10-06T10:32:15.114Z","complete":"2026-10-06T10:32:15.121Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-06T10:32:15.128Z","agentStart":"2026-10-06T10:32:16.408Z","agentEnd":"2026-10-06T10:33:22.927Z","judgeStart":"2026-10-06T10:33:22.935Z","judgeEnd":"2026-10-06T10:33:22.986Z","complete":"2026-10-06T10:33:22.994Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-06T10:33:23.002Z","agentStart":"2026-10-06T10:33:24.400Z","agentEnd":"2026-10-06T10:34:43.937Z","judgeStart":"2026-10-06T10:34:43.946Z","judgeEnd":"2026-10-06T10:34:43.994Z","complete":"2026-10-06T10:34:44.001Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-06T10:34:44.020Z","agentStart":"2026-10-06T10:34:45.359Z","agentEnd":"2026-10-06T10:35:57.065Z","judgeStart":"2026-10-06T10:35:57.073Z","judgeEnd":"2026-10-06T10:35:57.122Z","complete":"2026-10-06T10:35:57.130Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-06T10:35:57.140Z","agentStart":"2026-10-06T10:35:58.495Z","agentEnd":"2026-10-06T10:37:09.030Z","judgeStart":"2026-10-06T10:37:09.038Z","judgeEnd":"2026-10-06T10:37:09.086Z","complete":"2026-10-06T10:37:09.095Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:09.108Z","complete":"2026-10-06T10:37:13.766Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:13.778Z","complete":"2026-10-06T10:37:17.099Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:17.113Z","complete":"2026-10-06T10:37:20.820Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:20.834Z","complete":"2026-10-06T10:37:22.851Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:22.864Z","complete":"2026-10-06T10:37:24.596Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-06T10:37:24.606Z","complete":"2026-10-06T10:37:26.448Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-06T10:37:26.464Z","agentStart":"2026-10-06T10:38:06.766Z","agentEnd":"2026-10-06T10:39:08.381Z","judgeStart":"2026-10-06T10:39:08.389Z","judgeEnd":"2026-10-06T10:39:09.966Z","complete":"2026-10-06T10:39:09.975Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-06T10:39:09.986Z","agentStart":"2026-10-06T10:39:25.772Z","agentEnd":"2026-10-06T10:41:08.727Z","judgeStart":"2026-10-06T10:41:08.737Z","judgeEnd":"2026-10-06T10:41:10.324Z","complete":"2026-10-06T10:41:10.337Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-06T10:41:10.353Z","agentStart":"2026-10-06T10:41:26.831Z","agentEnd":"2026-10-06T10:42:09.170Z","judgeStart":"2026-10-06T10:42:09.182Z","judgeEnd":"2026-10-06T10:42:10.764Z","complete":"2026-10-06T10:42:10.773Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-06T10:42:10.796Z","agentStart":"2026-10-06T10:42:31.098Z","agentEnd":"2026-10-06T10:43:49.446Z","judgeStart":"2026-10-06T10:43:49.452Z","judgeEnd":"2026-10-06T10:43:51.048Z","complete":"2026-10-06T10:43:51.062Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-06T10:43:51.075Z","agentStart":"2026-10-06T10:44:07.446Z","agentEnd":"2026-10-06T10:45:27.661Z","judgeStart":"2026-10-06T10:45:27.668Z","judgeEnd":"2026-10-06T10:45:29.277Z","complete":"2026-10-06T10:45:29.293Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-06T10:45:29.307Z","agentStart":"2026-10-06T10:45:45.841Z","agentEnd":"2026-10-06T10:47:20.177Z","judgeStart":"2026-10-06T10:47:20.184Z","judgeEnd":"2026-10-06T10:47:21.774Z","complete":"2026-10-06T10:47:21.784Z"} |
| csv-workflow-v3/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/after.json | {"start":"2026-10-06T10:47:21.797Z","agentStart":"2026-10-06T10:47:29.814Z","agentEnd":"2026-10-06T10:48:46.799Z","judgeStart":"2026-10-06T10:48:47.186Z","judgeEnd":"2026-10-06T10:48:54.564Z","complete":"2026-10-06T10:48:54.878Z"} |
| csv-workflow-v3/rifty/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/2/after.json | {"start":"2026-10-06T10:48:54.891Z","agentStart":"2026-10-06T10:49:01.695Z","agentEnd":"2026-10-06T10:50:33.262Z","judgeStart":"2026-10-06T10:50:33.795Z","judgeEnd":"2026-10-06T10:50:35.551Z","complete":"2026-10-06T10:50:35.982Z"} |
| csv-workflow-v3/rifty/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/3/after.json | {"start":"2026-10-06T10:50:36.004Z","agentStart":"2026-10-06T10:50:46.178Z","agentEnd":"2026-10-06T10:52:06.960Z","judgeStart":"2026-10-06T10:52:07.264Z","judgeEnd":"2026-10-06T10:52:14.642Z","complete":"2026-10-06T10:52:14.902Z"} |
| csv-workflow-v3/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/after.json | {"start":"2026-10-06T10:52:14.915Z","agentStart":"2026-10-06T10:52:24.358Z","agentEnd":"2026-10-06T10:53:57.266Z","judgeStart":"2026-10-06T10:53:57.573Z","judgeEnd":"2026-10-06T10:54:05.122Z","complete":"2026-10-06T10:54:05.341Z"} |
| csv-workflow-v3/rifty-no-coi/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/2/after.json | {"start":"2026-10-06T10:54:05.361Z","agentStart":"2026-10-06T10:54:12.726Z","agentEnd":"2026-10-06T10:55:37.586Z","judgeStart":"2026-10-06T10:55:37.937Z","judgeEnd":"2026-10-06T10:55:45.766Z","complete":"2026-10-06T10:55:45.997Z"} |
| csv-workflow-v3/rifty-no-coi/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/3/after.json | {"start":"2026-10-06T10:55:46.013Z","agentStart":"2026-10-06T10:55:50.064Z","agentEnd":"2026-10-06T10:57:25.333Z","judgeStart":"2026-10-06T10:57:25.671Z","judgeEnd":"2026-10-06T10:57:27.036Z","complete":"2026-10-06T10:57:27.243Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 96; retained 54; missing 42.
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
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 56426/2099 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 480033/3050 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 51724/1600 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 388249/3280 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 73774/2979 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 585594/5783 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.816] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 113039/4569 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 708662/8158 |
| csv-workflow-v3 | evaluation/app | rifty | 2/3 | 0 | 0/0 | 0.667 | [0.094, 0.992] | unavailable | unavailable | {"functional":1} | 66272/13208 |
| csv-workflow-v3 | evaluation/app | rifty-no-coi | 2/3 | 0 | 0/0 | 0.667 | [0.094, 0.992] | unavailable | unavailable | {"functional":1} | 120229/14291 |
| csv-workflow-v3 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
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
| evaluation | all | rifty | 6/6 | 2/18 | 9 | unavailable | [0.003, 0.969] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | all | rifty-no-coi | 6/6 | 2/18 | 9 | unavailable | [0.003, 0.969] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 6/6 | 6/18 | 12 | unavailable | [0.031, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 6/18 | 12 | unavailable | [0.031, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.908] | -1.000 | [-1.000, 0.816] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.092, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 2/12 | 9 | unavailable | [0.004, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 2/12 | 9 | unavailable | [0.004, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | separate reference | unavailable |
