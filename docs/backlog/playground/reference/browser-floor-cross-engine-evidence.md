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
Isolated repeat after the test import correction and stable Vite scan:
`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm exec playwright test --config playwright.no-coi.config.ts --project=firefox browser-capabilities.spec.ts no-coi-warm-open.spec.ts:90`
→ **2 passed, 19.4 s**. Required OPFS support reports non-COI `supported`;
cleanup passes. Warm-open navigation failure does not reproduce (test-infra
reload/flake); combined run plus repeat covers all 110 tests, not a fresh full
110/110 run.
## WebKit isolated support and missing route

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm exec playwright test --config playwright.no-coi.config.ts --project=webkit browser-capabilities.spec.ts no-coi-sandbox-build-loop.spec.ts --grep 'required persistence support|host stays interactive'`

WebKit 26.4: **2 failed, 37.7 s**, persistent profile per test.

- `checkSandboxSupport({ persistence: 'required' })`: non-COI `unsupported`,
  unmet `opfs`; `DataCloneError: The object can not be cloned.` Cleanup passes;
  all other non-COI required checks pass. Class: engine-behavior, support-probe
  path. Native handle Window→Worker transfer is a candidate cause in the
  probe; the exact clone operation is not isolated. SDK persistence succeeds
  in the focused run above. Draft:
  `docs/backlog/distribution/webkit-support-probe-opfs-clone.md`.
- Interactive-host install route: same `Missing test boundary: install registry
  route was not requested`; reproduces in isolation, not a flake. Class:
  test-infra; its route wait is now bounded. Product install/run settlement
  was separately established by the prior P2 evidence, not this failed barrier.

## Native clone discriminator, 22:49:59–22:50:01 UTC

Re-ran the checked-in native probe above with direct Window→module Worker
`postMessage({ directory: await navigator.storage.getDirectory() })`:
Chromium 148.0.7778.96 and Firefox 150.0.2 receive `kind: 'directory'`; WebKit
26.4 throws `DataCloneError: The object can not be cloned.` before delivery.
Thus the support-probe's extra handle-transfer boundary is independently
reproduced; Worker-local root acquisition succeeds. CSP/lock outputs remain
identical to the first table.
## Named manual CI run

[Run 36356372850](https://github.com/vanilla-wave/rifty/actions/runs/36356372850),
SHA `850eeee2640aae0793c5c629994acd20821cbf95`, Ubuntu, Playwright 1.60.0.
Each artifact includes `browser-build.json`, actual test reports and retained
failure traces. UTC dates below; local Belgrade date 2026-09-28.

| Lane | Engine build | Start (UTC) | Executed result | Artifact |
|---|---|---|---|---|
| non-COI | Chromium 148.0.7778.96 | 2026-09-27 22:47:55 | 110 passed; 6m35s | `browser-evidence-no-coi-chromium` (10943742819) |
| non-COI | WebKit 26.4 (Linux) | 2026-09-27 22:47:52 | 40 passed / 70 failed; 7m01s | `browser-evidence-no-coi-webkit` (10944680481) |
| non-COI | Firefox 150.0.2 | 2026-09-27 22:47:54 | 109 passed / 1 failed; 9m50s | `browser-evidence-no-coi-firefox` (10944596693) |

### Firefox CI classification

One test-infra ordering red: delayed resident-rival port 5196 returns generic
`Error: resident port 5196 is already in use` instead of the expected selected
bin ownership error. Its 20 ms rival is armed before the eval roundtrip and
`startBin` admission. The returned error names the existing pre-bound admission
branch; same timing fault as the repaired sibling fixtures in
`docs/backlog/distribution/reference/agent-bench-ci-resident-evidence.md`.
Local full-lane execution passed this unchanged case. Draft:
`docs/backlog/playground/no-coi-delayed-rival-fixture-ordering.md`.

### Linux WebKit classification

This Playwright Linux build has **no `navigator.storage` / `FileSystemFileHandle`**
in the exercised realms, despite a persistent profile and a passing
secure-context probe. Do not transfer its persistence result to macOS WebKit
26.4: the native API and SDK persistence proofs above pass there.

| Class | Count | Evidence |
|---|---|---|
| capability-missing / test-infra downstream of absent OPFS | 66 | Support probe unmet `opfs`; no storage API; memory receipts instead of flushed; OPFS-only fault injectors dereference absent native objects |
| capability-missing, COI oracle | 1 | build-parity oracle: `Workbench requires cross-origin isolation` under D-001 credentialless |
| test-infra, route boundary | 1 | missing install registry route; same isolated macOS failure |
| engine-behavior, recovery path pending isolation | 2 | Pi hard Stop: `ENOENT: /agent-stop`; resident restart/exit: `ENOENT: /resident/node_modules/.bin/local-server` |

Recovery observations are not reduced to the OPFS-only assertion group:
`docs/backlog/distribution/webkit-memory-replacement-enoent.md`.
The existing `no-coi-storage-capability` fault injections also assume the
native objects exist; their Linux WebKit worker crashes occur inside fixture
injection, not the repaired admission branch. Chromium CI runs all eight
injections GREEN; Firefox local runs them GREEN.
