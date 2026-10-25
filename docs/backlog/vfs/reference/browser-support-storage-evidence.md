# Browser support storage admission — I3/I4

2026-09-28; PR #362. Existing baseline: goal I3/I4 P1/P2 (2026-09-27), ADR-0372/ADR-0437.

## Root cause and fault sweep

`OpfsFsSync.isSupported` admitted sync handles without the `createWritable` used by both `opfs.ts` and `opfs-replica-store.ts`. One backend selector owns both write paths: change admission, not either writer (`false-fallback`, `provenance-lie`). Root denial leaves `initializeBackend` raw; worker boot throws asynchronously, Worker error owner mislabels it `NotImplementedError` (`quota-perm-fail`, `provenance-lie`). Existing `toolchain-terminal` + `serializeRuntimeError` carries fatal causes; reuse it, no new lifecycle mechanism.

Storage selection precedes writes: torn writes, concurrent writers, corrupt replay belong to existing backend tests and are not introduced here. Worker transport physically excludes replay/duplicate/reorder; existing terminal owner terminates and rejects pending calls. No retries or new epoch/queue.

## RED

`RIFTY_NO_COI_PORT=5441 RIFTY_NO_COI_ORACLE_PORT=5442 RIFTY_NO_COI_RESOURCE_PORT=5443 pnpm test:no-coi tests/no-coi/no-coi-storage-capability.spec.ts`

Chromium (Playwright 1.60.0): 6 failed / 2 passed (9.5s). Missing createWritable: required/default/preferred reached writes and returned SandboxPersistenceError. Required unavailable root: NotImplementedError / worker crashed. Preferred/default root fallback omitted native name. Both ephemeral controls passed.

Fault injection replaces only native absent API / root boundary in a real dedicated Worker; real runtime, paired VFS and SDK. No sibling mocks.

## Decision and GREEN

Independent DEC-2 review (parent's fresh reviewer, 2026-09-28) approved partial supersession of ADR-0372 decisions 1 and 3: one Worker + sync handle + createWritable selector, no probe writes; root failures distinct from missing APIs; existing fallback retained. Recorded ADR-0476 + ADR-0372 Corrections. RDY-8 uses observed P1/P2 baseline + executed RED; no new speculative promise.

- Same Chromium command plus `no-coi-configured-startup.spec.ts` and `no-coi-opfs-reload.spec.ts`: 14 passed, 1 navigation interruption during concurrent source edits. All 8 new cases passed; native exact-byte reload passed; startup namespace/restart, denial, timeout and close passed. The >10s preload control requires clean rerun (first isolated attempt could not start Vite while a parallel manual-protocol asset imported unresolved @riftydev/sdk).
- `RIFTY_PLAYGROUND_PORT=5444 pnpm test:browser-unit tests/browser-unit/sandbox-support.spec.ts -g 'missing createWritable'`: 1 passed; actual support worker reports opfs unmet naming createWritable.
- `pnpm exec vitest run packages/vfs/src/opfs-sync.test.ts packages/runtime-js/src/worker-fs-rpc.test.ts packages/runtime-js/src/worker-fs-structured.test.ts`: 117 passed, 1 pre-existing skip.
- `pnpm backlog:check`, `pnpm check:file-size`: pass.

## Final verification

- Clean final `RIFTY_NO_COI_PORT=5441 RIFTY_NO_COI_ORACLE_PORT=5442 RIFTY_NO_COI_RESOURCE_PORT=5443 pnpm test:no-coi tests/no-coi/no-coi-storage-capability.spec.ts tests/no-coi/no-coi-configured-startup.spec.ts tests/no-coi/no-coi-opfs-reload.spec.ts tests/no-coi/no-coi-preload-failure.spec.ts`: **17 passed (37.1s)**, Chromium 148.0.7778.96. The earlier >10s navigation failure did not reproduce; that test passed in 22.5s. Preload corruption still rejects and pending eval/fs settle.
- Revert checks: independently remove the createWritable predicate, bypass root error classification, or bypass toolchain terminal transport; each required-policy browser case fails its intended assertion (1 failed per mutant). All source restored before the clean final run.
- Legacy `initBackend()` with no storage options retains its native error; only configured storage gains the SDK identity. No existing assertion retargeted.
- `RIFTY_PLAYGROUND_PORT=5444 pnpm test:browser-unit tests/browser-unit/opfs-no-coi-policy.spec.ts tests/browser-unit/sandbox-support.spec.ts -g 'permission failure loudly|missing createWritable'`: **2 passed (4.4s)**; legacy native `NotAllowedError: pickup denied` unchanged; missing writable report remains unsupported.
