# Vite command compatibility

Public claim surface for the playground `vite` command after ADR-0174.

Legend: ✅ implemented and tested · ⚠️ routed honestly but not exhaustively covered ·
❌ not implemented (throws `NotImplementedError` or exits non-zero with a directed diagnostic).

| Surface | Status | Notes / tests |
|---|---:|---|
| Real `node_modules/.bin/vite` dispatch | ✅ | `shell.registerCommand('vite')` is gone; `which vite` resolves to `/scratch/node_modules/.bin/vite`. Tests: `packages/workbench/src/workers/real-vite-bootstrap.test.ts`, `tests/e2e/vite-command-honesty.spec.ts`. |
| `vite`, `vite dev`, `vite serve`, CLI flags, help/version, unknown subcommands | ✅ | Routed through the installed Vite CLI, not rifty's parser. Dev/preview ports are observed from child IPC and mirrored into preview UI. |
| `vite build` with root `vite.config.{js,ts,mjs,cjs,mts,cts}` | ✅ | Real CLI config loading applies user config; `tests/e2e/vite-command-honesty.spec.ts` builds a config-defined marker into `dist/`. |
| `vite preview` (Vite 7 preset) | ⚠️ | Real CLI preview registers the production preview route. Root `vite.config.*` / `--config` throw `NotImplementedError('vite.preview.config-loading')`; CORS middleware parity is not claimed because the browser wrapper currently forces the inline preview config. `tests/e2e/vite7-build-preview.spec.ts`. |
| Server-capable `.bin` commands | ✅ | Generic `.bin` children spawn `serve:true`, post listened ports, and register preview slots. Unit seams: `packages/workbench/src/glue/bin-executor.test.ts`, `packages/workbench/src/workers/owner-child-bin-executor.test.ts`, `packages/workbench/src/workers/node-entry-bootstrap.test.ts`. |
| Legacy owner `npm run dev` Vite path with root `vite.config.*` | ❌ | Still uses the old co-resident dev-server helper; `assertNoUserViteConfig` throws `NotImplementedError('vite.config-loading')` rather than silently ignoring config. |
| `vite optimize` | ⚠️ | No rifty parser blocks it anymore; the real CLI runs. Optimizer success is not yet covered as a supported compat claim. |
