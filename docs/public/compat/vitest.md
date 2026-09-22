# Compatibility matrix — vitest run

Public claim for one pair: vitest 4.1.11 and vite 8.0.16, `environment: node`, `vitest run`. The manifest pins vite with an override (`"vite": "8.0.16"`) or an npm lock that resolves that exact version. An unpinned install that floats vite stays a loud failure.

Pass/fail lines, counts, and the exit code are claimed. Reporter timing and ANSI bytes are not.

Legend: ✅ implemented and tested · ❌ not implemented (throws `NotImplementedError` or another named ceiling).

| Feature | Status | Notes |
|---|---|---|
| `npm install` with `"overrides": { "vite": "8.0.16" }` | ✅ | Bare version is a range of vite, not a package named `8.0.16`. One `node_modules/vite` at 8.0.16. |
| `vitest run` forks pool, `vitest.config.ts`, TypeScript tests | ✅ | Include glob is honoured. Default reporter lists the file, `1 passed`, `1 failed`, exit 1. After the failing test is fixed, exit 0. `npm test` and `--reporter=verbose` match. |
| `vitest run --pool=threads` | ✅ | Same results and exit code as forks. |
| Other vite versions, vitest other than 4.1.11 | ❌ | Not claimed. Organic unpinned vitest stays loud (`lightningcss.version`). |
| `environment: 'jsdom'` / happy-dom | ❌ | Separate epic. Named ceiling, not a silent pass. |
| Watch mode | ❌ | First wall is `readline.emitKeypressEvents`. |
| Coverage | ❌ | `node:inspector` is not implemented. |
| `vmThreads` / `vmForks` | ❌ | `vm.SourceTextModule` is not implemented. |
| Browser mode, typecheck pool, `--changed` | ❌ | Not claimed. |

## Test Sources

- `packages/npm-client/src/overrides.bare-version.test.ts`
- `packages/runtime-js/src/vitest-run-surfaces.test.ts`
- `tests/e2e/vitest-run.spec.ts`
