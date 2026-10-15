# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 927dba64ace86a94634892c2578b6d269933e9f5 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96","codexCli":"codex-cli 0.159.3"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot","cliVersion":"codex-cli 0.159.3"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: completed; selected 32; retained 32.
Incomplete series is partial evidence; missing work is never success.

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| ms-negative | rifty | 1 | fail | not-run | 7.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | rifty-no-coi | 1 | fail | not-run | 6.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-negative | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty | 1 | fail | not-run | 5.7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | rifty-no-coi | 1 | fail | not-run | 3.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| ms-weeks | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty | 1 | fail | not-run | 91.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | rifty-no-coi | 1 | fail | not-run | 9.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| stringify-boxed | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty | 1 | fail | not-run | 3.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | rifty-no-coi | 1 | fail | not-run | 1.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| queue-clear | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty | 1 | pass | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| csv-workflow-v3 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| markdown-notes-v3 | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow | rifty | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| booking-workflow | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement | rifty | 1 | fail | not-run | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement | rifty-no-coi | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement | local-reference | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| expense-settlement | native-codex | 1 | pass | not-run | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | e330261bf74e16bddac8532944f0a3158329d8cbfb9e242cb2dd622d6c3d7969 |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 10ca8dba21acc89ae85fca0173c1153872cd640aa02fc73f89e8f0fcc6553ab3 |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 16859798ed7cbee5ee20ba2ee8e98cb41122305ce33f0ff361c2842a1e516d81 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 05b8e1271512bf2b76695d20a5bf8829b98cccac23bbcf8d76d25ecdd9aeb99e |
| csv-workflow-v3 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | f3bc39f39b8192ffd78ebce07ff1aba012b0400ecf67cbf25206e0a2863edf62 |
| markdown-notes-v3 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | c0034204f82fb377f41387737fa9d0baba12bfeb0f3825eef388395764d6219e |
| booking-workflow | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 22bffd5f1893b7ced5e727d5a8d82361081a03c77ae6527c68097142ac5d43ea | 8fa70d55c866df961e28ac8c6868d4d5c1adf4424447bbe9b89e22890c2ba0f1 |
| expense-settlement | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | cc391668922db93363ec2ee58461e40e06ab9f84e8b592eeeb633f7cfc5c6932 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|
| ms-negative/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:57:35.922Z","complete":"2026-10-06T03:57:43.248Z"} |
| ms-negative/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-negative/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:57:43.252Z","complete":"2026-10-06T03:57:49.701Z"} |
| ms-negative/local-reference/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/local-reference/1/after.json | {"start":"2026-10-06T03:57:49.709Z","judgeStart":"2026-10-06T03:57:50.807Z","judgeEnd":"2026-10-06T03:57:50.846Z","complete":"2026-10-06T03:57:50.853Z"} |
| ms-negative/native-codex/1 | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da/1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-negative/native-codex/1/after.json | {"start":"2026-10-06T03:57:50.856Z","judgeStart":"2026-10-06T03:57:51.875Z","judgeEnd":"2026-10-06T03:57:51.915Z","complete":"2026-10-06T03:57:51.920Z"} |
| ms-weeks/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:57:51.923Z","complete":"2026-10-06T03:57:57.645Z"} |
| ms-weeks/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): ms-weeks/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:57:57.649Z","complete":"2026-10-06T03:58:00.833Z"} |
| ms-weeks/local-reference/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/local-reference/1/after.json | {"start":"2026-10-06T03:58:00.837Z","judgeStart":"2026-10-06T03:58:01.306Z","judgeEnd":"2026-10-06T03:58:01.346Z","complete":"2026-10-06T03:58:01.351Z"} |
| ms-weeks/native-codex/1 | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44/bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/before.json / [bundle](source-artifacts.json.gz): ms-weeks/native-codex/1/after.json | {"start":"2026-10-06T03:58:01.354Z","judgeStart":"2026-10-06T03:58:01.850Z","judgeEnd":"2026-10-06T03:58:01.892Z","complete":"2026-10-06T03:58:01.897Z"} |
| stringify-boxed/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:58:01.900Z","complete":"2026-10-06T03:59:33.372Z"} |
| stringify-boxed/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): stringify-boxed/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:59:33.375Z","complete":"2026-10-06T03:59:42.341Z"} |
| stringify-boxed/local-reference/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/local-reference/1/after.json | {"start":"2026-10-06T03:59:42.345Z","judgeStart":"2026-10-06T03:59:43.561Z","judgeEnd":"2026-10-06T03:59:43.601Z","complete":"2026-10-06T03:59:43.607Z"} |
| stringify-boxed/native-codex/1 | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903/03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/before.json / [bundle](source-artifacts.json.gz): stringify-boxed/native-codex/1/after.json | {"start":"2026-10-06T03:59:43.612Z","judgeStart":"2026-10-06T03:59:44.899Z","judgeEnd":"2026-10-06T03:59:44.943Z","complete":"2026-10-06T03:59:44.948Z"} |
| queue-clear/rifty/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:59:44.952Z","complete":"2026-10-06T03:59:48.547Z"} |
| queue-clear/rifty-no-coi/1 | unobserved/unobserved | [bundle](source-artifacts.json.gz): queue-clear/rifty-no-coi/1/trace.json | unavailable / unavailable | {"start":"2026-10-06T03:59:48.557Z","complete":"2026-10-06T03:59:50.499Z"} |
| queue-clear/local-reference/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/local-reference/1/after.json | {"start":"2026-10-06T03:59:50.504Z","judgeStart":"2026-10-06T04:00:10.537Z","judgeEnd":"2026-10-06T04:00:12.123Z","complete":"2026-10-06T04:00:12.131Z"} |
| queue-clear/native-codex/1 | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c/352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/before.json / [bundle](source-artifacts.json.gz): queue-clear/native-codex/1/after.json | {"start":"2026-10-06T04:00:12.136Z","judgeStart":"2026-10-06T04:00:27.677Z","judgeEnd":"2026-10-06T04:00:29.251Z","complete":"2026-10-06T04:00:29.257Z"} |
| csv-workflow-v3/rifty/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty/1/after.json | {"start":"2026-10-06T04:00:29.261Z","judgeStart":"2026-10-06T04:00:37.320Z","judgeEnd":"2026-10-06T04:00:45.505Z","complete":"2026-10-06T04:00:45.586Z"} |
| csv-workflow-v3/rifty-no-coi/1 | 830a9a7524afee09fe87d0f92d4aa7ac0eeb4cec26ece42044e7a11d8b7013b5/7d4165cc2fecc6992ff6c4711ca012ceb961af4c929f15fa0fc4afade4685457 | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/rifty-no-coi/1/after.json | {"start":"2026-10-06T04:00:45.593Z","judgeStart":"2026-10-06T04:00:50.767Z","judgeEnd":"2026-10-06T04:00:58.411Z","complete":"2026-10-06T04:00:58.428Z"} |
| csv-workflow-v3/local-reference/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/local-reference/1/after.json | {"start":"2026-10-06T04:00:58.432Z","judgeStart":"2026-10-06T04:01:00.806Z","judgeEnd":"2026-10-06T04:01:07.424Z","complete":"2026-10-06T04:01:07.440Z"} |
| csv-workflow-v3/native-codex/1 | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960/b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/before.json / [bundle](source-artifacts.json.gz): csv-workflow-v3/native-codex/1/after.json | {"start":"2026-10-06T04:01:07.445Z","judgeStart":"2026-10-06T04:01:09.835Z","judgeEnd":"2026-10-06T04:01:16.441Z","complete":"2026-10-06T04:01:16.459Z"} |
| markdown-notes-v3/rifty/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty/1/after.json | {"start":"2026-10-06T04:01:16.463Z","judgeStart":"2026-10-06T04:01:22.333Z","judgeEnd":"2026-10-06T04:01:23.485Z","complete":"2026-10-06T04:01:23.555Z"} |
| markdown-notes-v3/rifty-no-coi/1 | 79d897203a267964ba71c2c54faaea62495b084efeb6d550e768c2f30f18f6ca/718053347e613cd3bac6049565cd53b5f41c4195efff2d3dd4cbda93b037bc9e | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/rifty-no-coi/1/after.json | {"start":"2026-10-06T04:01:23.560Z","judgeStart":"2026-10-06T04:01:26.237Z","judgeEnd":"2026-10-06T04:01:27.081Z","complete":"2026-10-06T04:01:27.091Z"} |
| markdown-notes-v3/local-reference/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/local-reference/1/after.json | {"start":"2026-10-06T04:01:27.101Z","judgeStart":"2026-10-06T04:01:28.922Z","judgeEnd":"2026-10-06T04:01:29.512Z","complete":"2026-10-06T04:01:29.524Z"} |
| markdown-notes-v3/native-codex/1 | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4/342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/before.json / [bundle](source-artifacts.json.gz): markdown-notes-v3/native-codex/1/after.json | {"start":"2026-10-06T04:01:29.528Z","judgeStart":"2026-10-06T04:01:31.651Z","judgeEnd":"2026-10-06T04:01:32.237Z","complete":"2026-10-06T04:01:32.255Z"} |
| booking-workflow/rifty/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow/rifty/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow/rifty/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow/rifty/1/after.json | {"start":"2026-10-06T04:01:32.260Z","judgeStart":"2026-10-06T04:01:43.753Z","judgeEnd":"2026-10-06T04:01:51.878Z","complete":"2026-10-06T04:01:52.186Z"} |
| booking-workflow/rifty-no-coi/1 | 234f60795ccc77958c82b07ff632a012ba8160dc39a10cba3d8c50221c3bb220/bf4e8d951e4f0437a82b59879fe38c1549633195648fc2712f982fc1f1181b65 | [bundle](source-artifacts.json.gz): booking-workflow/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow/rifty-no-coi/1/after.json | {"start":"2026-10-06T04:01:52.191Z","judgeStart":"2026-10-06T04:01:54.835Z","judgeEnd":"2026-10-06T04:02:01.990Z","complete":"2026-10-06T04:02:02.107Z"} |
| booking-workflow/local-reference/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow/local-reference/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow/local-reference/1/after.json | {"start":"2026-10-06T04:02:02.112Z","judgeStart":"2026-10-06T04:02:04.754Z","judgeEnd":"2026-10-06T04:02:08.524Z","complete":"2026-10-06T04:02:08.601Z"} |
| booking-workflow/native-codex/1 | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf/cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | [bundle](source-artifacts.json.gz): booking-workflow/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): booking-workflow/native-codex/1/before.json / [bundle](source-artifacts.json.gz): booking-workflow/native-codex/1/after.json | {"start":"2026-10-06T04:02:08.606Z","judgeStart":"2026-10-06T04:02:11.198Z","judgeEnd":"2026-10-06T04:02:14.950Z","complete":"2026-10-06T04:02:15.023Z"} |
| expense-settlement/rifty/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement/rifty/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement/rifty/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement/rifty/1/after.json | {"start":"2026-10-06T04:02:15.029Z","judgeStart":"2026-10-06T04:02:21.811Z","judgeEnd":"2026-10-06T04:02:24.206Z","complete":"2026-10-06T04:02:24.255Z"} |
| expense-settlement/rifty-no-coi/1 | 1ebbdb81e4c81c3fa63945f57644b4a56d476f20ae3a0329e1a7249474cfe396/11416467f3aa369ab3f34f91b1bbd102c9ca7233d2879aa506c6a32bd2760af5 | [bundle](source-artifacts.json.gz): expense-settlement/rifty-no-coi/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement/rifty-no-coi/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement/rifty-no-coi/1/after.json | {"start":"2026-10-06T04:02:24.264Z","judgeStart":"2026-10-06T04:02:26.815Z","judgeEnd":"2026-10-06T04:02:33.039Z","complete":"2026-10-06T04:02:33.112Z"} |
| expense-settlement/local-reference/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement/local-reference/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement/local-reference/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement/local-reference/1/after.json | {"start":"2026-10-06T04:02:33.118Z","judgeStart":"2026-10-06T04:02:36.336Z","judgeEnd":"2026-10-06T04:02:40.856Z","complete":"2026-10-06T04:02:40.924Z"} |
| expense-settlement/native-codex/1 | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa/6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | [bundle](source-artifacts.json.gz): expense-settlement/native-codex/1/trace.json | [bundle](source-artifacts.json.gz): expense-settlement/native-codex/1/before.json / [bundle](source-artifacts.json.gz): expense-settlement/native-codex/1/after.json | {"start":"2026-10-06T04:02:40.931Z","judgeStart":"2026-10-06T04:02:43.865Z","judgeEnd":"2026-10-06T04:02:48.399Z","complete":"2026-10-06T04:02:48.468Z"} |

## Fixed-matrix outcomes

Purpose: controls; selected 32; retained 32; missing 0.
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
| ms-negative | calibration/bug | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-negative | calibration/bug | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"setup":1} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | rifty | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | rifty | 0/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {"functional":1} | 0/0 |
| expense-settlement | evaluation/app | rifty-no-coi | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | local-reference | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | native-codex | 1/1 | 0 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty-no-coi | 2/1 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | local-reference | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | local-reference | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | native-codex | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | local-reference | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | native-codex | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/6 | 3/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/6 | 4/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | local-reference | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/6 | 6/6 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | native-codex | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 6/6 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 2/2 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 1/1 | 0/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 1/1 | 1/1 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 3/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 4/4 | 0 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 4/4 | 0 | unavailable | [0.000, 1.000] | separate reference | unavailable |
