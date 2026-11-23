# Agent benchmark comparison

Baseline artifacts: /tmp/piup/classified/base-0851
Current artifacts: /tmp/piup/classified/new-160

Before: {"purpose":"quality","createdAt":"2026-11-23T02:23:08.231Z","sourceRevision":"11b9397eee2e8d820c7e2215d5c3e126eaed5348","sourceDirty":false,"versions":{"node":"v24.16.0","piCli":"0.85.1","chromium":"148.0.7778.96"},"model":"gpt-6-luna","profile":"pi-0.85.1+rifty-adapter-v2","taskSet":"core-v1","endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10530/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"toolContextCaveat":"Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.","unsupported":["rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained"],"plan":{"version":1,"sourceRevision":"11b9397eee2e8d820c7e2215d5c3e126eaed5348","sourceDirty":false,"sourceDiffSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","config":{"endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10530/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"playgroundPort":5397},"order":"task-lane-trial","tasks":[{"id":"ms-negative","group":"bug","family":"ms","split":"calibration","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"f7ddcbbd828dfd2c13204b7f5f3440b71875a00e848608e56b9263b0a96604ad","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"e1fd8980add1e9d8e0ec02b4b996ed6ad4453973d2d407b87356562b1dff0796","partial":"9b6cbfd6f43be484c60ba600bf9fd19b73b8f8c9a4ed4c0d41a0747b20646a69","alternative":"fe9e179109b9895b91a879538c26b6f922acdb3e2ae21a46aef97c8e789df094"},"filesSha256":"7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da","lockfileSha256":"1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7","promptSha256":"b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba","judgeSha256":"3252875382654db87f3915d7c1102fe09a074d04c08d9aec167fc3d2305443f3"},{"id":"ms-weeks","group":"feature","family":"ms","split":"calibration","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"a6b456be5de2a1c0f6c34e7d2c34489c40a6bccd779571570724581b8a78c20f","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"a7cf8e883bf7f62d1a6c155c7a56abb49f78a2db075c1647c99454b6cb14c59a","partial":"c13c2c0b25421321507519d52c6af8602fdb7fdfe07d64a6fe973ce242a7e12a","alternative":"27a85d56a7016de454817963f97b33d54872820d7df98ce7352b3f1892db5b5a"},"filesSha256":"909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44","lockfileSha256":"bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac","promptSha256":"aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6","judgeSha256":"a2fb309b18f2dacf7b628ec646207096bd01ef716138ee3062d20924d955d7ab"},{"id":"stringify-boxed","group":"bug","family":"stable-serialization","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"9a793be7fcc48af944f98df532430226dda64d2655615aec5e23ebb8fe192d49","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"f355603299e00f381198522480802864f9ca46cb2c18d85cd485d57373ee1b85","partial":"5e93af179f665b83a8e8dad690f5b3bcdd355154c199199ef66305402af354cb","alternative":"978eaf69c060f4f95a7447ccb0d0695e0186cbe065f8cbe3cc20de613cb215bc"},"filesSha256":"21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903","lockfileSha256":"03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8","promptSha256":"55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712","judgeSha256":"a62e148e3682348457c954b9d2db25f6de001fa78ec4c711fc47f901541930dc"},{"id":"queue-clear","group":"feature","family":"async-concurrency","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"d47b3edec0e00e065ac20be979cd3c6ced88b89812d28fe40f1cfa9e1e731e88","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"1c949e6835bdf66d2c30c2fa7dcbf17dd9b7d1fbfdc99de0619b8dc63e55dad3","partial":"46a2da1f8ac9a19249d6132cc000e56f628cdc5dd381f781fb8bb39a37e249aa","alternative":"8b0b1e225b3bfd67c676255c06f4d998859c40acd747574f434c04b827c43ed5"},"filesSha256":"4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c","lockfileSha256":"352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15","promptSha256":"fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5","judgeSha256":"bd65bae742c878917b9eb9998992364b07a4f6eed9655f60de2ed1c72535183d"},{"id":"csv-workflow-v5","group":"app","family":"contact-import","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"4c59acd6c45e7bf0e5b8b7ec752a126983cb077c725b48e2c5261955e8d38dcf","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"8df0996495ca2685256e619145146cce8b9f7d00c9935242c0d07adf1c9ed7f0","partial":"fbc4d4cf6357a65cb69b9a01c642c8a6c358457e1cd0794c4089b313b4c3ff56","alternative":"eeb0a20b54b65152de39edbafb80dac51b50ef6fc74822287065b2aca0322dec"},"filesSha256":"890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960","lockfileSha256":"b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1","promptSha256":"16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb","judgeSha256":"fc116cc2672a8874fb33f5bd8f97dafce611f2bf19e871c356c6c5b59a704959"},{"id":"markdown-notes-v4","group":"app","family":"linked-knowledge","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"9209626596bd67403689c1e71c52748ebd9e11ed3cb2ef797f2d3417039a51de","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"7d8b1489d11bec9cef95e428fff721a435ad2d1654d244d4c01e8fe9a64e6fa2","partial":"4826f4cfea8d030a14799da8d1efca44208f25c06e3be040652b2cfb38efbfa8","alternative":"b26e50b81d78a4cd21c42a8c3a9a0e7c1437bd82dba9bae728fafe7a7961cec9"},"filesSha256":"eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4","lockfileSha256":"342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4","promptSha256":"c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d","judgeSha256":"ed3d4c93741cb116b8e919aaf2d75c68b9ecae9c55fc10fc4e1e053e4325dbbe"}],"trials":[{"task":"ms-negative","lane":"rifty","runIndex":1},{"task":"ms-negative","lane":"rifty","runIndex":2},{"task":"ms-negative","lane":"rifty","runIndex":3},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":1},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":2},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":3},{"task":"ms-negative","lane":"local-reference","runIndex":1},{"task":"ms-negative","lane":"local-reference","runIndex":2},{"task":"ms-negative","lane":"local-reference","runIndex":3},{"task":"ms-negative","lane":"native-codex","runIndex":1},{"task":"ms-negative","lane":"native-codex","runIndex":2},{"task":"ms-negative","lane":"native-codex","runIndex":3},{"task":"ms-weeks","lane":"rifty","runIndex":1},{"task":"ms-weeks","lane":"rifty","runIndex":2},{"task":"ms-weeks","lane":"rifty","runIndex":3},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":1},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":2},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":3},{"task":"ms-weeks","lane":"local-reference","runIndex":1},{"task":"ms-weeks","lane":"local-reference","runIndex":2},{"task":"ms-weeks","lane":"local-reference","runIndex":3},{"task":"ms-weeks","lane":"native-codex","runIndex":1},{"task":"ms-weeks","lane":"native-codex","runIndex":2},{"task":"ms-weeks","lane":"native-codex","runIndex":3},{"task":"stringify-boxed","lane":"rifty","runIndex":1},{"task":"stringify-boxed","lane":"rifty","runIndex":2},{"task":"stringify-boxed","lane":"rifty","runIndex":3},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":1},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":2},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":3},{"task":"stringify-boxed","lane":"local-reference","runIndex":1},{"task":"stringify-boxed","lane":"local-reference","runIndex":2},{"task":"stringify-boxed","lane":"local-reference","runIndex":3},{"task":"stringify-boxed","lane":"native-codex","runIndex":1},{"task":"stringify-boxed","lane":"native-codex","runIndex":2},{"task":"stringify-boxed","lane":"native-codex","runIndex":3},{"task":"queue-clear","lane":"rifty","runIndex":1},{"task":"queue-clear","lane":"rifty","runIndex":2},{"task":"queue-clear","lane":"rifty","runIndex":3},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":1},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":2},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":3},{"task":"queue-clear","lane":"local-reference","runIndex":1},{"task":"queue-clear","lane":"local-reference","runIndex":2},{"task":"queue-clear","lane":"local-reference","runIndex":3},{"task":"queue-clear","lane":"native-codex","runIndex":1},{"task":"queue-clear","lane":"native-codex","runIndex":2},{"task":"queue-clear","lane":"native-codex","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":3},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":1},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":2},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":3},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":1},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":2},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":3},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":1},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":2},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":3},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":1},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":2},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":3}]},"series":{"status":"completed","trials":[{"task":"ms-negative","lane":"rifty","runIndex":1},{"task":"ms-negative","lane":"rifty","runIndex":2},{"task":"ms-negative","lane":"rifty","runIndex":3},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":1},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":2},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":3},{"task":"ms-negative","lane":"local-reference","runIndex":1},{"task":"ms-negative","lane":"local-reference","runIndex":2},{"task":"ms-negative","lane":"local-reference","runIndex":3},{"task":"ms-negative","lane":"native-codex","runIndex":1},{"task":"ms-negative","lane":"native-codex","runIndex":2},{"task":"ms-negative","lane":"native-codex","runIndex":3},{"task":"ms-weeks","lane":"rifty","runIndex":1},{"task":"ms-weeks","lane":"rifty","runIndex":2},{"task":"ms-weeks","lane":"rifty","runIndex":3},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":1},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":2},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":3},{"task":"ms-weeks","lane":"local-reference","runIndex":1},{"task":"ms-weeks","lane":"local-reference","runIndex":2},{"task":"ms-weeks","lane":"local-reference","runIndex":3},{"task":"ms-weeks","lane":"native-codex","runIndex":1},{"task":"ms-weeks","lane":"native-codex","runIndex":2},{"task":"ms-weeks","lane":"native-codex","runIndex":3},{"task":"stringify-boxed","lane":"rifty","runIndex":1},{"task":"stringify-boxed","lane":"rifty","runIndex":2},{"task":"stringify-boxed","lane":"rifty","runIndex":3},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":1},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":2},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":3},{"task":"stringify-boxed","lane":"local-reference","runIndex":1},{"task":"stringify-boxed","lane":"local-reference","runIndex":2},{"task":"stringify-boxed","lane":"local-reference","runIndex":3},{"task":"stringify-boxed","lane":"native-codex","runIndex":1},{"task":"stringify-boxed","lane":"native-codex","runIndex":2},{"task":"stringify-boxed","lane":"native-codex","runIndex":3},{"task":"queue-clear","lane":"rifty","runIndex":1},{"task":"queue-clear","lane":"rifty","runIndex":2},{"task":"queue-clear","lane":"rifty","runIndex":3},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":1},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":2},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":3},{"task":"queue-clear","lane":"local-reference","runIndex":1},{"task":"queue-clear","lane":"local-reference","runIndex":2},{"task":"queue-clear","lane":"local-reference","runIndex":3},{"task":"queue-clear","lane":"native-codex","runIndex":1},{"task":"queue-clear","lane":"native-codex","runIndex":2},{"task":"queue-clear","lane":"native-codex","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":3},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":1},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":2},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":3},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":1},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":2},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":3},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":1},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":2},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":3},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":1},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":2},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":3}],"finishedAt":"2026-11-23T03:28:33.053Z"}}
After: {"purpose":"quality","createdAt":"2026-11-23T04:02:41.282Z","sourceRevision":"b44365353b66ea4403c2b9379c71d066c159c5c4","sourceDirty":false,"versions":{"node":"v24.16.0","piCli":"1.6.0","chromium":"148.0.7778.96"},"model":"gpt-6-luna","profile":"pi-1.6.0+rifty-adapter-v2","taskSet":"core-v1","endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10530/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"toolContextCaveat":"Tool/context non-equivalence: shared model, Pi version and common policy do not isolate an environment-only effect. Native CLI has read/bash/edit/write and native shell; browser hosts expose their real capabilities. Full provider prompts/tool schemas are retained for Pi runs. Native Codex JSONL does not expose its assembled prompt/tool schema; that context remains unobserved.","unsupported":["rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained"],"plan":{"version":1,"sourceRevision":"b44365353b66ea4403c2b9379c71d066c159c5c4","sourceDirty":false,"sourceDiffSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","config":{"endpoint":{"id":"gpt-6-luna","name":"GPT-6 Luna","provider":"codex-proxy","api":"openai-completions","baseUrl":"http://127.0.0.1:10530/v1","input":["text"],"contextWindow":1000000,"maxTokens":8192,"reasoning":true,"thinking":"medium","compat":{"supportsReasoningEffort":true},"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},"limits":{"maxToolCalls":40,"runTimeoutMs":600000},"runsPerTask":3,"playgroundPort":5397},"order":"task-lane-trial","tasks":[{"id":"ms-negative","group":"bug","family":"ms","split":"calibration","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"f7ddcbbd828dfd2c13204b7f5f3440b71875a00e848608e56b9263b0a96604ad","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"e1fd8980add1e9d8e0ec02b4b996ed6ad4453973d2d407b87356562b1dff0796","partial":"9b6cbfd6f43be484c60ba600bf9fd19b73b8f8c9a4ed4c0d41a0747b20646a69","alternative":"fe9e179109b9895b91a879538c26b6f922acdb3e2ae21a46aef97c8e789df094"},"filesSha256":"7145b19c46360105f5a8d14532de6ecc84922d2087d61b7a8cb07b8d8aba87da","lockfileSha256":"1e46dd699351e40e4f46fdc7cefb1508673721b56c8a4f932cce8ed9ed60b1b7","promptSha256":"b0fd9780f5bb3114e7c6ba69601b01e8773c2da4232abae556032c0fb551d5ba","judgeSha256":"3252875382654db87f3915d7c1102fe09a074d04c08d9aec167fc3d2305443f3"},{"id":"ms-weeks","group":"feature","family":"ms","split":"calibration","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"a6b456be5de2a1c0f6c34e7d2c34489c40a6bccd779571570724581b8a78c20f","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"a7cf8e883bf7f62d1a6c155c7a56abb49f78a2db075c1647c99454b6cb14c59a","partial":"c13c2c0b25421321507519d52c6af8602fdb7fdfe07d64a6fe973ce242a7e12a","alternative":"27a85d56a7016de454817963f97b33d54872820d7df98ce7352b3f1892db5b5a"},"filesSha256":"909fd4a91b0db71384b2e56dd1c26f98bbfcef855c106c1ebf824ed244850e44","lockfileSha256":"bfc2830bde76401aa9ca9ff96e16cd901fa171c3a7b89f26a1adff98561456ac","promptSha256":"aefef6a4cd710624706ba90c00bab18717cd9d3b9ec1df0a93b578b4fc239af6","judgeSha256":"a2fb309b18f2dacf7b628ec646207096bd01ef716138ee3062d20924d955d7ab"},{"id":"stringify-boxed","group":"bug","family":"stable-serialization","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"9a793be7fcc48af944f98df532430226dda64d2655615aec5e23ebb8fe192d49","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"f355603299e00f381198522480802864f9ca46cb2c18d85cd485d57373ee1b85","partial":"5e93af179f665b83a8e8dad690f5b3bcdd355154c199199ef66305402af354cb","alternative":"978eaf69c060f4f95a7447ccb0d0695e0186cbe065f8cbe3cc20de613cb215bc"},"filesSha256":"21d708e67a8d74d4a4d3dc591feff89cc2bcf389e3348b7ea8db798651672903","lockfileSha256":"03463d2a82f5d04813fa72014df5441a87e07d783b81b712e05152065c4c64e8","promptSha256":"55568d62ef8234a2736cf2405ed28d5b2aa05c9524e75a313734c6dc228cc712","judgeSha256":"a62e148e3682348457c954b9d2db25f6de001fa78ec4c711fc47f901541930dc"},{"id":"queue-clear","group":"feature","family":"async-concurrency","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"d47b3edec0e00e065ac20be979cd3c6ced88b89812d28fe40f1cfa9e1e731e88","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"1c949e6835bdf66d2c30c2fa7dcbf17dd9b7d1fbfdc99de0619b8dc63e55dad3","partial":"46a2da1f8ac9a19249d6132cc000e56f628cdc5dd381f781fb8bb39a37e249aa","alternative":"8b0b1e225b3bfd67c676255c06f4d998859c40acd747574f434c04b827c43ed5"},"filesSha256":"4cb7bac3a2f981f366def342410a33ef48a1aaec232f9ee758a99c9a73c1cf7c","lockfileSha256":"352e318973cfea471c56575d2081d90ccec8d93d719379a000d7b54b94c3de15","promptSha256":"fc43f7d3d9ccb5b86eff5f23d4809b09ade8636883bc39105bd5b165133b3db5","judgeSha256":"bd65bae742c878917b9eb9998992364b07a4f6eed9655f60de2ed1c72535183d"},{"id":"csv-workflow-v5","group":"app","family":"contact-import","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"4c59acd6c45e7bf0e5b8b7ec752a126983cb077c725b48e2c5261955e8d38dcf","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"8df0996495ca2685256e619145146cce8b9f7d00c9935242c0d07adf1c9ed7f0","partial":"fbc4d4cf6357a65cb69b9a01c642c8a6c358457e1cd0794c4089b313b4c3ff56","alternative":"eeb0a20b54b65152de39edbafb80dac51b50ef6fc74822287065b2aca0322dec"},"filesSha256":"890e0b46d7b605dad08257fb019c01bc309eed0a32751f48455d1f260dcac960","lockfileSha256":"b887c85b31ddd34ee923298490070079dc6904b8815380666d1b1f712f63b0a1","promptSha256":"16a570010f8489cbe18e908d586054251f46c54cea29fd1cf68039d7532500fb","judgeSha256":"fc116cc2672a8874fb33f5bd8f97dafce611f2bf19e871c356c6c5b59a704959"},{"id":"markdown-notes-v4","group":"app","family":"linked-knowledge","split":"evaluation","corpus":"core-v1","corpusManifestSha256":"0b3f4b8cf80c83da65b856ef3406e489184012edf4d246c4c25fb748891f41bd","caseCardSha256":"9209626596bd67403689c1e71c52748ebd9e11ed3cb2ef797f2d3417039a51de","controlsSha256":{"baseline":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reference":"7d8b1489d11bec9cef95e428fff721a435ad2d1654d244d4c01e8fe9a64e6fa2","partial":"4826f4cfea8d030a14799da8d1efca44208f25c06e3be040652b2cfb38efbfa8","alternative":"b26e50b81d78a4cd21c42a8c3a9a0e7c1437bd82dba9bae728fafe7a7961cec9"},"filesSha256":"eec456b0757780a758868b2f3adff37362c27f856cae56169a469d636a5d65a4","lockfileSha256":"342412adeb6b33ec3a754f53b1f70168b37ce9af9387bb8b82121bf282293bf4","promptSha256":"c7df4371922905c13e1456f3b67a2ec1983e66c073bb66600e3f4fe4c687783d","judgeSha256":"ed3d4c93741cb116b8e919aaf2d75c68b9ecae9c55fc10fc4e1e053e4325dbbe"}],"trials":[{"task":"ms-negative","lane":"rifty","runIndex":1},{"task":"ms-negative","lane":"rifty","runIndex":2},{"task":"ms-negative","lane":"rifty","runIndex":3},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":1},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":2},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":3},{"task":"ms-negative","lane":"local-reference","runIndex":1},{"task":"ms-negative","lane":"local-reference","runIndex":2},{"task":"ms-negative","lane":"local-reference","runIndex":3},{"task":"ms-negative","lane":"native-codex","runIndex":1},{"task":"ms-negative","lane":"native-codex","runIndex":2},{"task":"ms-negative","lane":"native-codex","runIndex":3},{"task":"ms-weeks","lane":"rifty","runIndex":1},{"task":"ms-weeks","lane":"rifty","runIndex":2},{"task":"ms-weeks","lane":"rifty","runIndex":3},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":1},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":2},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":3},{"task":"ms-weeks","lane":"local-reference","runIndex":1},{"task":"ms-weeks","lane":"local-reference","runIndex":2},{"task":"ms-weeks","lane":"local-reference","runIndex":3},{"task":"ms-weeks","lane":"native-codex","runIndex":1},{"task":"ms-weeks","lane":"native-codex","runIndex":2},{"task":"ms-weeks","lane":"native-codex","runIndex":3},{"task":"stringify-boxed","lane":"rifty","runIndex":1},{"task":"stringify-boxed","lane":"rifty","runIndex":2},{"task":"stringify-boxed","lane":"rifty","runIndex":3},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":1},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":2},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":3},{"task":"stringify-boxed","lane":"local-reference","runIndex":1},{"task":"stringify-boxed","lane":"local-reference","runIndex":2},{"task":"stringify-boxed","lane":"local-reference","runIndex":3},{"task":"stringify-boxed","lane":"native-codex","runIndex":1},{"task":"stringify-boxed","lane":"native-codex","runIndex":2},{"task":"stringify-boxed","lane":"native-codex","runIndex":3},{"task":"queue-clear","lane":"rifty","runIndex":1},{"task":"queue-clear","lane":"rifty","runIndex":2},{"task":"queue-clear","lane":"rifty","runIndex":3},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":1},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":2},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":3},{"task":"queue-clear","lane":"local-reference","runIndex":1},{"task":"queue-clear","lane":"local-reference","runIndex":2},{"task":"queue-clear","lane":"local-reference","runIndex":3},{"task":"queue-clear","lane":"native-codex","runIndex":1},{"task":"queue-clear","lane":"native-codex","runIndex":2},{"task":"queue-clear","lane":"native-codex","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":3},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":1},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":2},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":3},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":1},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":2},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":3},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":1},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":2},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":3},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":1},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":2},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":3}]},"series":{"status":"completed","trials":[{"task":"ms-negative","lane":"rifty","runIndex":1},{"task":"ms-negative","lane":"rifty","runIndex":2},{"task":"ms-negative","lane":"rifty","runIndex":3},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":1},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":2},{"task":"ms-negative","lane":"rifty-no-coi","runIndex":3},{"task":"ms-negative","lane":"local-reference","runIndex":1},{"task":"ms-negative","lane":"local-reference","runIndex":2},{"task":"ms-negative","lane":"local-reference","runIndex":3},{"task":"ms-negative","lane":"native-codex","runIndex":1},{"task":"ms-negative","lane":"native-codex","runIndex":2},{"task":"ms-negative","lane":"native-codex","runIndex":3},{"task":"ms-weeks","lane":"rifty","runIndex":1},{"task":"ms-weeks","lane":"rifty","runIndex":2},{"task":"ms-weeks","lane":"rifty","runIndex":3},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":1},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":2},{"task":"ms-weeks","lane":"rifty-no-coi","runIndex":3},{"task":"ms-weeks","lane":"local-reference","runIndex":1},{"task":"ms-weeks","lane":"local-reference","runIndex":2},{"task":"ms-weeks","lane":"local-reference","runIndex":3},{"task":"ms-weeks","lane":"native-codex","runIndex":1},{"task":"ms-weeks","lane":"native-codex","runIndex":2},{"task":"ms-weeks","lane":"native-codex","runIndex":3},{"task":"stringify-boxed","lane":"rifty","runIndex":1},{"task":"stringify-boxed","lane":"rifty","runIndex":2},{"task":"stringify-boxed","lane":"rifty","runIndex":3},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":1},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":2},{"task":"stringify-boxed","lane":"rifty-no-coi","runIndex":3},{"task":"stringify-boxed","lane":"local-reference","runIndex":1},{"task":"stringify-boxed","lane":"local-reference","runIndex":2},{"task":"stringify-boxed","lane":"local-reference","runIndex":3},{"task":"stringify-boxed","lane":"native-codex","runIndex":1},{"task":"stringify-boxed","lane":"native-codex","runIndex":2},{"task":"stringify-boxed","lane":"native-codex","runIndex":3},{"task":"queue-clear","lane":"rifty","runIndex":1},{"task":"queue-clear","lane":"rifty","runIndex":2},{"task":"queue-clear","lane":"rifty","runIndex":3},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":1},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":2},{"task":"queue-clear","lane":"rifty-no-coi","runIndex":3},{"task":"queue-clear","lane":"local-reference","runIndex":1},{"task":"queue-clear","lane":"local-reference","runIndex":2},{"task":"queue-clear","lane":"local-reference","runIndex":3},{"task":"queue-clear","lane":"native-codex","runIndex":1},{"task":"queue-clear","lane":"native-codex","runIndex":2},{"task":"queue-clear","lane":"native-codex","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty","runIndex":3},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":1},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":2},{"task":"csv-workflow-v5","lane":"rifty-no-coi","runIndex":3},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":1},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":2},{"task":"csv-workflow-v5","lane":"local-reference","runIndex":3},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":1},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":2},{"task":"csv-workflow-v5","lane":"native-codex","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty","runIndex":3},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":1},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":2},{"task":"markdown-notes-v4","lane":"rifty-no-coi","runIndex":3},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":1},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":2},{"task":"markdown-notes-v4","lane":"local-reference","runIndex":3},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":1},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":2},{"task":"markdown-notes-v4","lane":"native-codex","runIndex":3}],"finishedAt":"2026-11-23T05:03:49.185Z"}}

Delta = after − before. ±1 pass on 3 runs is within noise; negative remains a regression.

## ms-negative / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 20.652 | 20.68 | 0.027999999999998693 |
| medianTools | 7 | 7 | 0 |
| inputTokens | 59790 | 75917 | 16127 |
| outputTokens | 1951 | 2558 | 607 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-negative / rifty-no-coi

No regression (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 3 | 1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 19.759 | 20.159 | 0.3999999999999986 |
| medianTools | 8 | 7 | -1 |
| inputTokens | 70521 | 65309 | -5212 |
| outputTokens | 1665 | 1974 | 309 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 1 | 0 | -1 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-negative / local-reference

REGRESSION (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 2 | -1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 22.521 | 17.651 | -4.870000000000001 |
| medianTools | 7 | 7 | 0 |
| inputTokens | 52773 | 54477 | 1704 |
| outputTokens | 1913 | 1674 | -239 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-negative / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-weeks / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 2 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 41.551 | 34.894 | -6.657000000000004 |
| medianTools | 13 | 12 | -1 |
| inputTokens | 137582 | 112320 | -25262 |
| outputTokens | 3005 | 2849 | -156 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 1 | 3 | 2 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-weeks / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 1 | 1 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 26.721 | 28.568 | 1.8470000000000013 |
| medianTools | 12 | 12 | 0 |
| inputTokens | 118284 | 134504 | 16220 |
| outputTokens | 2764 | 3039 | 275 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 1 | 1 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-weeks / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 19.831 | 24.087 | 4.256 |
| medianTools | 7 | 9 | 2 |
| inputTokens | 53317 | 74197 | 20880 |
| outputTokens | 1976 | 1968 | -8 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## ms-weeks / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## stringify-boxed / rifty

REGRESSION (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 2 | -1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 24.789 | 25.862 | 1.0729999999999968 |
| medianTools | 9 | 7 | -2 |
| inputTokens | 52520 | 34461 | -18059 |
| outputTokens | 2751 | 1409 | -1342 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 2 | 0 | -2 |
| malformedToolCalls | 0 | 0 | 0 |

## stringify-boxed / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 33.021 | 26.163 | -6.8580000000000005 |
| medianTools | 9 | 9 | 0 |
| inputTokens | 76150 | 62626 | -13524 |
| outputTokens | 3615 | 2806 | -809 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 2 | 2 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## stringify-boxed / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 32.566 | 24.539 | -8.027000000000001 |
| medianTools | 11 | 7 | -4 |
| inputTokens | 125002 | 59275 | -65727 |
| outputTokens | 3166 | 2015 | -1151 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 2 | 0 | -2 |
| malformedToolCalls | 0 | 0 | 0 |

## stringify-boxed / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## queue-clear / rifty

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 51.16 | 91.469 | 40.309 |
| medianTools | 17 | 20 | 3 |
| inputTokens | 238006 | 219376 | -18630 |
| outputTokens | 6031 | 4560 | -1471 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 5 | 3 | -2 |
| malformedToolCalls | 0 | 0 | 0 |

## queue-clear / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 74.827 | 59.085 | -15.741999999999997 |
| medianTools | 19 | 15 | -4 |
| inputTokens | 348391 | 198001 | -150390 |
| outputTokens | 8823 | 6690 | -2133 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 4 | 4 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## queue-clear / local-reference

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 3 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 50.553 | 52.174 | 1.6210000000000022 |
| medianTools | 12 | 12 | 0 |
| inputTokens | 118455 | 159548 | 41093 |
| outputTokens | 5178 | 5162 | -16 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 2 | 2 |
| malformedToolCalls | 0 | 0 | 0 |

## queue-clear / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## csv-workflow-v5 / rifty

REGRESSION.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 1 | -2 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 100.465 | 83.202 | -17.263000000000005 |
| medianTools | 8 | 8 | 0 |
| inputTokens | 73097 | 72370 | -727 |
| outputTokens | 14315 | 12545 | -1770 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## csv-workflow-v5 / rifty-no-coi

REGRESSION (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 2 | -1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 95.628 | 98.424 | 2.7960000000000065 |
| medianTools | 7 | 7 | 0 |
| inputTokens | 62749 | 61847 | -902 |
| outputTokens | 13194 | 13508 | 314 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## csv-workflow-v5 / local-reference

REGRESSION (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 3 | 2 | -1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 96.182 | 92.271 | -3.9110000000000014 |
| medianTools | 8 | 8 | 0 |
| inputTokens | 61226 | 133696 | 72470 |
| outputTokens | 14197 | 13165 | -1032 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## csv-workflow-v5 / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## markdown-notes-v4 / rifty

No regression (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 3 | 1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 106.877 | 70.69 | -36.187 |
| medianTools | 7 | 7 | 0 |
| inputTokens | 66833 | 47946 | -18887 |
| outputTokens | 14020 | 10794 | -3226 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## markdown-notes-v4 / rifty-no-coi

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 2 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 100.104 | 96.633 | -3.4710000000000036 |
| medianTools | 7 | 7 | 0 |
| inputTokens | 54172 | 53636 | -536 |
| outputTokens | 14392 | 13364 | -1028 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## markdown-notes-v4 / local-reference

REGRESSION (within noise).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 2 | 1 | -1 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 70.183 | 75.901 | 5.717999999999989 |
| medianTools | 9 | 6 | -3 |
| inputTokens | 55878 | 37092 | -18786 |
| outputTokens | 11876 | 10675 | -1201 |
| retries | 0 | 3 | 3 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

## markdown-notes-v4 / native-codex

No regression.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| runs | 3 | 3 | 0 |
| passes | 0 | 0 | 0 |
| budgetExceeded | 0 | 0 | 0 |
| contextExceeded | 0 | 0 | 0 |
| medianSeconds | 0 | 0 | 0 |
| medianTools | 0 | 0 | 0 |
| inputTokens | 0 | 0 | 0 |
| outputTokens | 0 | 0 | 0 |
| retries | 0 | 0 | 0 |
| compactions | 0 | 0 | 0 |
| repeatedCallNotices | 0 | 0 | 0 |
| editFailures | 0 | 0 | 0 |
| malformedToolCalls | 0 | 0 | 0 |

