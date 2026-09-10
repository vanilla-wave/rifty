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
