# esbuild-wasm registry-twin recut — Contract+RED evidence

Pickup environment: 2026-08-31, Node v24.16.0, pnpm 11.5.2, Vitest
2.1.9, Playwright 1.60.0, Chromium 148.0.7778.96,
`origin/main@e9c53b8ac`.

## Frozen upstream member

```text
$ stat -f '%z %N' tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm
13918738 tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm
$ shasum -a 256 tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm
9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b  tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm
$ node -e '<print esbuild-wasm package dependency fields>'
{"version":"0.28.0"}
```

The exact package omits dependency, optional, peer, and bundled-dependency
fields; the registry-recipe projection is four empty maps plus an empty bundled
list. `pnpm vitest run
tools/shadow-registry/src/esbuild-contract-source-pin.test.ts` is 2/2 GREEN.

## Pre-recut preservation baseline

```text
$ pnpm vitest run \
  tools/shadow-registry/src/internal/catalog.contract.test.ts \
  tools/shadow-registry/src/esbuild-contract-source-pin.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts \
  packages/npm-client/src/installer-shadow-shims.test.ts \
  packages/npm-client/src/installer-sass-embedded-substitution.contract.test.ts \
  packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts \
  packages/workbench/src/workers/node-entry-runtime-preparation.contract.test.ts

Test Files  7 passed (7)
Tests       101 passed (101)
Duration    141.15s
```

This freezes exact recipe admission/replay, the shared LightningCSS/Sass twin
path and fault suite, adapter dispatch, and pre-guest preparation before the
Pattern-1 RED changes.

## RED transcript

No production source was changed.

```text
$ pnpm backlog:check
backlog: 300 item(s), 17 epic(s)
backlog: OK

$ pnpm vitest run \
  tools/shadow-registry/src/esbuild-contract-source-pin.test.ts \
  tools/shadow-registry/src/internal/catalog.contract.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts \
  packages/runtime-js/src/builtins/node-entry-runtime-config.test.ts \
  packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts \
  tools/checks/esbuild-legacy-retirement.test.ts

Test Files  5 failed | 1 passed (6)
Tests       18 failed | 84 passed (102)
```

Discriminating failures: the catalog reports synthetic acquisition; the
installer makes zero esbuild-wasm registry reads and has no in-tree member or
substitution-plan API; node-entry rejects `runtimeBindings`; the adapter still
requires the asset client; the retirement inventory finds four carrier paths
and 167 surviving references. npm-client, runtime-js, and workbench typechecks
remain GREEN, so no RED is an import or type failure.

```text
$ RIFTY_PLAYGROUND_PORT=5791 pnpm playwright test \
  --config playwright.browser-unit.config.ts \
  tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "Vite 7 config graph"

1 failed
  acquisition: expected registry esbuild-wasm, received synthetic
  lock: node_modules/esbuild-wasm absent
  instant ledger: expected [], received exact packument + tgz URLs
  twin manifest: read failed
  after deleting /.rifty/shadow-assets and blocking /npm-registry:
    ShadowAssetError: failed to acquire esbuild-wasm@0.28.0/package/esbuild.wasm
```

## Reproduction map

| Contract row | Carrier |
|---|---|
| Exact twin + fresh/replay | source pin + catalog/installer RED; exact lock/tree bytes and request ledger |
| Activation authority/order | strict node-entry binding codec + in-tree adapter path/size/hash/order RED |
| Direct + Vite 7 | existing real-browser differential; catalog/recipe identity and publication rows |
| Offline instant reopen | Chromium deletes the old CAS, blocks registry, then boots/builds/dev-serves |
| Vite 8/no demand | existing Vite 8 zero-request/zero-activation rows |
| Deletion/API + data-only | finite retired path/reference inventory + exact package packlists |
| corrupt-input / provenance-lie | catalog/lock mutations + binding/path/member mutations |
| unbounded-read / observable-order | existing bounded registry suite + size/hash before compile spies |
| torn-state / quota-perm-fail | shared registry-twin Sass VFS fault matrix, preserved 45/45 GREEN |
| poisoned-cache / provenance-lie | shared tarball-cache/replay trace mutations + esbuild zero-read replay RED |
| sibling-drift | esbuild is required to use the same registry recipe owner as Sass/LightningCSS |
| frozen-assumption / lossy-aggregate | exact bytes/digests, full lock/request ledgers, browser differential, finite deletion inventory |
