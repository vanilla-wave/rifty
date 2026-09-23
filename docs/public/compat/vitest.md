# Compatibility matrix — vitest

Hand-maintained public claim surface for `vitest run` inside the rifty browser shell. The claim is
exactly **vitest 4.1.11 on Vite 8.0.16**, run through the installed `.bin/vitest`; rows cite an
end-to-end fixture whose expected lines, counts and exit codes come from the same project on Node
v24.16.0 / npm 11.17.0.

**Manifest precondition.** Pin Vite with `"overrides": {"vite": "8.0.16"}` (npm spelling; the
`"vite@8.0.16"` form also works) or install from an npm-authored `package-lock.json` that records
`node_modules/vite` at 8.0.16. `devDependencies: {"vitest": "4.1.11"}` alone lets vitest's `vite`
edge (`^6.0.0 || ^7.0.0 || ^8.0.0`) resolve the latest Vite, whose `lightningcss ^1.33.0` the shadow
recipe refuses: `npm install` fails with `Not implemented: lightningcss.version`. Start from a tree
without `node_modules/vite`; re-pinning over an installed Vite is not claimed.

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws
`NotImplementedError` or a named module-load ceiling).

| Feature | Status | Notes |
|---|---|---|
| `npm install` with the Vite pin | ✅ | One `node_modules/vite` at 8.0.16 (none nested) satisfying vitest's `vite` edge, matching lock entry, `@rolldown/binding-wasm32-wasi`, `lightningcss@^1.32.0` → `lightningcss-wasm@1.32.0` shadow substitution; exit 0 |
| `vitest.config.ts` | ✅ | The TypeScript config is loaded and honoured: only its `include` glob is collected; a test file outside it is not run |
| TypeScript source and test files | ✅ | `.ts` modules are transformed and run; a failure points at the original `file:line:column` with Node's code frame |
| `vitest run` default reporter | ✅ | Per-file and per-test lines, the failing test's assertion message and `- Expected`/`+ Received` diff, `Test Files`/`Tests` counts as on Node; exit 1 with a failing test, 0 when all pass |
| `npm test` (`"test": "vitest run"`) | ✅ | Same results and exit codes as `vitest run`; npm's `> test` banner line is not printed (rifty's npm prints `> vitest run` only) |
| `--reporter=verbose` | ✅ | One line per test with the failure reason, same counts and exit codes |
| `--pool=forks` (default) | ✅ | Test files run in a forked Node child (`serialization: 'advanced'`, piped stdio) |
| `--pool=threads` | ✅ | Test files run in a `worker_threads.Worker` (stdout/stderr streams); same results and exit codes as `forks` |
| Node process contracts vitest depends on | ✅ | A live `Worker`/ref'd `MessagePort` keeps the process running; `uncaughtException`/`unhandledRejection` handlers, the `exit` event and `process.exit()` honouring `process.exitCode` behave as on Node |
| Loading the vitest 4.1.11 tree | ✅ | CLI, config bundle and pool workers load every module on the claimed path — no link-time `SyntaxError`, `ModuleLoadError` or loader ceiling; members the browser cannot provide throw a named `NotImplementedError` only on unclaimed calls |
| `environment: 'jsdom'` | ❌ | Named `NotImplementedError` at jsdom's `vm.createContext(vm.constants.DONT_CONTEXTIFY)` (vitest runs jsdom with `runScripts: 'dangerously'`); tracked by epic `jsdom-environment-in-browser` |
| `environment: 'happy-dom'` | ❌ | `Not implemented: module-loader.esm-global-function-assignment` — happy-dom's window writes a `Function` binding |
| Coverage (`--coverage`, `@vitest/coverage-v8`) | ❌ | `Built-in 'node:inspector/promises' is not implemented` |
| Browser mode (`@vitest/browser-playwright`) | ❌ | `Not implemented: node:https.Agent` (or `node:http.Agent`) when Playwright loads; no browser is launched from inside the browser |
| `--pool=vmThreads` / `--pool=vmForks` | ❌ | Named `NotImplementedError` for the pools' `--experimental-vm-modules` startup flag (`vm.SourceTextModule` is absent) |
| Watch mode (`vitest` without `run`, `--watch`) | ⚠️ | Not claimed. Shell children get a non-TTY stdin, so bare `vitest` runs once with `vitest run`'s lines and exit code, as Node does with piped stdin; `vitest --watch` is untested and has no named ceiling on its path |
| Other Vite / vitest versions | ⚠️ | Not claimed. Vite releases requiring `lightningcss ^1.33.0` (8.2.0 through 8.3.0, the latest at writing) fail `npm install` with `Not implemented: lightningcss.version`; Vite 7.3.6 / 8.0.x / 8.1.x and vitest other than 4.1.11 are untested, install included |

## Test Sources

- `tests/e2e/vitest-run.spec.ts`

## Known Limitations

- Pass/fail lines, counts and exit codes are claimed; reporter timing, `Start at`/`Duration`, ANSI
  colors and the TTY summary window are not.
- Other vitest modes (`typecheck`, `--changed`, `--logHeapUsage`, `--ui`, workspaces/projects) are
  not claimed and untested.
- The browser shell's child stdin is not a TTY, so interactive vitest shortcuts are unavailable.
