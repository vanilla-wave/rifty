# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: pilot-v1; runs/task: 3.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: eac88e8975102f150fc5f6fd476e74c1160b1959; versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: interrupted; selected 72; retained 15.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| ms-weeks | rifty-no-coi | 1 | missing | unfinished |
| ms-weeks | rifty-no-coi | 2 | missing | not started |
| ms-weeks | rifty-no-coi | 3 | missing | not started |
| ms-weeks | local-reference | 1 | missing | not started |
| ms-weeks | local-reference | 2 | missing | not started |
| ms-weeks | local-reference | 3 | missing | not started |
| ms-weeks | native-codex | 1 | missing | not started |
| ms-weeks | native-codex | 2 | missing | not started |
| ms-weeks | native-codex | 3 | missing | not started |
| stringify-boxed | rifty | 1 | missing | not started |
| stringify-boxed | rifty | 2 | missing | not started |
| stringify-boxed | rifty | 3 | missing | not started |
| stringify-boxed | rifty-no-coi | 1 | missing | not started |
| stringify-boxed | rifty-no-coi | 2 | missing | not started |
| stringify-boxed | rifty-no-coi | 3 | missing | not started |
| stringify-boxed | local-reference | 1 | missing | not started |
| stringify-boxed | local-reference | 2 | missing | not started |
| stringify-boxed | local-reference | 3 | missing | not started |
| stringify-boxed | native-codex | 1 | missing | not started |
| stringify-boxed | native-codex | 2 | missing | not started |
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
| csv-workflow | rifty | 1 | missing | not started |
| csv-workflow | rifty | 2 | missing | not started |
| csv-workflow | rifty | 3 | missing | not started |
| csv-workflow | rifty-no-coi | 1 | missing | not started |
| csv-workflow | rifty-no-coi | 2 | missing | not started |
| csv-workflow | rifty-no-coi | 3 | missing | not started |
| csv-workflow | local-reference | 1 | missing | not started |
| csv-workflow | local-reference | 2 | missing | not started |
| csv-workflow | local-reference | 3 | missing | not started |
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
| ms-negative | rifty | 1 | fail | error | 8.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 2 | fail | error | 7.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty | 3 | fail | error | 7.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 2 | fail | error | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 3 | fail | error | 6.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | fail | error | 14.6 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 2 | fail | error | 14.5 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 3 | fail | error | 14.5 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | done | 73.0 | 9 | 182258 | 1084 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 2 | pass | done | 66.3 | 9 | 151637 | 1060 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-negative | native-codex | 3 | pass | done | 83.7 | 10 | 185116 | 1273 | unknown | unknown | unknown | unknown | unknown | — | — |
| ms-weeks | rifty | 1 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 2 | fail | error | 5.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 3 | fail | error | 5.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

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
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:15.394Z","complete":"2026-10-05T16:48:24.266Z"} |
| ms-negative/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:24.270Z","complete":"2026-10-05T16:48:31.944Z"} |
| ms-negative/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:31.947Z","complete":"2026-10-05T16:48:39.625Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:39.628Z","complete":"2026-10-05T16:48:45.315Z"} |
| ms-negative/rifty-no-coi/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:45.318Z","complete":"2026-10-05T16:48:51.067Z"} |
| ms-negative/rifty-no-coi/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:48:51.069Z","complete":"2026-10-05T16:48:57.026Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-05T16:48:57.032Z","agentStart":"2026-10-05T16:48:58.013Z","agentEnd":"2026-10-05T16:49:12.588Z","judgeStart":"2026-10-05T16:49:12.592Z","judgeEnd":"2026-10-05T16:49:12.644Z","complete":"2026-10-05T16:49:12.652Z"} |
| ms-negative/local-reference/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/2/after.json | {"start":"2026-10-05T16:49:12.655Z","agentStart":"2026-10-05T16:49:13.594Z","agentEnd":"2026-10-05T16:49:28.092Z","judgeStart":"2026-10-05T16:49:28.094Z","judgeEnd":"2026-10-05T16:49:28.136Z","complete":"2026-10-05T16:49:28.140Z"} |
| ms-negative/local-reference/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/3/after.json | {"start":"2026-10-05T16:49:28.144Z","agentStart":"2026-10-05T16:49:29.104Z","agentEnd":"2026-10-05T16:49:43.625Z","judgeStart":"2026-10-05T16:49:43.627Z","judgeEnd":"2026-10-05T16:49:43.673Z","complete":"2026-10-05T16:49:43.678Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-05T16:49:43.682Z","agentStart":"2026-10-05T16:49:44.664Z","agentEnd":"2026-10-05T16:50:57.709Z","judgeStart":"2026-10-05T16:50:57.712Z","judgeEnd":"2026-10-05T16:50:57.776Z","complete":"2026-10-05T16:50:57.782Z"} |
| ms-negative/native-codex/2 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/2/after.json | {"start":"2026-10-05T16:50:57.786Z","agentStart":"2026-10-05T16:50:58.757Z","agentEnd":"2026-10-05T16:52:05.096Z","judgeStart":"2026-10-05T16:52:05.098Z","judgeEnd":"2026-10-05T16:52:05.145Z","complete":"2026-10-05T16:52:05.155Z"} |
| ms-negative/native-codex/3 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/3/after.json | {"start":"2026-10-05T16:52:05.159Z","agentStart":"2026-10-05T16:52:06.113Z","agentEnd":"2026-10-05T16:53:29.810Z","judgeStart":"2026-10-05T16:53:29.815Z","judgeEnd":"2026-10-05T16:53:29.868Z","complete":"2026-10-05T16:53:29.874Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:53:29.878Z","complete":"2026-10-05T16:53:35.482Z"} |
| ms-weeks/rifty/2 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/2/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:53:35.487Z","complete":"2026-10-05T16:53:40.764Z"} |
| ms-weeks/rifty/3 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/3/trace.json | unavailable / unavailable | {"start":"2026-10-05T16:53:40.769Z","complete":"2026-10-05T16:53:46.367Z"} |

