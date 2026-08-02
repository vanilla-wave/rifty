# Sass embedded Contract+RED

Recorded 2026-08-02 from fresh
`main@b01a34bef711585c23fe9d66a563f0ba0010e0d9`, including protocol-v2 replay
authority merged by PR #240. The complete Sass test carrier is
`b9c0629ffae7cddd6838b37805a98c87830856ed`; no production source differs
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

Matched measurement capture is explicit and does not depend on the final
artifact:

```sh
RIFTY_SASS_NETWORK_MODE=capture-before \
RIFTY_SASS_NETWORK_REVISION=06c24ad9e426b0b0581d4833f806f72979f345c3 \
RIFTY_SASS_NETWORK_OUTPUT=/tmp/rifty-sass-before.json \
pnpm test:browser-unit tests/browser-unit/sass-network-measurement.spec.ts
RIFTY_SASS_NETWORK_MODE=capture-after \
RIFTY_SASS_NETWORK_REVISION="$(git rev-parse HEAD)" \
RIFTY_SASS_NETWORK_OUTPUT=/tmp/rifty-sass-after.json \
pnpm test:browser-unit tests/browser-unit/sass-network-measurement.spec.ts
RIFTY_SASS_NETWORK_MODE=verify \
pnpm test:browser-unit tests/browser-unit/sass-network-measurement.spec.ts
```

The shadow-registry batch is exactly **7 RED / 128 GREEN** across 135 rows.
RED is limited to the absent Sass recipe, redirect, two executable capsule
rows, and owner-decoded catalog rows. The second capsule row first validates
the committed two-attempt embedded deadlock versus pure-Sass throw evidence,
then remains RED on the absent facade-side recipe. The official Node
differential remains 3/3 GREEN.

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

Workbench is **2 RED / 2 GREEN**: both real Sass owner rows stop at the absent
recipe. The zero-asset row supplies a fail-if-called asset boundary and creates
no manager/store/MessagePort carrier. The Sass FIFO row parks the first real
lock write and, behind that RED gate, pins the persisted lock, complete v2
provenance, and exact facade/package/bin bytes across both callers. Existing
asset reuse and esbuild same-project physical FIFO remain GREEN.

The generic boundary/compat batch is **6 RED / 4 GREEN**. Five boundary REDs
require the frozen registry-to-runtime Sass-forbidden surface and recursive
production-file evaluator, then reject an aliased predicate, named recipe
identifier, and split literal. Synthetic `.test.ts`, `.contract.test.ts`, and
fixture inputs pin the exclusions from that scan. Compat is RED first because
policy remains `contract-red`; the generated public matrix is also absent. The
existing executable boundary remains GREEN across all 17 generic consumers.

Real Chromium has one intended Vite RED after 19.8 s: required OPFS reports the
exact durable storage snapshot and the physical Sass-tarball abort is reached,
but the unshadowed native install incorrectly exits `0`. Behind that exact
failure the same test requires no facade/lock publication, abrupt owner reload
and retry, direct CJS/ESM, dev/HMR, exact Node build facts, raw lock/provenance
replay, a second abrupt durable offline reopen, and repeated offline
dev/HMR/build assertions. The
measurement carrier is GREEN in `capture-before`, intentional RED in
`capture-after` because the unimplemented install exits at the honest bin
collision ceiling, and intentional RED in default `verify` because the matched
final perf artifact does not exist before implementation.

The independently inspectable unshadowed Chromium measurement is committed as
`perf/sass-shadow-substitution-before.json` at SHA-256
`15084a8c18e221a18c9356d946e81d1e406ea903e2b2c3cb68e28a212c795a0a`:
revision `06c24ad9e426b0b0581d4833f806f72979f345c3`, 51 registry responses,
10,223,779 body bytes, 4,800 ms, and the honest pre-substitution
`NotImplementedError('npm-client.bin-collision-reify')` ceiling. Final GREEN
must capture a matched successful row and commit the combined record without
a threshold. `capture-after` bypasses final-artifact verification but still
requires a successful shadowed install; default `verify` requires the committed
before row verbatim inside the final record.

An independent `capture-before` rerun with the command above is GREEN and
reproduces all 51 sorted response records, environment facts, total bytes, and
failure identity exactly. Its wall time is 4,388 ms versus the committed 4,800
ms, confirming why the evidence records time but imposes no threshold.

npm-client, Workbench, and shadow-registry typechecks; Biome; backlog/refs;
the inherited 17-module runtime-adapter boundary; and diff checks pass. The
new recursive Sass boundary remains intentionally RED as counted above.
Chromium requires local loopback permission in the restricted runner; the
unrestricted local commands produce the results above.

## Fault coverage

| Fault class | Reachable proof |
|---|---|
| corrupt-input | re-signed catalog/materialization mutations; all official-manifest maps; lock/trace injections; corrupt/partial parent and child archives |
| observable-order | non-exact admission and projection drift reject before forbidden acquisition/publication; CLI/watch remain loud after facade install; importer/logger/compiler order is the shared Node probe |
| provenance-lie | exact official fresh, raw replay, durable reopen, general-Eddy, tree, lock, trace, and zero-native/watcher ledgers |
| unbounded-read | Sass parent/child reached stalls plus inherited 8/8 registry no-progress, byte-cap, retry, and cancellation suite |
| torn-state | parked facade and launcher writes publish no lock/report; exact retry reconciles |
| quota-perm-fail | facade and launcher `ENOSPC`/`EACCES` stay loud and unpublished; exact retry reconciles |
| concurrent-same-key | Sass owner FIFO parks the first lock write; both callers converge on one persisted lock, complete v2 trace, and exact materialized bytes |
| sibling-drift | one capsule and shared nine-row probe feed both direct CJS/ESM and real Chromium Vite dev/HMR/build/reopen |

The contract prescribes only Sass-owned catalog/facade data, execution of the
existing generic dependency projection, strict replay validation at the
existing planner ingress, and a finite generic source gate. Zero-bundle Sass
does not invent an empty embedded-source carrier; LightningCSS retains its
existing bundled-child topology.
