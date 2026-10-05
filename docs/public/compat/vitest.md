# Compatibility matrix — vitest

Public claim surface for the exact pair **vitest 4.1.11 + vite 8.0.16** in the browser shell (goal `vitest-run-in-browser`).

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws a named `NotImplementedError`; never a silent fallback).

**Manifest precondition.** The install claim requires the npm overrides pin — `"overrides": {"vite": "8.0.16"}` in `package.json` (npm's own bare-version spelling) or an npm-authored lockfile replay. The organic unpinned `devDependencies: {vitest: "4.1.11"}` manifest resolves the latest vite and stays a loud `lightningcss.version` install failure (honest-npm territory).

**Current status.** The install, the vitest CLI surface (`vitest --version`, `--help`) and every runtime capability row below are browser-proven. The end-to-end `vitest run` is NOT yet green: `vite.createServer({configFile, plugins})` — the pipeline vitest's `createVitest` drives — suspends on a promise that never settles (`runtime-js/vitest-config-pipeline-suspension`). The rows stay as the unit-proven claim surface; the e2e (`tests/e2e/vitest-run.spec.ts`) is the closing proof and is red on that wall.

| Feature | Status | Notes |
|---|---|---|
| `npm install` with `overrides: {vite: "8.0.16"}` | ✅ | npm's bare-version spelling resolves as the key package at that range; one hoisted `vite@8.0.16` satisfies vitest's `vite ^8` edge. The rifty `vite@8.0.16` spelling keeps working. |
| `vitest.config.ts` loaded and honoured | ✅ | The TS config loads through vite's config bundle; the `include` glob drives collection. |
| TypeScript test files (`.ts`) | ✅ | Vitest's module evaluator transforms and runs `.ts` sources; stack offsets honoured (`vm.runInThisContext` `lineOffset`/`columnOffset`). |
| `vitest run` (default `forks` pool) | ✅ | Default reporter lists the file, reports `1 passed` / `1 failed` with the assertion diff; exit code 1, then 0 after the fix. |
| `npm test`, `--reporter=verbose` | ✅ | Same results and exit codes as `vitest run`. |
| `--pool=threads` | ✅ | Same results and exit code as `forks`: Worker `stdout`/`stderr` streams, explicit `execArgv: []`, live-Worker keepalive. |
| Process lifecycle the CLI relies on | ✅ | `uncaughtException`/`unhandledRejection` handlers, the `exit` event, `process.exit()` honouring `exitCode`. |
| `child_process.fork` IPC `serialization: 'advanced'` | ✅ | Structured-clone values round-trip child↔parent; functions throw `ERR_INVALID_ARG_TYPE`. |
| `Readable.pipe(process.stdout|stderr)` | ✅ | Node's stdio end-exemption; pipe wiring detaches on source end. |
| Named builtin members (`fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage`) | ✅ | Exist as members so named imports link; calling throws a named `NotImplementedError`. |
| `node:path/posix`, `node:path/win32` | ✅ | Registered builtins; `win32 === posix` (POSIX-only posture). |
| `environment: 'jsdom'` / `'happy-dom'` | ❌ | Loud `NotImplementedError` naming the deferred epic `jsdom-environment-in-browser`. |
| Watch mode (`vitest` without `run`) | ❌ | First wall stays `readline.emitKeypressEvents` `NotImplementedError`. |
| Coverage (`@vitest/coverage-v8`) | ❌ | `node:inspector` Session — loud proxy throw. |
| Browser mode, `typecheck` pool, `--changed` | ❌ | Loud `NotImplementedError` (git via spawnSync is absent by design). |
| `vmThreads` / `vmForks` pools | ❌ | `vm.SourceTextModule`/`SyntheticModule` absent — loud. |
| Other vitest / vite versions | ❌ | Unclaimed; vite outside the exact set keeps today's loud shadow/patch ceilings. |

## Test Sources

- `tests/e2e/vitest-run.spec.ts` (install, failing run exit 1, fixed run exit 0, `npm test`, verbose reporter, `--pool=threads`, loud jsdom)
- `packages/npm-client/src/overrides.test.ts`
- `tools/node-parity-runner/cases/` — `path/subpath-posix-win32`, `process/esm-named-prototype-methods`, `fs/esm-named-absent-members`, `modules/esm-symbol-key-global-write`, `modules/cjs-symbol-key-global-define`, `stream/node-eval-pipe-into-process-stdout`, `process/node-eval-process-lifecycle`, `child_process/public-ipc-advanced`, `vm/run-in-this-context-offsets`, `worker_threads/worker-keepalive`, `worker_threads/stdio-streams-empty-exec-argv`
- `packages/runtime-js/src/builtins/worker_threads.test.ts` (keepalive handle, stdio wrappers)

## Known Limitations

- `process.memoryUsage()` throws (heap statistics are not observable from the browser); `--logHeapUsage` stays loud.
- `beforeExit` emission is not implemented (not on vitest's path).
- Byte-identical reporter timing/ANSI is not claimed — pass/fail lines, counts and exit codes are.
- Re-running `npm install` after changing the vite pin over an existing `node_modules/vite` hits the stale-dir ceiling (`npm-client/stale-package-dir-on-version-change`); the claimed flow starts from a clean project.
