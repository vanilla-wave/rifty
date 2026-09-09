# Public producer evidence

## Reference — existing installer, 2026-09-08

Command: `pnpm exec tsx docs/backlog/distribution/reference/dep-snapshot-producer-probe.ts https://registry.npmjs.org`. Full output: `dep-snapshot-producer-probe.json`. Default probe is read-only and compares the retained JSON; explicit `--write` refreshes it, then run Biome format.

Node24.16.0, npm11.17.0; real npm-authored Vite8.0.16 fixture:
`tests/e2e/fixtures/npm-lock-replay/vite8/{package.json,package-lock.json}`.
Independent `producer_contract` probe used real install/createMemoryFs,
shadowSubstitutionPlanForInstallResult, planShadowSubstitutionsFromLockfile,
registryAcquisitionInstallPath and registryShadowEmbeddedSourcesFromLockfile.
For each ordinary output path it compared original version/resolved/integrity.

Result:20 packages, resolution metadata, output pin violations []. Only new
metadata fetch: lightningcss-wasm; new tarball lightningcss-wasm@1.32.0.
Attested paths: node_modules/lightningcss, node_modules/lightningcss-wasm,
node_modules/lightningcss-wasm/node_modules/napi-wasm. Catalog digest:
68b82251f296d987ba8ca8883b14adf2785b507b4ed3b69a84ebcad76b6f7002.
A blanket allowlist of original lock.resolved URLs instead failed at the
required lightningcss-wasm metadata request. Existing typed adaptation is
needed; a metadata-only provenance label does not imply ordinary pin drift.
This proves that scenario/postcondition, not the unimplemented producer.

## RED — public boundary

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-producer.test.ts`:
9 failed, all at the explicit public producer function assertion; no import or
typecheck failure. `pnpm --filter @riftydev/workbench typecheck` passes.
Actual ms/debug/LightningCSS tarballs back later assertions; only HTTP is replaced.

`pnpm test:packed-consumer`: packed packages install, strict host TypeScript and
build pass; Node fixture fails `AssertionError: packed public producer` before
baking. No source checkout import is used by the fixture. Its next assertions
compare deterministic output, run the same ms source under Node and Workbench,
and exercise raw gzip/real Content-Encoding gzip decoding with zero browser
registry acquisition.

First packed attempt had test-host TS5097 (`.ts` import); fixed to the fixture's
extensionless convention. A later repetition timed out during unchanged npm
pack function-bind@1.1.2, before the producer. Isolated exact installed package
`npm pack --loglevel=verbose --ignore-scripts --pack-destination <temp>` passed
in0.14s with npm11.17.0; no timeout raised or speculative tooling fix. That
interrupted run is not producer RED/acceptance evidence.

## GREEN

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-producer.test.ts`:
9/9 PASS, including real LightningCSS bundled source and ms/debug pin refusal.
Workbench and npm-client typecheck PASS.

`pnpm test:packed-consumer`: PASS (88.40s). Packed public producer uses a real
npm-generated ms lock, standard tar and native Node execution; Chromium restores
raw gzip and HTTP Content-Encoding decoded tar, runs the same source, checks
ms@2.0.0, and makes zero registry requests during either restore. Existing real
Vite7.3.6 preview/HMR and SQLite journey remains in the same required runner.

First full gate reproduced one sealed-root export-list failure in isolation (zero timeouts). ADR-0387 adds produceDependencySnapshot, so that exact allowlist now includes it; no other public-surface restriction changed.

Final+GREEN PASS atc798a8e84a6d1489c89aeefe3788ceda7d0570e5; full pr:check25/25. Independent reviewer found no product defect. Its extra retained-acquisition-pin test catches removal of the missing-original guard (mutant RED, original GREEN); test promoted into the following preparation batch.
