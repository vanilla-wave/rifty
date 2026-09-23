# Compatibility — Vitest 4.1.11 with Vite 8.0.16

Current browser-shell proof is limited to installation. The `vitest run`
acceptance test is RED; this page makes no working-test-run claim yet.

## Project precondition

```json
{
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "4.1.11" },
  "overrides": { "vite": "8.0.16" }
}
```

An npm-authored lockfile pinning the same pair is the other supported install
path. An unpinned `devDependencies: { "vitest": "4.1.11" }` alone resolves a
newer Vite and currently fails loudly at `lightningcss.version`; it is not a
Vitest run claim.

| Feature | Status | Evidence |
|---|---|---|
| Clean `npm install` with the manifest above | ✅ | Chromium installs one Vite 8.0.16, Vitest 4.1.11 and rolldown wasm32 binding (`tests/e2e/vitest-install-override.spec.ts`). |
| `vitest run` with `vitest.config.ts` and `.ts` tests | ❌ | On latest tested goal branch 062056ba0, the command prints no reporter output and incorrectly exits 0 before config loading. An earlier snapshot hit a named `module-loader.esm-global-function-assignment` ceiling. REDs are recorded in `docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md`; there is no run claim. |

## Pending acceptance

The same Chromium e2e requires real reporter output, a failing assertion diff
with exit 1, a fixed pass with exit 0, `npm test`, verbose and both `forks`
and `threads`. Only that proof can turn I1–I6 into ✅ rows.

No claim yet for jsdom/happy-dom, watch mode, coverage, browser mode,
`vmThreads`/`vmForks`, other Vite versions, typecheck pool or `--changed`.
Each final ❌ row needs its named loud ceiling; install success alone cannot
establish one.

## Test sources

- `tests/e2e/vitest-install-override.spec.ts`
- `docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md`
