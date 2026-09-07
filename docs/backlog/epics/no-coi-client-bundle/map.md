## Items


## Open questions

- Resolved: measured budgets and calibration in tools/checks/client-bundle-budget.mjs; complete proof in toolchain-build/reference/client-bundle-budget-evidence.md. Timing observations remain labelled local, with no target.

## Out of scope

- PR #310 exclusions: kernel DI, cross-worker Buffer identity, playground Monaco/preload, activation snapshot copy cost.
- Install-time WASM/tarball size budgets; QuickJS WASM uses request proof instead.
- New TypeScript eval support; its existing named gap remains loud.
- Inlining bundlers: dynamic imports defer evaluation but promise no transfer saving.
