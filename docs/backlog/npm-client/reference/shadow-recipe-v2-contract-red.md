# Shadow recipe v2 Contract+RED

Recorded 2026-07-28 against source-only contract commit
`db1871b987c990925d9632080b9b81723ea0e298`. No production source differs from
that commit. Checkpoint `8f3251e8` was blocked because replay and sibling
expectations were masked; this is its in-line re-cut.

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/internal/shadow/recipe-v2-authority.contract.test.ts \
  src/shadow-recipe-v2-data-authority.contract.test.ts \
  src/installer-shadow-shims.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-bin-authority.contract.test.ts
pnpm --filter @riftydev/workbench exec vitest run \
  src/workers/owner-package-shadow-assets.contract.test.ts
pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "Vite 7 config graph"
```

The npm-client runs have 38 RED and 44 GREEN tests:

- six named generic authority cases independently require successful required,
  retained optional, omitted optional, peer, bundled, and scoped projections;
- seven complete-projection drifts reach registry traversal instead of the
  named pre-tarball `NotImplementedError`;
- exact LightningCSS fixtures request bundled `napi-wasm` externally; the
  previous data-authority and legacy sibling expectations now fail with them;
- a pre-seeded v2 LightningCSS+esbuild replay enters lock ingress and rejects
  protocol v2 before any registry read;
- three fresh placements and three independently pre-seeded replays disagree
  with the SHA-checked npm 11 oracle; direct conflict also fetches/writes instead
  of pre-write `ERESOLVE`;
- acquired bin disk and lock leaks are both observed; materialized bins are
  absent or keep non-canonical lock spelling;
- shared commands remain manifest-order dependent, incremental launchers remain
  stale, and nested scopes choose the wrong owner;
- root and nested parked alias aborts continue later writes; root/nested alias
  `ENOSPC`/`EACCES` plus ordinary bin fault guards already fail loudly, publish
  no lock, and reconcile on retry.

The Workbench run has one GREEN and one RED test. Its soft assertions
independently observe protocol v1, missing `materialization.bin`, and
`./bin/esbuild` lock spelling. Physical exclusion is GREEN: while the first real
installer is parked at `/package-lock.json`, the second cannot enter the core
or write.

The real Chromium Vite 7.3.6 case completes dev/build/preview/optimize and then
independently reports the same three lock gaps from the project’s actual
`package-lock.json`.
