# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v2; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 0bed68b575f3a4a4f01c6babf0f15f2c0a5e7265; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 72; retained 49.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| csv-workflow-v2 | rifty | 2 | missing | unfinished |
| csv-workflow-v2 | rifty | 3 | missing | not started |
| csv-workflow-v2 | rifty-no-coi | 1 | missing | not started |
| csv-workflow-v2 | rifty-no-coi | 2 | missing | not started |
| csv-workflow-v2 | rifty-no-coi | 3 | missing | not started |
| csv-workflow-v2 | local-reference | 1 | missing | not started |
| csv-workflow-v2 | local-reference | 2 | missing | not started |
| csv-workflow-v2 | local-reference | 3 | missing | not started |
| csv-workflow-v2 | native-codex | 1 | missing | not started |
| csv-workflow-v2 | native-codex | 2 | missing | not started |
| csv-workflow-v2 | native-codex | 3 | missing | not started |
| markdown-notes-v2 | rifty | 1 | missing | not started |
| markdown-notes-v2 | rifty | 2 | missing | not started |
| markdown-notes-v2 | rifty | 3 | missing | not started |
| markdown-notes-v2 | rifty-no-coi | 1 | missing | not started |
| markdown-notes-v2 | rifty-no-coi | 2 | missing | not started |
| markdown-notes-v2 | rifty-no-coi | 3 | missing | not started |
| markdown-notes-v2 | local-reference | 1 | missing | not started |
| markdown-notes-v2 | local-reference | 2 | missing | not started |
| markdown-notes-v2 | local-reference | 3 | missing | not started |
| markdown-notes-v2 | native-codex | 1 | missing | not started |
| markdown-notes-v2 | native-codex | 2 | missing | not started |
| markdown-notes-v2 | native-codex | 3 | missing | not started |
| ms-negative | rifty | 1 | fail | error | 8.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 8.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 9.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 6.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 6.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 7.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | done | 30.7 | 7 | 15653 | 650 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | pass | done | 20.9 | 7 | 15559 | 482 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 3 | pass | done | 18.7 | 7 | 15559 | 500 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 44.8 | 9 | 153536 | 858 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 54.1 | 9 | 182740 | 1069 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 55.1 | 10 | 174546 | 1252 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | error | 3.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 2 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 3 | fail | error | 3.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | done | 32.3 | 8 | 22200 | 613 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 2 | pass | done | 31.1 | 10 | 20300 | 818 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 3 | pass | done | 19.9 | 7 | 17779 | 527 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | done | 45.5 | 8 | 138899 | 1063 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 2 | pass | done | 46.2 | 8 | 137112 | 989 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | native-codex | 3 | pass | done | 42.4 | 6 | 113769 | 1057 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | rifty | 1 | fail | error | 11.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 2 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 3 | fail | error | 11.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | error | 9.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 2 | fail | error | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 3 | fail | error | 9.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | done | 36.7 | 8 | 13348 | 797 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 2 | pass | done | 32.0 | 5 | 14233 | 702 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 3 | pass | done | 18.8 | 7 | 17163 | 467 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | done | 83.8 | 12 | 209112 | 2026 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 2 | pass | done | 69.8 | 12 | 194494 | 1752 | unknown | unknown | unknown | unknown | unknown | — | — |
| stringify-boxed | native-codex | 3 | pass | done | 78.1 | 11 | 175777 | 1853 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | rifty | 1 | fail | error | 91.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 2 | fail | error | 4.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 3 | fail | error | 3.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | error | 1.8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 2 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 3 | fail | error | 1.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | done | 56.5 | 14 | 60063 | 1559 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 2 | pass | done | 41.6 | 10 | 28588 | 1298 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 3 | pass | done | 47.5 | 10 | 33903 | 1272 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | pass | done | 87.7 | 9 | 241175 | 2704 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 2 | pass | done | 102.8 | 13 | 240166 | 2643 | unknown | unknown | unknown | unknown | unknown | — | — |
| queue-clear | native-codex | 3 | pass | done | 87.5 | 8 | 242189 | 2672 | unknown | unknown | unknown | unknown | unknown | — | — |
| csv-workflow-v2 | rifty | 1 | fail | done | 104.9 | 8 | 23990 | 4763 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | e94f68eb2630d5861dd82d0cc08dec4d096194f104cc5ef8de3b1f1b7ea932bd |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 764774cdf35f19b2600774b510f292c71eabf8eeb112a64ad2d5a89467acba7b |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 506373c279d1017c2e22d73c7405caa531eda03522db81b5cf52ba9ac4661b0c |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 2ce55952de39018e5631274a7a0545743c279a270e04a37462679e1c414d9397 |
| csv-workflow-v2 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | fff61cc80035a37628ae8cedd19fd680b9b286072a014b89a1d38b5e073a8a61 |
| markdown-notes-v2 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | e554717f9d28fbdb11cd6678659973e2e7fe6beaa6ad255099b8859ac9fda5b7 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:36:48.705Z","complete":"2026-10-05T19:36:57.409Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:36:57.412Z","complete":"2026-10-05T19:37:06.064Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:37:06.067Z","complete":"2026-10-05T19:37:15.725Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:37:15.729Z","complete":"2026-10-05T19:37:22.089Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:37:22.094Z","complete":"2026-10-05T19:37:28.796Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:37:28.802Z","complete":"2026-10-05T19:37:35.815Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-05T19:37:35.820Z","agentStart":"2026-10-05T19:37:36.821Z","agentEnd":"2026-10-05T19:38:07.478Z","judgeStart":"2026-10-05T19:38:07.485Z","judgeEnd":"2026-10-05T19:38:07.536Z","complete":"2026-10-05T19:38:07.544Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-05T19:38:07.547Z","agentStart":"2026-10-05T19:38:08.521Z","agentEnd":"2026-10-05T19:38:29.436Z","judgeStart":"2026-10-05T19:38:29.443Z","judgeEnd":"2026-10-05T19:38:29.493Z","complete":"2026-10-05T19:38:29.499Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-05T19:38:29.507Z","agentStart":"2026-10-05T19:38:30.445Z","agentEnd":"2026-10-05T19:38:49.163Z","judgeStart":"2026-10-05T19:38:49.170Z","judgeEnd":"2026-10-05T19:38:49.232Z","complete":"2026-10-05T19:38:49.237Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-05T19:38:49.241Z","agentStart":"2026-10-05T19:38:50.232Z","agentEnd":"2026-10-05T19:39:35.011Z","judgeStart":"2026-10-05T19:39:35.015Z","judgeEnd":"2026-10-05T19:39:35.065Z","complete":"2026-10-05T19:39:35.070Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-05T19:39:35.073Z","agentStart":"2026-10-05T19:39:36.024Z","agentEnd":"2026-10-05T19:40:30.166Z","judgeStart":"2026-10-05T19:40:30.170Z","judgeEnd":"2026-10-05T19:40:30.223Z","complete":"2026-10-05T19:40:30.229Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-05T19:40:30.233Z","agentStart":"2026-10-05T19:40:31.198Z","agentEnd":"2026-10-05T19:41:26.339Z","judgeStart":"2026-10-05T19:41:26.343Z","judgeEnd":"2026-10-05T19:41:26.409Z","complete":"2026-10-05T19:41:26.415Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:26.421Z","complete":"2026-10-05T19:41:32.048Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:32.054Z","complete":"2026-10-05T19:41:37.701Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:37.706Z","complete":"2026-10-05T19:41:43.549Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:43.555Z","complete":"2026-10-05T19:41:46.968Z"} |
| ms-weeks/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:46.972Z","complete":"2026-10-05T19:41:50.247Z"} |
| ms-weeks/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:41:50.252Z","complete":"2026-10-05T19:41:53.601Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-05T19:41:53.606Z","agentStart":"2026-10-05T19:41:54.058Z","agentEnd":"2026-10-05T19:42:26.313Z","judgeStart":"2026-10-05T19:42:26.321Z","judgeEnd":"2026-10-05T19:42:26.372Z","complete":"2026-10-05T19:42:26.378Z"} |
| ms-weeks/local-reference/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/2/after.json | {"start":"2026-10-05T19:42:26.382Z","agentStart":"2026-10-05T19:42:26.794Z","agentEnd":"2026-10-05T19:42:57.871Z","judgeStart":"2026-10-05T19:42:57.878Z","judgeEnd":"2026-10-05T19:42:57.941Z","complete":"2026-10-05T19:42:57.947Z"} |
| ms-weeks/local-reference/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/3/after.json | {"start":"2026-10-05T19:42:57.951Z","agentStart":"2026-10-05T19:42:58.368Z","agentEnd":"2026-10-05T19:43:18.302Z","judgeStart":"2026-10-05T19:43:18.308Z","judgeEnd":"2026-10-05T19:43:18.361Z","complete":"2026-10-05T19:43:18.366Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-05T19:43:18.373Z","agentStart":"2026-10-05T19:43:18.842Z","agentEnd":"2026-10-05T19:44:04.324Z","judgeStart":"2026-10-05T19:44:04.327Z","judgeEnd":"2026-10-05T19:44:04.391Z","complete":"2026-10-05T19:44:04.398Z"} |
| ms-weeks/native-codex/2 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/2/after.json | {"start":"2026-10-05T19:44:04.403Z","agentStart":"2026-10-05T19:44:04.851Z","agentEnd":"2026-10-05T19:44:51.042Z","judgeStart":"2026-10-05T19:44:51.045Z","judgeEnd":"2026-10-05T19:44:51.094Z","complete":"2026-10-05T19:44:51.100Z"} |
| ms-weeks/native-codex/3 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/3/after.json | {"start":"2026-10-05T19:44:51.106Z","agentStart":"2026-10-05T19:44:51.559Z","agentEnd":"2026-10-05T19:45:34.004Z","judgeStart":"2026-10-05T19:45:34.007Z","judgeEnd":"2026-10-05T19:45:34.058Z","complete":"2026-10-05T19:45:34.064Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:45:34.071Z","complete":"2026-10-05T19:45:45.751Z"} |
| stringify-boxed/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:45:45.758Z","complete":"2026-10-05T19:47:17.203Z"} |
| stringify-boxed/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:47:17.209Z","complete":"2026-10-05T19:47:28.979Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:47:28.991Z","complete":"2026-10-05T19:47:38.163Z"} |
| stringify-boxed/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:47:38.170Z","complete":"2026-10-05T19:47:47.183Z"} |
| stringify-boxed/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:47:47.189Z","complete":"2026-10-05T19:47:56.296Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-05T19:47:56.304Z","agentStart":"2026-10-05T19:47:57.596Z","agentEnd":"2026-10-05T19:48:34.311Z","judgeStart":"2026-10-05T19:48:34.320Z","judgeEnd":"2026-10-05T19:48:34.378Z","complete":"2026-10-05T19:48:34.385Z"} |
| stringify-boxed/local-reference/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/2/after.json | {"start":"2026-10-05T19:48:34.392Z","agentStart":"2026-10-05T19:48:35.555Z","agentEnd":"2026-10-05T19:49:07.573Z","judgeStart":"2026-10-05T19:49:07.579Z","judgeEnd":"2026-10-05T19:49:07.622Z","complete":"2026-10-05T19:49:07.630Z"} |
| stringify-boxed/local-reference/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/3/after.json | {"start":"2026-10-05T19:49:07.640Z","agentStart":"2026-10-05T19:49:08.894Z","agentEnd":"2026-10-05T19:49:27.708Z","judgeStart":"2026-10-05T19:49:27.717Z","judgeEnd":"2026-10-05T19:49:27.766Z","complete":"2026-10-05T19:49:27.774Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-05T19:49:27.788Z","agentStart":"2026-10-05T19:49:29.075Z","agentEnd":"2026-10-05T19:50:52.891Z","judgeStart":"2026-10-05T19:50:52.899Z","judgeEnd":"2026-10-05T19:50:52.947Z","complete":"2026-10-05T19:50:52.954Z"} |
| stringify-boxed/native-codex/2 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/2/after.json | {"start":"2026-10-05T19:50:52.962Z","agentStart":"2026-10-05T19:50:54.277Z","agentEnd":"2026-10-05T19:52:04.083Z","judgeStart":"2026-10-05T19:52:04.088Z","judgeEnd":"2026-10-05T19:52:04.140Z","complete":"2026-10-05T19:52:04.148Z"} |
| stringify-boxed/native-codex/3 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/3/after.json | {"start":"2026-10-05T19:52:04.159Z","agentStart":"2026-10-05T19:52:05.433Z","agentEnd":"2026-10-05T19:53:23.514Z","judgeStart":"2026-10-05T19:53:23.522Z","judgeEnd":"2026-10-05T19:53:23.583Z","complete":"2026-10-05T19:53:23.592Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:53:23.601Z","complete":"2026-10-05T19:54:55.041Z"} |
| queue-clear/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:54:55.052Z","complete":"2026-10-05T19:54:59.016Z"} |
| queue-clear/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:54:59.026Z","complete":"2026-10-05T19:55:02.898Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:55:02.908Z","complete":"2026-10-05T19:55:04.744Z"} |
| queue-clear/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:55:04.753Z","complete":"2026-10-05T19:55:06.485Z"} |
| queue-clear/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T19:55:06.495Z","complete":"2026-10-05T19:55:08.211Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-05T19:55:08.220Z","agentStart":"2026-10-05T19:55:36.327Z","agentEnd":"2026-10-05T19:56:32.827Z","judgeStart":"2026-10-05T19:56:32.839Z","judgeEnd":"2026-10-05T19:56:34.426Z","complete":"2026-10-05T19:56:34.439Z"} |
| queue-clear/local-reference/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/2/after.json | {"start":"2026-10-05T19:56:34.452Z","agentStart":"2026-10-05T19:56:48.896Z","agentEnd":"2026-10-05T19:57:30.454Z","judgeStart":"2026-10-05T19:57:30.462Z","judgeEnd":"2026-10-05T19:57:32.047Z","complete":"2026-10-05T19:57:32.061Z"} |
| queue-clear/local-reference/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/3/after.json | {"start":"2026-10-05T19:57:32.087Z","agentStart":"2026-10-05T19:57:50.285Z","agentEnd":"2026-10-05T19:58:37.771Z","judgeStart":"2026-10-05T19:58:37.782Z","judgeEnd":"2026-10-05T19:58:39.376Z","complete":"2026-10-05T19:58:39.385Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-05T19:58:39.397Z","agentStart":"2026-10-05T19:58:54.263Z","agentEnd":"2026-10-05T20:00:21.930Z","judgeStart":"2026-10-05T20:00:21.936Z","judgeEnd":"2026-10-05T20:00:23.520Z","complete":"2026-10-05T20:00:23.536Z"} |
| queue-clear/native-codex/2 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/2/after.json | {"start":"2026-10-05T20:00:23.555Z","agentStart":"2026-10-05T20:00:39.617Z","agentEnd":"2026-10-05T20:02:22.446Z","judgeStart":"2026-10-05T20:02:22.449Z","judgeEnd":"2026-10-05T20:02:24.026Z","complete":"2026-10-05T20:02:24.045Z"} |
| queue-clear/native-codex/3 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/3/after.json | {"start":"2026-10-05T20:02:24.061Z","agentStart":"2026-10-05T20:02:38.560Z","agentEnd":"2026-10-05T20:04:06.023Z","judgeStart":"2026-10-05T20:04:06.026Z","judgeEnd":"2026-10-05T20:04:07.616Z","complete":"2026-10-05T20:04:07.633Z"} |
| csv-workflow-v2/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v2/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v2/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v2/rifty/1/after.json | {"start":"2026-10-05T20:04:07.650Z","agentStart":"2026-10-05T20:04:15.770Z","agentEnd":"2026-10-05T20:06:00.623Z","judgeStart":"2026-10-05T20:06:01.138Z","judgeEnd":"2026-10-05T20:06:02.892Z","complete":"2026-10-05T20:06:03.309Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 72; retained 49; missing 23.
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
| ms-negative | calibration/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 46771/1632 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 510822/3179 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 60279/1958 |
| ms-weeks | calibration/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 389780/3109 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 44744/1966 |
| stringify-boxed | evaluation/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 579383/5631 |
| queue-clear | evaluation/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | -1.000 | [-1.000, 0.797] | {"setup":3} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | 0.000 | [0.000, 0.000] | {} | 122554/4129 |
| queue-clear | evaluation/feature | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 723530/8019 |
| csv-workflow-v2 | evaluation/app | rifty | 0/3 | 2 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 23990/4763 |
| csv-workflow-v2 | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v2 | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v2 | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v2 | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
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
| evaluation | all | rifty | 4/4 | 0/12 | 5 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | all | rifty-no-coi | 4/4 | 0/12 | 6 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | bug | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | all | local-reference | 4/4 | 6/12 | 6 | unavailable | [0.051, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/4 | 6/12 | 6 | unavailable | [0.051, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 6/6 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | -1.000 | [-1.000, 0.797] |
| evaluation | feature | local-reference | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | 0.000 | [0.000, 0.000] |
| evaluation | feature | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/2 | 0/6 | 5 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | separate reference | unavailable |
