# No-COI SDK project evidence

Baseline: configured startup commit cd364f29bbb0d89fa6f2bacbea05ec8d126b19ee.

- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-snapshot-application.spec.ts`: 8 RED; public applySnapshot missing. Native ms 2.0.0 oracle executed on Node v24.16.0: 172800000 for 2 days.
- Saved access and packed consumer RED commands run separately; their results follow.
- Existing `prepareDepSnapshotApplication` performs replay/prepared-payload validation and conflict preflight before cache effects. `fetchVerifiedDepSnapshot` supplies bounded acquisition and decoded-byte identity. Existing `preparePackageEntryRuntime` defers real adapter failures to package use.

- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-saved-access.spec.ts`: 5 RED, existing-shape open rejects with SandboxInstallRequiredError for missing/pending/legacy proof and bad/missing lock.
- `node tests/integration/workbench-packed-consumer.mjs`: offline packed dependency install, strict consumer TypeScript, Vite build and both published producers succeeded; Chromium reached public SDK/copied worker and failed `toolchain.applySnapshot is not a function`. This is runtime API RED, not import/typecheck failure.

Reception: native update now changes ms 2.0.0→2.1.3; packed Vite update adds pinned ms 2.0.0 through native npm lock regeneration. Post-interruption reapply is observed in a fresh Worker (Node cache probe /tmp/rifty-332-contract-node-cache-probe.log); no cache-reset guarantee added. Existing helper checks while full pr:check saturated the host hit 5000ms test/10000ms compression deadlines; these are not GREEN evidence. Rerun without concurrent heavy suites required.

Native initial GREEN found two test-boundary mistakes: `/eddy/` substring matched Vite-served `eddy-*.ts` source imports, and Node console inherited color formatting. Restrict acquisition observation to service endpoints/registry domain; native oracle writes the computed value directly to stdout. Full native saved/snapshot suite then 13/13 GREEN. Packed invalid-lock build can report nonzero CLI exit instead of rejecting the RPC; acceptance now checks exitCode and concrete adapter output (no weakened success criterion).

Packed invalid-lock RED persisted after correcting the CLI assertion: exitCode 0,
no stdout/stderr, prior dist still present. SDK run/start omitted the shared
program-entry preparation used by Workbench. Sibling sweep: node-entry-runtime-
preparation.ts delegates preparePackageEntryRuntime with trackKeepalivePromise;
no-coi run/start formerly called runNodeEntry directly. Reuse that preparation
at bin use; ordinary open keeps its non-refusing eval preparation. Explicit
registry install now applies the same prepared-file recipe as the producer.
Fault class: sibling-drift/provenance-lie at owned in-process entry composition;
no transport loss/reorder at this boundary and no new lifecycle coordinator.
Native snapshot + existing registry warm-open regression suite: 24/24 GREEN.
Public input decoder cases: 11/11 GREEN; host/SDK/recovery: 64/64 GREEN.

Packed SDK acceptance GREEN: Chromium/148.0.7778.96, real Vite 7.3.6
apply/build/edit/reopen/force/update and native interruption+quota, zero browser
registry/Eddy requests. Complete command log: /tmp/rifty-332-packed-snapshot-green-3.log.
This includes the missing-lock adapter-use failure and successful explicit repair.
