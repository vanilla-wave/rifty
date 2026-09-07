## Items

2. `distribution/no-coi-vm-engine-default-rewrite` — I2; preboot engine selection and honest capability report.
3. `distribution/sdk-entry-packaging-hygiene` — I3; io factories, generic-only backend loading, worker sideEffects.
4. `distribution/no-coi-worker-install-lazy-split` — I4; first-use install/activation module, existing no-COI scenario proof.
5. `toolchain-build/client-bundle-size-ci-gate` — I5; reuse packed graph proof, calibrate after cleanup; CI only.

## Open questions

- Which preboot channel carries vmEngine? — owner: agent — existing Worker URL/init lifecycle and DEC-2 decision review.
- Final byte ceilings and boot-time delta? — owner: agent — packed before/after measurements, historical-leak calibration; latency reported, no invented target.

## Out of scope

- PR #310 exclusions: kernel DI, cross-worker Buffer identity, playground Monaco/preload, activation snapshot copy cost.
- Install-time WASM/tarball size budgets; QuickJS WASM uses request proof instead.
- New TypeScript eval support; its existing named gap remains loud.
- Inlining bundlers: dynamic imports defer evaluation but promise no transfer saving.
