# Agent benchmark comparison

Baseline artifacts: /Users/vanilla-wave/.t3/worktrees/rifty/t3code-ee397980/tools/agent-bench/reports/summaries/2026-09-27-gpt-6-luna-baseline
Current artifacts: /Users/vanilla-wave/.t3/worktrees/rifty/t3code-ee397980/tools/agent-bench/reports/summaries/2026-09-28-gpt-6-luna-rerun

Before: {"createdAt":"2026-09-27T19:03:08.760Z","sourceRevision":"0fab1a861b1f9bf7112d908b439ef1d1654825f3","sourceDirty":false,"versions":{"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"},"model":"gpt-6-luna","profile":"pi-0.85.1+rifty-adapter-v1","taskSet":"trackline-300+hono-v1","endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"toolContextCaveat":"Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.","unsupported":["rifty-no-coi/node-endpoint: installed-bin resident preview only"]}
After: {"createdAt":"2026-09-28T00:16:42.470Z","sourceRevision":"61605476e1217b328c8989e895c4320c6b25624a","sourceDirty":false,"versions":{"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"},"model":"gpt-6-luna","profile":"pi-0.85.1+rifty-adapter-v2","taskSet":"trackline-300+hono-v1","endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10539/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"toolContextCaveat":"Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts and tool schemas are retained per run.","unsupported":["rifty-no-coi/node-endpoint: installed-bin resident preview only"]}

Delta = after − before. ±1 pass on 3 runs is within noise; negative remains a regression.

## fix-date-sort / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 12.571 | 17.11 | 4.539 |
| medianTools | 5 | 7 | 2 |
| inputTokens | 36025 | 51058 | 15033 |
| outputTokens | 1039 | 1348 | 309 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## fix-date-sort / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 24.259 | 22.413 | -1.846 |
| medianTools | 7 | 6 | -1 |
| inputTokens | 43858 | 48320 | 4462 |
| outputTokens | 1431 | 1464 | 33 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## fix-date-sort / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 23.099 | 18.409 | -4.690000000000001 |
| medianTools | 5 | 7 | 2 |
| inputTokens | 42774 | 47709 | 4935 |
| outputTokens | 1559 | 1240 | -319 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## add-search / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 52.954 | 44.839 | -8.115000000000002 |
| medianTools | 14 | 17 | 3 |
| inputTokens | 126899 | 164255 | 37356 |
| outputTokens | 4285 | 4209 | -76 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 5 | 4 | -1 |
| malformedToolCalls | 0 | 0 | 0 |

## add-search / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 34.515 | 48.754 | 14.238999999999997 |
| medianTools | 9 | 15 | 6 |
| inputTokens | 75006 | 133285 | 58279 |
| outputTokens | 2662 | 3905 | 1243 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 2 | 4 | 2 |
| malformedToolCalls | 0 | 0 | 0 |

## add-search / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 39.091 | 26.422 | -12.669 |
| medianTools | 9 | 8 | -1 |
| inputTokens | 80504 | 82903 | 2399 |
| outputTokens | 2889 | 2573 | -316 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## url-filters / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 49.361 | 30.42 | -18.940999999999995 |
| medianTools | 11 | 11 | 0 |
| inputTokens | 106338 | 72533 | -33805 |
| outputTokens | 3291 | 2520 | -771 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## url-filters / rifty-no-coi

No regression (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 3 | 1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 33.053 | 26.486 | -6.566999999999997 |
| medianTools | 10 | 8 | -2 |
| inputTokens | 69238 | 60328 | -8910 |
| outputTokens | 2730 | 2475 | -255 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## url-filters / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 26.295 | 23.826 | -2.469000000000001 |
| medianTools | 10 | 8 | -2 |
| inputTokens | 54014 | 66646 | 12632 |
| outputTokens | 2238 | 2410 | 172 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## new-issue-form / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 64.42 | 85.91 | 21.489999999999995 |
| medianTools | 15 | 13 | -2 |
| inputTokens | 173489 | 183730 | 10241 |
| outputTokens | 5272 | 9756 | 4484 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 1 | 4 | 3 |
| malformedToolCalls | 0 | 0 | 0 |

## new-issue-form / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 68.076 | 76.376 | 8.300000000000011 |
| medianTools | 14 | 13 | -1 |
| inputTokens | 168640 | 170273 | 1633 |
| outputTokens | 7876 | 10253 | 2377 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 5 | 4 | -1 |
| malformedToolCalls | 0 | 0 | 0 |

## new-issue-form / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 53.173 | 39.145 | -14.027999999999999 |
| medianTools | 12 | 13 | 1 |
| inputTokens | 118869 | 131003 | 12134 |
| outputTokens | 6231 | 4521 | -1710 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## node-endpoint / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 15.1 | 19.731 | 4.631000000000002 |
| medianTools | 5 | 9 | 4 |
| inputTokens | 18995 | 45297 | 26302 |
| outputTokens | 1050 | 1593 | 543 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## node-endpoint / local-reference

No regression (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 3 | 1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 13.514 | 24.326 | 10.812000000000001 |
| medianTools | 5 | 6 | 1 |
| inputTokens | 19027 | 34550 | 15523 |
| outputTokens | 1072 | 2028 | 956 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

