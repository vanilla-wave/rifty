# No-COI SDK project evidence

Baseline: configured startup commit cd364f29bbb0d89fa6f2bacbea05ec8d126b19ee.

- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-snapshot-application.spec.ts`: 8 RED; public applySnapshot missing. Native ms 2.0.0 oracle executed on Node v24.16.0: 172800000 for 2 days.
- Saved access and packed consumer RED commands run separately; their results follow.
- Existing `prepareDepSnapshotApplication` performs replay/prepared-payload validation and conflict preflight before cache effects. `fetchVerifiedDepSnapshot` supplies bounded acquisition and decoded-byte identity. Existing `preparePackageEntryRuntime` defers real adapter failures to package use.

- `pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-saved-access.spec.ts`: 5 RED, existing-shape open rejects with SandboxInstallRequiredError for missing/pending/legacy proof and bad/missing lock.
- `node tests/integration/workbench-packed-consumer.mjs`: offline packed dependency install, strict consumer TypeScript, Vite build and both published producers succeeded; Chromium reached public SDK/copied worker and failed `toolchain.applySnapshot is not a function`. This is runtime API RED, not import/typecheck failure.
