# Sass embedded Contract+RED

Recorded 2026-08-02 from fresh
`main@b01a34bef711585c23fe9d66a563f0ba0010e0d9`, including protocol-v2 replay
authority merged by PR #240. The complete Sass test carrier is
`839d0dab1c1f0802013ec5ec94fe87c1ee42fd7e`; no production source differs
from the fresh baseline. Slice `sass-scale-proof` keeps Budget `1000–3000`
and adds no resolver, cache, lock writer, scheduler, asset capability, or
package-specific generic branch.

## External oracles

Node v24.16.0 runs the committed shared nine-row probe against exact public
`sass@1.100.0` and `sass-embedded@1.100.0`. The generator re-checks package
identity, entry bytes, complete normalized transcripts, and two isolated
2,000 ms deadlock attempts per implementation. Commands, output, versions,
and SHA-256 facts are pinned in
`sass-1.100.0-node-differential.md`; its independent evidence suite is 3/3
GREEN.

Node v24.16.0 with npm 11.17.0 installed exact Vite 7.3.6 and
`sass-embedded@1.100.0` into two isolated fresh trees, then replayed one with
`npm ci --ignore-scripts --offline`. All three locks and builds were
byte-identical. The normalized oracle pins the exact 63-byte CSS SHA-256
`c679544c3b4695a1fe14921735a18157522f56a3bf6ab3e681a95ffad6401fa3`,
four build files, one warning, lockfile-v3 facts, and the absence of an
external CSS map. Reproduction and the raw-oracle digest are in
`sass-vite-7.3.6-node-build.md`.

The official Sass packument, exact npm tarball, required closure, ranges,
versions, integrity, per-archive size/SHA-256, and omitted
`@parcel/watcher@^2.4.1` projection are pinned in
`sass-1.100.0-packument.md`. Installer positives read those official archives
through a test-only TAR parser independent of npm-client extraction; generated
archives are mutation carriers only.

## Executable checkpoint

```sh
pnpm --filter @riftydev/shadow-registry exec vitest run \
  src/internal/catalog.contract.test.ts \
  src/internal/catalog-v2-data-authority.contract.test.ts \
  src/index.test.ts \
  src/sass-capsule.contract.test.ts \
  src/sass-contract-evidence.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-sass-embedded-substitution.contract.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/registry.fault.test.ts
pnpm --filter @riftydev/workbench exec vitest run \
  src/workers/owner-package-shadow-assets.contract.test.ts
pnpm exec vitest run \
  tools/checks/runtime-adapter-boundary.test.ts \
  tools/checks/sass-compat-matrix.contract.test.ts
pnpm test:browser-unit tests/browser-unit/sass-vite-contract.spec.ts
pnpm test:browser-unit tests/browser-unit/sass-network-measurement.spec.ts
```

The shadow-registry batch is exactly **6 RED / 128 GREEN** across 134 rows.
RED is limited to the absent Sass recipe, redirect, executable capsule, and
owner-decoded catalog row. The official Node differential remains 3/3 GREEN.

The npm-client Sass carrier is exactly **36 RED / 1 GREEN**. The GREEN row
independently verifies every official archive. RED covers six non-exact
requests; eight complete-projection drifts before tarball/effects; root and
nested fresh→offline byte equality; general Eddy; exact lock/trace injection;
parent and required-child immediate/corrupt/partial/stall/offline-cache
failures; and facade/bin abort, `ENOSPC`, and `EACCES` reconciliation. Every
success/fault path fixes exact registry, cache, VFS, tree, report, lock, and
provenance ledgers. The inherited registry boundary is 8/8 GREEN, including
packument/tarball stalls, the 128 MiB byte cap, slow progress, retry, and body
cancellation.

Workbench is **1 RED / 2 GREEN**: the real owner path reaches native registry
metadata because the recipe is absent. Its Sass row supplies a fail-if-called
asset boundary and creates no manager/store/MessagePort carrier; existing
asset reuse and same-project physical FIFO remain GREEN.

The generic boundary/compat batch is **5 RED / 4 GREEN**. Four boundary REDs
require the frozen registry-to-runtime Sass-forbidden surface and reject an
aliased predicate, named recipe identifier, and split literal. The compat RED
is only the absent generated public matrix. The existing executable boundary
remains GREEN across all 17 generic consumers.

Real Chromium has one intended Vite RED: the install records 25 forbidden
native-carrier/platform/watcher registry requests before the absent recipe
stops acceptance. The same test already carries direct CJS/ESM, dev/HMR,
exact Node build facts, raw lock/provenance replay, durable offline reopen,
and repeated offline dev/HMR/build assertions behind that first gate. The
measurement test has one intended RED because the matched final perf artifact
does not exist before implementation.

The unshadowed Chromium measurement is preserved outside the repository at
SHA-256
`15084a8c18e221a18c9356d946e81d1e406ea903e2b2c3cb68e28a212c795a0a`:
revision `06c24ad9e426b0b0581d4833f806f72979f345c3`, 51 registry responses,
10,223,779 body bytes, 4,800 ms, and the honest pre-substitution
`NotImplementedError('npm-client.bin-collision-reify')` ceiling. Final GREEN
must capture a matched successful row and commit both records without a
threshold.

npm-client, Workbench, and shadow-registry typechecks; Biome; backlog/refs;
runtime-adapter boundary; and diff checks pass. Chromium requires local
loopback permission in the restricted runner; the unrestricted local commands
produce the results above.

## Fault coverage

| Fault class | Reachable proof |
|---|---|
| corrupt-input | re-signed catalog/materialization mutations; all official-manifest maps; lock/trace injections; corrupt/partial parent and child archives |
| observable-order | non-exact admission, projection drift, and CLI reject before forbidden acquisition/publication; importer/logger/compiler order is the shared Node probe |
| provenance-lie | exact official fresh, raw replay, durable reopen, general-Eddy, tree, lock, trace, and zero-native/watcher ledgers |
| unbounded-read | Sass parent/child reached stalls plus inherited 8/8 registry no-progress, byte-cap, retry, and cancellation suite |
| torn-state | parked facade and launcher writes publish no lock/report; exact retry reconciles |
| quota-perm-fail | facade and launcher `ENOSPC`/`EACCES` stay loud and unpublished; exact retry reconciles |
| sibling-drift | one capsule and shared nine-row probe feed both direct CJS/ESM and real Chromium Vite dev/HMR/build/reopen |

The contract prescribes only Sass-owned catalog/facade data, execution of the
existing generic dependency projection, strict replay validation at the
existing planner ingress, and a finite generic source gate. Zero-bundle Sass
does not invent an empty embedded-source carrier; LightningCSS retains its
existing bundled-child topology.
