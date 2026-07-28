# Shadow recipe v2 Contract+RED

Recorded 2026-07-28 against source-only contract commit
`db1871b987c990925d9632080b9b81723ea0e298`. No production source differs from
that commit.

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/internal/shadow/recipe-v2-authority.contract.test.ts \
  src/installer-bin-authority.contract.test.ts
pnpm --filter @riftydev/workbench exec vitest run \
  src/workers/owner-package-shadow-assets.contract.test.ts
```

The npm-client run has 17 RED and 4 GREEN assertions:

- seven complete-projection drifts reach registry traversal instead of the
  named pre-tarball `NotImplementedError`;
- bundled `napi-wasm` is requested externally instead of retained in-bundle;
- acquired bins leak and materialized bins are absent;
- exact offline replay, three successful peer placements, and direct
  `ERESOLVE` disagree with the committed npm 11 oracles;
- shared commands remain manifest-order dependent, incremental launchers remain
  stale, and nested scopes choose the wrong owner;
- missing targets, abort, `ENOSPC`, and `EACCES` already fail loudly, publish no
  lock, and reconcile on retry.

The Workbench run has one existing GREEN and one RED assertion. Its new case
passes physical exclusion through the sole owner FIFO: while the first real
installer is parked at `/package-lock.json`, the second cannot enter the core
or write. It fails only because the published trace remains protocol v1 and
omits `materialization.bin`.
