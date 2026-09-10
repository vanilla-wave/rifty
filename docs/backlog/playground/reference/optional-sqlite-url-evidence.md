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

## Implementation checks

Targeted GREEN: six suites, 222/222 tests. The packed consumer now supplies
statically typed omitted wasm / empty wasm options; no reflective type escape.
Its direct sql.js dependency was removed; assets come from Workbench dist.

Judging-criteria changes: old protocol assertions move to node-entry v4 and
dev-server v2 per ADR-0416; retired v2/v3/v1 rejection remains explicit.
The copied TypeScript worker retains 10,022,664 bytes and references the newly
named shared runtime chunks; only its exact SHA-256 inventory pin changes.
Lexical compiler and WASM pins, payload-negative tests and ceilings unchanged.

First `pnpm pr:check`: type narrowing in Playground's concrete configured host,
asset fingerprint and one remaining parity-harness v3 error regex required
alignment. The host now uses `satisfies`, preserving its actual SQLite field.
Full-suite SAB race test hit its 30s real-worker lifecycle under load 21.9 on
12 CPUs; isolated rerun passed (70ms). Zero Vitest timeout classifications;
one lifecycle timeout. No production/test-budget change for that transient.


Packed fixture corrections after optional boot first succeeded: snapshot-only
cannot request even an empty install, so the Node helper consumes the existing
produced Vite snapshot with its matching manifest/template identity. A CJS
`prove().then(console.log)` attempt exited 0 without output, including after
`await command.close()`; no diagnosed product cause. Its exact historical fixture and
parent-lifetime question stay in `runtime-js/worker-threads-kernel-run-to-completion-exit.md`.
The configuration proof now explicitly awaits the Worker result in ESM, as the
existing recursive browser suite does; no keepalive/sleep workaround.


A subsequent ESM fixture wait was traced to the restored manifest's
`dev: vite --port 5173` while its node-server plan awaited port 3459. Terminal
exit/close and the full recursive SQLite result had already completed. The
fixture now updates only scripts.dev through versioned public project.files
before starting the Node server. Bounded packed-asset diagnostic then reached
port 3459, served the exact recursive proof, closed, and completed Vite startup.
Full packed acceptance is rerun separately, without diagnostic instrumentation.


## Final GREEN

Reviewed product/test tree: `ca574a4c5f5a9905b22b2b6bdbf45b894fac1034`.

- `node tests/integration/workbench-packed-consumer.mjs`: PASS; 15 first-party +
  83 external tarballs, consumer TypeScript/build, fresh Chromium. Configured
  SQLite CREATE/INSERT/SELECT and exact host asset request passed; after removing
  sql-wasm.wasm, fresh-context Node/recursive/dev-server errors, Vite build/dev/HMR,
  zero SQLite/guest-fallback/registry/Eddy requests, saved-state and scoped-preview
  journeys all passed. No diagnostic instrumentation in this run.
- `pnpm pr:check`: 25/25 PASS on final tree; test:run 200.5s, parity 61.9s;
  no isolated reruns. Prior full GREEN also retained the unchanged product baseline.
- Independent reviewer: 232/232 targeted + negative-gate tests, both exact
  TypeScript-worker hashes reproduced; normalized emitted imports alone differ.
- Production Chromium CI: SUCCESS on source-identical `0668a927b`,
  [job](https://github.com/vanilla-wave/rifty/actions/runs/34485844878/job/102899917053).
- Final+GREEN: 12/12 coverage PASS; no unit residuals. Required review records
  survive completed-contract cleanup. The separately captured CJS question is
  unresolved, outside the SQLite configuration result.
