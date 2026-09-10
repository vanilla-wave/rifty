# Optional SQLite URL — evidence

Authority: [issue #281](https://github.com/vanilla-wave/rifty/issues/281), user
implementation handoff 2026-09-10. Entire wasm object may be omitted; no
provider without a URL; invalid supplied values rejected; configured SQLite
unchanged. Bytes API, persistence and builtin removal excluded by user.

## RED

Baseline origin/main `2c7f9bbf4`. Node/Vite host deployment API is rifty-owned;
no Node parity claim about this option. Existing real SQLite acceptance retained.

`pnpm exec vitest run packages/workbench/src/workbench/sqlite-options.test.ts packages/workbench/src/workers/node-worker-runtime-config.test.ts packages/workbench/src/glue/sqlite-wasm-provider.fault.test.ts`

2026-09-10: 7 failed, 16 passed; missing wasm rejected as non-object, omitted
sqlite rejected as non-empty, host snapshot required sqliteWasmUrl, provider
rejected undefined. Supplied whitespace also exposed missing trimming at host
metadata/provider validation. The configured real sql.js SELECT returned 42.

Full contract RED (six suites): 45 failed / 177 passed. Independent reviewer
reproduced the same split (41+4 failed / 120+57 passed), Node v24.16.0,
Vitest v2.1.9. Protocol assertions intentionally advance with ADR-0416.

`node tests/integration/workbench-packed-consumer.mjs`: real packed browser
configured Vite/SQLite and snapshot restore passed; fresh context without the
SQLite file failed `page.evaluate: TypeError: deployment.wasm must be an object`.
An earlier harness compile failure used a nonexistent public Node factory;
corrected to the existing companion before this runtime RED and checkpoint.

`pnpm test:parity sqlite`: 5/5 baseline cases match Node v24.16.0.