## Fixed-matrix outcomes

Purpose: quality; selected 72; retained 15; missing 57.
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
| ms-negative | calibration/bug | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | 0.000 | [-0.899, 0.899] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | rifty-no-coi | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | 0.000 | [-0.899, 0.899] | {"setup":3} | 0/0 |
| ms-negative | calibration/bug | local-reference | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | 0.000 | [0.000, 0.000] | {"agent":3} | 0/0 |
| ms-negative | calibration/bug | native-codex | 3/3 | 0 | 0/0 | 1.000 | [0.292, 1.000] | separate reference | unavailable | {} | 519011/3417 |
| ms-weeks | calibration/feature | rifty | 0/3 | 0 | 0/0 | 0.000 | [0.000, 0.708] | unavailable | unavailable | {"setup":3} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| csv-workflow | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | rifty | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | rifty-no-coi | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | local-reference | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes | evaluation/app | native-codex | 0/3 | 3 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | 0.000 | [-0.899, 0.899] |
| calibration | all | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | unavailable | unavailable |
| calibration | project-change | rifty | 2/1 | 0/6 | 0 | 0.000 | [0.000, 0.899] | unavailable | unavailable |
| calibration | bug | rifty-no-coi | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | 0.000 | [-0.899, 0.899] |
| calibration | all | rifty-no-coi | 2/1 | 0/6 | 3 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| calibration | project-change | rifty-no-coi | 2/1 | 0/6 | 3 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| calibration | bug | local-reference | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | 0.000 | [0.000, 0.000] |
| calibration | all | local-reference | 2/1 | 0/6 | 3 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| calibration | project-change | local-reference | 2/1 | 0/6 | 3 | unavailable | [0.000, 0.949] | unavailable | unavailable |
| calibration | bug | native-codex | 1/1 | 3/3 | 0 | 1.000 | [0.101, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 3/6 | 3 | unavailable | [0.051, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 3/6 | 3 | unavailable | [0.051, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/3 | 0 | 0.000 | [0.000, 0.899] | unavailable | unavailable |
| calibration | feature | rifty-no-coi | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | local-reference | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | native-codex | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | rifty-no-coi | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | local-reference | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | native-codex | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 4/4 | 0/12 | 12 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 1/1 | 0/3 | 3 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 2/2 | 0/6 | 6 | unavailable | [0.000, 1.000] | separate reference | unavailable |
