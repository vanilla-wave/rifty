# No-COI worker startup evidence

Baseline: PR #332 plus main, before implementation. Node v24.16.0.

- `pnpm exec vitest run --project unit packages/runtime-js/src/host-startup.fault.test.ts packages/rifty/src/sandbox-startup.contract.test.ts`: 18/18 RED. Public input reaches Worker effects; old 10000ms rejects a 15000ms readiness; timeout leaves Worker alive; stale readiness revives disposed controller.
- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-configured-startup.spec.ts`: first three cases RED. A/B namespace never created; required resolves using memory; native 11000ms preload rejects at old 10000ms.
- Initial Vitest invocation used nonexistent config and is harness failure only; corrected project command above establishes RED.

Timer sweep: `runtime-js/src/host.ts` has one 10000ms handshake deadline. SDK
restart calls the same spawn owner. VFS native acquisition/preload has no shorter
timer. OPFS persistence scheduler's reporting budget is a later mutation budget,
not a startup preload timer. No new coordination mechanism.
