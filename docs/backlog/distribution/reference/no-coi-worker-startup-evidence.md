# No-COI worker startup evidence

Baseline: PR #332 plus main, before implementation. Node v24.16.0.

- `pnpm exec vitest run --project unit packages/runtime-js/src/host-startup.fault.test.ts packages/rifty/src/sandbox-startup.contract.test.ts`: 18/18 RED. Public input reaches Worker effects; old 10000ms rejects a 15000ms readiness; timeout leaves Worker alive; stale readiness revives disposed controller.
- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-configured-startup.spec.ts`: first three cases RED. A/B namespace never created; required resolves using memory; native 11000ms preload rejects at old 10000ms.
- Initial Vitest invocation used nonexistent config and is harness failure only; corrected project command above establishes RED.

Timer sweep: `runtime-js/src/host.ts` has one 10000ms handshake deadline. SDK
restart calls the same spawn owner. VFS native acquisition/preload has no shorter
timer. OPFS persistence scheduler's reporting budget is a later mutation budget,
not a startup preload timer. No new coordination mechanism.

Independent reviewer rerun: native suite 4 expected RED (namespace, required, 11s preload, 5000ms timeout); native close and 2 existing unreadable-preload cases GREEN. Contract+RED PASS; NOTE timer fractional/upper-bound coverage retained.

Implementation checks: native Chromium 7/7 GREEN (initial/restart 11s preload,
A/B/default native roots, required/preferred, timeout/close, unreadable preload).
First full pr:check: unit+parity GREEN, one emitted TypeScript worker pin drift;
size remains 10022664, startup tokens absent; update exact SHA only, keep ceiling
and all negative payload criteria. Protocol v4 rejects old workers that could
ignore storage metadata. Second full run exposed old test labeling v4 as future;
isolated host.test.ts reproduced its 5000ms timeout. Update invalid future fixture
to v10, keeping real v3 rejection in startup fault suite. No timeout increase.
