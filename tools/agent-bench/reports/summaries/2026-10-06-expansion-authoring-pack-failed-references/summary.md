# Agent benchmark: gpt-6-luna

Profile: pi-0.85.1+rifty-adapter-v2; task set: eval-v1; runs/task: 1.
Limits: {"maxToolCalls":100,"runTimeoutMs":600000}.
no-COI policies: {}.
Catalog entry: {"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}.
Source: 927dba64ace86a94634892c2578b6d269933e9f5 (working tree modified); versions: {"node":"v24.16.0","piCli":"0.85.1"}.

Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.

Known constraints: rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained.

Outcomes: pass, fail, budget-exceeded, context-exceeded (separate; never counted as ordinary fail).
Failure classes are manual: agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad. Unclassified stays null.

Native Codex reference: {"model":"gpt-6.1-sol","reasoning":"low","isolation":{"ephemeral":true,"ignoreUserConfig":true,"ignoreRules":true,"projectDocMaxBytes":0},"sandbox":"workspace-write","approval":"automatic review","budgetAdmission":"observed tool-event cancellation; may overshoot"}. Separate model/context; no Pi delta.
Native Codex counters not emitted by CLI are unknown; tokens absent on incomplete turns are unknown.
Series: failed; selected 32; retained 0.
Incomplete series is partial evidence; missing work is never success.
Series error: Error: ENOENT: no such file or directory, lstat '/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-agent-bench-packed-Wnv7nl/consumer/node_modules/@riftydev/workbench/dist/assets'

| Task | Lane | Run | Outcome | Agent | Seconds | Tools | Input tokens | Output tokens | Retries | Compactions | Repeated calls | Edit failures | Malformed calls | Class | Note |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| ms-negative | rifty | 1 | missing | not started |
| ms-negative | rifty-no-coi | 1 | missing | not started |
| ms-negative | local-reference | 1 | missing | not started |
| ms-negative | native-codex | 1 | missing | not started |
| ms-weeks | rifty | 1 | missing | not started |
| ms-weeks | rifty-no-coi | 1 | missing | not started |
| ms-weeks | local-reference | 1 | missing | not started |
| ms-weeks | native-codex | 1 | missing | not started |
| stringify-boxed | rifty | 1 | missing | not started |
| stringify-boxed | rifty-no-coi | 1 | missing | not started |
| stringify-boxed | local-reference | 1 | missing | not started |
| stringify-boxed | native-codex | 1 | missing | not started |
| queue-clear | rifty | 1 | missing | not started |
| queue-clear | rifty-no-coi | 1 | missing | not started |
| queue-clear | local-reference | 1 | missing | not started |
| queue-clear | native-codex | 1 | missing | not started |
| csv-workflow-v3 | rifty | 1 | missing | not started |
| csv-workflow-v3 | rifty-no-coi | 1 | missing | not started |
| csv-workflow-v3 | local-reference | 1 | missing | not started |
| csv-workflow-v3 | native-codex | 1 | missing | not started |
| markdown-notes-v3 | rifty | 1 | missing | not started |
| markdown-notes-v3 | rifty-no-coi | 1 | missing | not started |
| markdown-notes-v3 | local-reference | 1 | missing | not started |
| markdown-notes-v3 | native-codex | 1 | missing | not started |
| booking-workflow | rifty | 1 | missing | not started |
| booking-workflow | rifty-no-coi | 1 | missing | not started |
| booking-workflow | local-reference | 1 | missing | not started |
| booking-workflow | native-codex | 1 | missing | not started |
| expense-settlement | rifty | 1 | missing | not started |
| expense-settlement | rifty-no-coi | 1 | missing | not started |
| expense-settlement | local-reference | 1 | missing | not started |
| expense-settlement | native-codex | 1 | missing | not started |

Frozen inputs (installed before-tree hashes per attempt below):

| Case | Split/family | Input files | Lock | Prompt | Judge/support |
|---|---|---|---|---|---|
| ms-negative | calibration/ms | 7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da | 1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7 | b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba | e330261bf74e16bddac8532944f0a3158329d8cbfb9e242cb2dd622d6c3d7969 |
| ms-weeks | calibration/ms | 909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44 | bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac | aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6 | 10ca8dba21acc89ae85fca0173c1153872cd640aa02fc73f89e8f0fcc6553ab3 |
| stringify-boxed | evaluation/stable-serialization | 21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903 | 03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8 | 55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712 | 16859798ed7cbee5ee20ba2ee8e98cb41122305ce33f0ff361c2842a1e516d81 |
| queue-clear | evaluation/async-concurrency | 4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c | 352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15 | fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5 | 05b8e1271512bf2b76695d20a5bf8829b98cccac23bbcf8d76d25ecdd9aeb99e |
| csv-workflow-v3 | evaluation/contact-import | 890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960 | b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1 | 16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb | f3bc39f39b8192ffd78ebce07ff1aba012b0400ecf67cbf25206e0a2863edf62 |
| markdown-notes-v3 | evaluation/linked-knowledge | eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4 | 342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4 | c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d | c0034204f82fb377f41387737fa9d0baba12bfeb0f3825eef388395764d6219e |
| booking-workflow | evaluation/booking-constraints | 21b1d9a6d991a502fe73bb6afacc254a49ca791ac06188a296d82023ef670cbf | cd06957ac69920a59436a7b07834952a8c88fb4c2aa5407512e8d068c72f124b | 2795d993df1a8b6cf33ce6c36d904599f5e65ebc4578f6a0f1e2a448b02f27bb | f5ab42f239bdf2911ce5fd7fb71b681817d4478ba723d6066695e63b483f685a |
| expense-settlement | evaluation/expense-conservation | f067f4fecdfce3a06c4949306b6b2c50c759defb07c9ea6f2cf8326614f503fa | 6d70cd33514e7dafd48313e0c35cefae22101b471cf1ccec2f66e45a01b50e6d | 5dfed4426b8d38dc0ecda97a24414a9ebe2deba43cf1c6fd21b806429d3e6242 | cc391668922db93363ec2ee58461e40e06ab9f84e8b592eeeb633f7cfc5c6932 |

Retained attempts/artifacts; timestamps record actual phases (legacy absent = unobserved). Recorded elapsed is agent time when started, preparation time on setup failure; no campaign-wall interpretation.

| Case/lane/run | Initial files/lock | Trace | Before/after | Timing |
|---|---|---|---|---|

## Fixed-matrix outcomes

Purpose: controls; selected 32; retained 0; missing 32.
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
| ms-negative | calibration/bug | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-negative | calibration/bug | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-negative | calibration/bug | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-negative | calibration/bug | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| ms-weeks | calibration/feature | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| stringify-boxed | evaluation/bug | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| queue-clear | evaluation/feature | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| csv-workflow-v3 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| markdown-notes-v3 | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| booking-workflow | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | rifty | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | rifty-no-coi | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | local-reference | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | unavailable | unavailable | {} | 0/0 |
| expense-settlement | evaluation/app | native-codex | 0/1 | 1 | 0/0 | unavailable | [0.000, 1.000] | separate reference | unavailable | {} | 0/0 |

Task-macro by split/workload (95% simultaneous finite-cell bands; task weights equal):

| Split | Group | Lane | Tasks/families | Pass/selected | Missing | Rate | Band | Pi delta | Delta band |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| calibration | bug | rifty | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | rifty-no-coi | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | rifty-no-coi | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | rifty-no-coi | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | local-reference | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | all | local-reference | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | project-change | local-reference | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | bug | native-codex | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | all | native-codex | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | project-change | native-codex | 2/1 | 0/2 | 2 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| calibration | feature | rifty | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | rifty-no-coi | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | local-reference | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| calibration | feature | native-codex | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | bug | rifty | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty | 6/6 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty | 2/2 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | rifty-no-coi | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | rifty-no-coi | 6/6 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | rifty-no-coi | 2/2 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | local-reference | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | all | local-reference | 6/6 | 0/6 | 6 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | project-change | local-reference | 2/2 | 0/2 | 2 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | bug | native-codex | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | all | native-codex | 6/6 | 0/6 | 6 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | project-change | native-codex | 2/2 | 0/2 | 2 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | feature | rifty | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | rifty-no-coi | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | local-reference | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | feature | native-codex | 1/1 | 0/1 | 1 | unavailable | [0.000, 1.000] | separate reference | unavailable |
| evaluation | app | rifty | 4/4 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | rifty-no-coi | 4/4 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | local-reference | 4/4 | 0/4 | 4 | unavailable | [0.000, 1.000] | unavailable | unavailable |
| evaluation | app | native-codex | 4/4 | 0/4 | 4 | unavailable | [0.000, 1.000] | separate reference | unavailable |
