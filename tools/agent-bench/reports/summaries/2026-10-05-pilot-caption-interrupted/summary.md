# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v1; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 03a531ab20f4f5d1a96f2b6baa93502ef53b75f3; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: running; selected 72; retained 56.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| csv-workflow | local-reference | 3 | missing | unfinished |
| csv-workflow | native-codex | 1 | missing | not started |
| csv-workflow | native-codex | 2 | missing | not started |
| csv-workflow | native-codex | 3 | missing | not started |
| markdown-notes | rifty | 1 | missing | not started |
| markdown-notes | rifty | 2 | missing | not started |
| markdown-notes | rifty | 3 | missing | not started |
| markdown-notes | rifty-no-coi | 1 | missing | not started |
| markdown-notes | rifty-no-coi | 2 | missing | not started |
| markdown-notes | rifty-no-coi | 3 | missing | not started |
| markdown-notes | local-reference | 1 | missing | not started |
| markdown-notes | local-reference | 2 | missing | not started |
| markdown-notes | local-reference | 3 | missing | not started |
| markdown-notes | native-codex | 1 | missing | not started |
| markdown-notes | native-codex | 2 | missing | not started |
| markdown-notes | native-codex | 3 | missing | not started |
| ms-negative | rifty | 1 | fail | error | 7.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 7.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 7.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 5.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 5.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 39.3 | 8 | 15728 | 642 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | pass | done | 26.0 | 9 | 16306 | 882 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 3 | pass | done | 43.6 | 11 | 28414 | 1462 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 68.0 | 9 | 159938 | 1078 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 66.6 | 10 | 152049 | 1130 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 54.1 | 6 | 117160 | 863 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 31.5 | 10 | 24435 | 833 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 45.7 | 9 | 28286 | 1003 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 19.1 | 7 | 14139 | 611 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 70.0 | 6 | 137464 | 1200 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 58.1 | 6 | 112050 | 926 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 67.2 | 7 | 137078 | 1027 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 11.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 11.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 9.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 9.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 32.6 | 11 | 21396 | 886 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 31.9 | 11 | 24193 | 984 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 31.0 | 10 | 18331 | 1019 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 135.6 | 12 | 206154 | 2450 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 109.2 | 12 | 203680 | 1873 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 115.8 | 12 | 207338 | 2030 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 3.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 49.5 | 11 | 34340 | 1530 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 2 | pass | done | 42.3 | 10 | 28596 | 1235 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 3 | pass | done | 54.3 | 12 | 48290 | 1573 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | pass | done | 142.8 | 11 | 227552 | 2831 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 132.2 | 11 | 227792 | 2776 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 132.9 | 9 | 249550 | 2640 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow | rifty | 1 | fail | done | 96.2 | 7 | 21701 | 4526 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty | 2 | fail | done | 78.9 | 7 | 19401 | 3570 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty | 3 | fail | done | 114.9 | 7 | 22769 | 4353 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty-no-coi | 1 | pass | done | 80.1 | 7 | 17620 | 3576 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty-no-coi | 2 | fail | done | 91.7 | 7 | 19216 | 4243 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | rifty-no-coi | 3 | fail | done | 84.3 | 8 | 18966 | 4034 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | local-reference | 1 | fail | done | 133.5 | 8 | 22008 | 5442 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow | local-reference | 2 | fail | done | 82.0 | 6 | 18193 | 3958 | 0 | 0 | 0 | 0 | 0 | — | — |

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
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:57:56.111Z","complete":"2026-10-05T16:58:03.410Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:58:03.413Z","complete":"2026-10-05T16:58:10.628Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:58:10.632Z","complete":"2026-10-05T16:58:18.242Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:58:18.246Z","complete":"2026-10-05T16:58:24.260Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:58:24.266Z","complete":"2026-10-05T16:58:30.136Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:58:30.140Z","complete":"2026-10-05T16:58:35.939Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-05T16:58:35.944Z","agentStart":"2026-10-05T16:58:36.889Z","agentEnd":"2026-10-05T16:59:16.235Z","judgeStart":"2026-10-05T16:59:16.239Z","judgeEnd":"2026-10-05T16:59:16.299Z","complete":"2026-10-05T16:59:16.307Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-05T16:59:16.310Z","agentStart":"2026-10-05T16:59:17.344Z","agentEnd":"2026-10-05T16:59:43.326Z","judgeStart":"2026-10-05T16:59:43.333Z","judgeEnd":"2026-10-05T16:59:43.383Z","complete":"2026-10-05T16:59:43.388Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-05T16:59:43.391Z","agentStart":"2026-10-05T16:59:44.318Z","agentEnd":"2026-10-05T17:00:27.881Z","judgeStart":"2026-10-05T17:00:27.891Z","judgeEnd":"2026-10-05T17:00:27.940Z","complete":"2026-10-05T17:00:27.945Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-05T17:00:27.949Z","agentStart":"2026-10-05T17:00:28.914Z","agentEnd":"2026-10-05T17:01:36.902Z","judgeStart":"2026-10-05T17:01:36.906Z","judgeEnd":"2026-10-05T17:01:36.959Z","complete":"2026-10-05T17:01:36.965Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-05T17:01:36.968Z","agentStart":"2026-10-05T17:01:37.979Z","agentEnd":"2026-10-05T17:02:44.604Z","judgeStart":"2026-10-05T17:02:44.607Z","judgeEnd":"2026-10-05T17:02:44.660Z","complete":"2026-10-05T17:02:44.666Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-05T17:02:44.670Z","agentStart":"2026-10-05T17:02:45.629Z","agentEnd":"2026-10-05T17:03:39.743Z","judgeStart":"2026-10-05T17:03:39.746Z","judgeEnd":"2026-10-05T17:03:39.797Z","complete":"2026-10-05T17:03:39.803Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:03:39.808Z","complete":"2026-10-05T17:03:44.996Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:03:45.001Z","complete":"2026-10-05T17:03:50.578Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:03:50.583Z","complete":"2026-10-05T17:03:56.196Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:03:56.204Z","complete":"2026-10-05T17:03:59.492Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:03:59.497Z","complete":"2026-10-05T17:04:02.719Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:04:02.724Z","complete":"2026-10-05T17:04:06.313Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-05T17:04:06.318Z","agentStart":"2026-10-05T17:04:06.739Z","agentEnd":"2026-10-05T17:04:38.249Z","judgeStart":"2026-10-05T17:04:38.254Z","judgeEnd":"2026-10-05T17:04:38.311Z","complete":"2026-10-05T17:04:38.318Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-05T17:04:38.328Z","agentStart":"2026-10-05T17:04:38.800Z","agentEnd":"2026-10-05T17:05:24.511Z","judgeStart":"2026-10-05T17:05:24.520Z","judgeEnd":"2026-10-05T17:05:24.569Z","complete":"2026-10-05T17:05:24.574Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-05T17:05:24.578Z","agentStart":"2026-10-05T17:05:24.985Z","agentEnd":"2026-10-05T17:05:44.072Z","judgeStart":"2026-10-05T17:05:44.079Z","judgeEnd":"2026-10-05T17:05:44.128Z","complete":"2026-10-05T17:05:44.133Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-05T17:05:44.138Z","agentStart":"2026-10-05T17:05:44.586Z","agentEnd":"2026-10-05T17:06:54.563Z","judgeStart":"2026-10-05T17:06:54.567Z","judgeEnd":"2026-10-05T17:06:54.618Z","complete":"2026-10-05T17:06:54.623Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-05T17:06:54.628Z","agentStart":"2026-10-05T17:06:55.102Z","agentEnd":"2026-10-05T17:07:53.189Z","judgeStart":"2026-10-05T17:07:53.192Z","judgeEnd":"2026-10-05T17:07:53.239Z","complete":"2026-10-05T17:07:53.245Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-05T17:07:53.250Z","agentStart":"2026-10-05T17:07:53.701Z","agentEnd":"2026-10-05T17:09:00.941Z","judgeStart":"2026-10-05T17:09:00.945Z","judgeEnd":"2026-10-05T17:09:00.996Z","complete":"2026-10-05T17:09:01.002Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:09:01.008Z","complete":"2026-10-05T17:09:12.329Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:09:12.335Z","complete":"2026-10-05T17:10:43.766Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:10:43.775Z","complete":"2026-10-05T17:10:55.112Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:10:55.119Z","complete":"2026-10-05T17:11:04.130Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:11:04.138Z","complete":"2026-10-05T17:11:13.345Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:11:13.357Z","complete":"2026-10-05T17:11:22.514Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-05T17:11:22.523Z","agentStart":"2026-10-05T17:11:23.680Z","agentEnd":"2026-10-05T17:11:56.242Z","judgeStart":"2026-10-05T17:11:56.254Z","judgeEnd":"2026-10-05T17:11:56.316Z","complete":"2026-10-05T17:11:56.323Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-05T17:11:56.329Z","agentStart":"2026-10-05T17:11:57.452Z","agentEnd":"2026-10-05T17:12:29.365Z","judgeStart":"2026-10-05T17:12:29.376Z","judgeEnd":"2026-10-05T17:12:29.429Z","complete":"2026-10-05T17:12:29.436Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-05T17:12:29.446Z","agentStart":"2026-10-05T17:12:30.622Z","agentEnd":"2026-10-05T17:13:01.574Z","judgeStart":"2026-10-05T17:13:01.585Z","judgeEnd":"2026-10-05T17:13:01.634Z","complete":"2026-10-05T17:13:01.640Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-05T17:13:01.647Z","agentStart":"2026-10-05T17:13:02.876Z","agentEnd":"2026-10-05T17:15:18.514Z","judgeStart":"2026-10-05T17:15:18.523Z","judgeEnd":"2026-10-05T17:15:18.574Z","complete":"2026-10-05T17:15:18.582Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-05T17:15:18.591Z","agentStart":"2026-10-05T17:15:19.791Z","agentEnd":"2026-10-05T17:17:09.008Z","judgeStart":"2026-10-05T17:17:09.017Z","judgeEnd":"2026-10-05T17:17:09.067Z","complete":"2026-10-05T17:17:09.075Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-05T17:17:09.084Z","agentStart":"2026-10-05T17:17:10.269Z","agentEnd":"2026-10-05T17:19:06.087Z","judgeStart":"2026-10-05T17:19:06.096Z","judgeEnd":"2026-10-05T17:19:06.147Z","complete":"2026-10-05T17:19:06.156Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:06.168Z","complete":"2026-10-05T17:19:09.478Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:09.495Z","complete":"2026-10-05T17:19:13.050Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:13.061Z","complete":"2026-10-05T17:19:16.358Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:16.369Z","complete":"2026-10-05T17:19:18.161Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:18.174Z","complete":"2026-10-05T17:19:19.950Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T17:19:19.960Z","complete":"2026-10-05T17:19:21.811Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-05T17:19:21.824Z","agentStart":"2026-10-05T17:19:48.707Z","agentEnd":"2026-10-05T17:20:38.187Z","judgeStart":"2026-10-05T17:20:38.199Z","judgeEnd":"2026-10-05T17:20:39.793Z","complete":"2026-10-05T17:20:39.804Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-05T17:20:39.817Z","agentStart":"2026-10-05T17:20:54.329Z","agentEnd":"2026-10-05T17:21:36.606Z","judgeStart":"2026-10-05T17:21:36.616Z","judgeEnd":"2026-10-05T17:21:38.228Z","complete":"2026-10-05T17:21:38.241Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-05T17:21:38.258Z","agentStart":"2026-10-05T17:21:57.320Z","agentEnd":"2026-10-05T17:22:51.619Z","judgeStart":"2026-10-05T17:22:51.635Z","judgeEnd":"2026-10-05T17:22:53.228Z","complete":"2026-10-05T17:22:53.240Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-05T17:22:53.254Z","agentStart":"2026-10-05T17:23:09.366Z","agentEnd":"2026-10-05T17:25:32.153Z","judgeStart":"2026-10-05T17:25:32.157Z","judgeEnd":"2026-10-05T17:25:33.752Z","complete":"2026-10-05T17:25:33.764Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-05T17:25:33.778Z","agentStart":"2026-10-05T17:25:49.330Z","agentEnd":"2026-10-05T17:28:01.546Z","judgeStart":"2026-10-05T17:28:01.552Z","judgeEnd":"2026-10-05T17:28:03.151Z","complete":"2026-10-05T17:28:03.165Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-05T17:28:03.179Z","agentStart":"2026-10-05T17:28:18.869Z","agentEnd":"2026-10-05T17:30:31.805Z","judgeStart":"2026-10-05T17:30:31.812Z","judgeEnd":"2026-10-05T17:30:33.424Z","complete":"2026-10-05T17:30:33.437Z"} |
| csv-workflow/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty/1/after.json | {"start":"2026-10-05T17:30:33.453Z","agentStart":"2026-10-05T17:30:40.769Z","agentEnd":"2026-10-05T17:32:16.985Z","judgeStart":"2026-10-05T17:32:17.345Z","judgeEnd":"2026-10-05T17:32:48.542Z","complete":"2026-10-05T17:32:48.904Z"} |
| csv-workflow/rifty/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty/2/after.json | {"start":"2026-10-05T17:32:48.915Z","agentStart":"2026-10-05T17:33:10.252Z","agentEnd":"2026-10-05T17:34:29.155Z","judgeStart":"2026-10-05T17:34:29.454Z","judgeEnd":"2026-10-05T17:35:00.756Z","complete":"2026-10-05T17:35:01.058Z"} |
| csv-workflow/rifty/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty/3/after.json | {"start":"2026-10-05T17:35:01.070Z","agentStart":"2026-10-05T17:35:08.361Z","agentEnd":"2026-10-05T17:37:03.223Z","judgeStart":"2026-10-05T17:37:03.607Z","judgeEnd":"2026-10-05T17:37:34.804Z","complete":"2026-10-05T17:37:35.173Z"} |
| csv-workflow/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/1/after.json | {"start":"2026-10-05T17:37:35.185Z","agentStart":"2026-10-05T17:37:40.367Z","agentEnd":"2026-10-05T17:39:00.423Z","judgeStart":"2026-10-05T17:39:00.628Z","judgeEnd":"2026-10-05T17:39:08.172Z","complete":"2026-10-05T17:39:08.316Z"} |
| csv-workflow/rifty-no-coi/2 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/2/after.json | {"start":"2026-10-05T17:39:08.328Z","agentStart":"2026-10-05T17:39:14.931Z","agentEnd":"2026-10-05T17:40:46.637Z","judgeStart":"2026-10-05T17:40:46.916Z","judgeEnd":"2026-10-05T17:41:17.749Z","complete":"2026-10-05T17:41:17.969Z"} |
| csv-workflow/rifty-no-coi/3 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/3/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/3/before.json / [bundle](source-artifacts.json.gz): csv-workflow/rifty-no-coi/3/after.json | {"start":"2026-10-05T17:41:17.983Z","agentStart":"2026-10-05T17:41:22.594Z","agentEnd":"2026-10-05T17:42:46.888Z","judgeStart":"2026-10-05T17:42:47.101Z","judgeEnd":"2026-10-05T17:43:17.924Z","complete":"2026-10-05T17:43:18.124Z"} |
| csv-workflow/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow/local-reference/1/after.json | {"start":"2026-10-05T17:43:18.138Z","agentStart":"2026-10-05T17:43:20.566Z","agentEnd":"2026-10-05T17:45:34.039Z","judgeStart":"2026-10-05T17:45:34.058Z","judgeEnd":"2026-10-05T17:46:05.532Z","complete":"2026-10-05T17:46:05.586Z"} |
| csv-workflow/local-reference/2 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): csv-workflow/local-reference/2/before.json / [bundle](source-artifacts.json.gz): csv-workflow/local-reference/2/after.json | {"start":"2026-10-05T17:46:05.599Z","agentStart":"2026-10-05T17:46:07.985Z","agentEnd":"2026-10-05T17:47:29.960Z","judgeStart":"2026-10-05T17:47:29.976Z","judgeEnd":"2026-10-05T17:48:00.874Z","complete":"2026-10-05T17:48:00.894Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 72; retained 56; missing 16.
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
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 60448/2986 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 429147/3071 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 66860/2447 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 386592/3153 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 63920/2889 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 617172/6353 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 111226/4338 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 704894/8247 |
| csv-workflow | evaluation/app | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | unavailable | unavailable | {"functional":3} | 63871/12449 |
| csv-workflow | evaluation/app | rifty-no-coi | 1/3 | 0 | 0/0 | 0.333 | [0.008, 0.906] | unavailable | unavailable | {"functional":2} | 55802/11853 |
| csv-workflow | evaluation/app | local-reference | 0/3 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":2} | 40201/9400 |
| csv-workflow | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

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
| evaluation | all | rifty | 4/4 | 0/12 | 3 | unavailable | [0.000, 0.924] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | all | rifty-no-coi | 4/4 | 1/12 | 3 | unavailable | [0.000, 0.945] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 4/4 | 6/12 | 4 | unavailable | [0.051, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/4 | 6/12 | 6 | unavailable | [0.051, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/2 | 0/6 | 3 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 1/6 | 3 | unavailable | [0.000, 0.991] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 0/6 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | separate reference | unavailable |
