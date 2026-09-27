# Browser floor cross-engine evidence — 2026-09-28 (Europe/Belgrade)

Authority: browser-support-floor I5/I6; record existing behavior, no product repair.
Playwright 1.60.0; macOS local execution. UTC execution date 2026-09-27.

## Native boundaries

Run from repository root:
`node docs/backlog/playground/reference/browser-floor-native-api-probe.mjs`.
Real HTTP response CSP; external module Workers; persistent per-engine profiles.
Two workers request a sync access handle on the same OPFS file.

| Engine / build | Document CSP `script-src 'self'`, worker no CSP | Worker response CSP `script-src 'self'` | Contended sync handle |
|---|---|---|---|
| Chromium 148.0.7778.96 | `new Function` → 42 | `EvalError` | `NoModificationAllowedError` |
| Firefox 150.0.2 | `new Function` → 42 | `EvalError` | `NoModificationAllowedError` |
| WebKit 26.4 | `new Function` → 42 | `EvalError` | `InvalidStateError` |

Thus this document policy does not constrain eval in an external module worker;
the worker response policy does. Blob workers not measured by this probe.
WebKit admission retry impact remains a question:
`docs/backlog/vfs/webkit-opfs-contention-error.md`.

## Focused WebKit fixture proof

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm exec playwright test --config playwright.no-coi.config.ts --project=webkit no-coi-memory-descriptor.spec.ts no-coi-agent-sdk.spec.ts no-coi-sandbox-build-loop.spec.ts replica-storage.spec.ts no-coi-opfs-reload.spec.ts --grep 'headerless native|Stop retains|host stays interactive|replica|reload'`

4 passed, 1 failed, 41.3 s. Persistent WebKit profile passes native Memory oracle,
native mutation flush/Stop, replica bytes and exact-byte reload.
The prior unknown build-loop timeout is pinned to the spec-side install route:
`Missing test boundary: install registry route was not requested` (30 s).
No product timeout asserted. The run-route wait is bounded independently.

## Firefox full lane, local

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm exec playwright test --config playwright.no-coi.config.ts --project=firefox`

Firefox 150.0.2: 108 passed / 2 failed, 6.3 min (110 tests, including the new
storage-capability cases). Live COI/non-COI build byte comparison passes.
Failures: new support probe imported `checkSandboxSupport` from the SDK
instead of the public workbench export (test-infra; import corrected),
warm-open `page.evaluate` lost its execution context during navigation
(test-infra classification pending isolated repeat). Vite's initial scan
reported an unresolved import in the concurrently prepared manual page;
that page import was corrected. No product conclusion from these two reds.
