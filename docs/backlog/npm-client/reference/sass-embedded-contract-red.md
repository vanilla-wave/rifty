# Sass embedded Contract+RED

Re-recorded 2026-08-03 from fresh
`main@2df89ddea7b5eb2d494ba2c9f4b229a8e6e4a970`, including the exact
constructor-liveness authority merged by PR #241. The refined base carrier is
`850fe429a9e310e694022491a3214f7a78c6de1f`; constructor pre-target behavior
is added by `6fb90d0ffa437115134e3159859ee9880a0c2b55`. No production source differs
from the fresh baseline. Slice `sass-scale-proof` keeps Budget
`1000–3000` and adds no resolver, cache, lock writer, scheduler, asset
capability, or package-specific generic branch.

The first fresh checkpoint blocked ADR-0310's generic “unproven API” gap as
impossible to detect honestly at runtime. A decision subagent superseded it
with ADR-0344: only finite named rows publish positive compatibility; a newly
observed mismatch is RED-first or becomes a specific reachable gap. Exact
liveness evidence then falsified direct-construction parity: embedded starts a
refed Dart child before rejecting, while pure Sass exits. The user selected
option A on 2026-08-03. The positive lifecycle row now covers only initialized
compiler path/string compilation, disposal outcomes, post-dispose errors, and
`instanceof` anchors; direct CJS/ESM construction is the explicit compat ❌
`NotImplementedError('sass-embedded.compiler-construction-liveness')` before
target construction or any active resource.

## Post-ready carrier re-cut

The first product browser run exposed a false carrier path, not a Sass
lifecycle gap. Owner storage path `/scratch/.sass-compiler.scss` is guest path
`/.sass-compiler.scss`; the old guest `/scratch/...` double-rooted through
`ProjectTerminalFsSync` and threw `ENOENT`. A temporary direct-entry await made
that detached rejection visible and was removed: Node ignores exported module
Promises, while routed-import and Sass `setImmediate` refs already carry the
successful run to completion. The later tree-inventory output uses the same
guest `/` versus owner `/scratch` mapping. Runtime guards pin both facts.

The corrected detached CJS run writes its complete transcript. Its remaining
RED is exact facade output: pure Sass humanizes `file:///contract/...`
relative to guest cwd `/`, while exact `sass-embedded@1.100.0` retains the
absolute file path in exception and logger stacks. A same-PTY rerun also proves
that pure Sass adds ANSI SGR bytes to two error fields where exact
`sass-embedded@1.100.0` does not. The raw shared probe retains both observable
differences; path and color adaptation belong only in the shipped facade.

The next Chromium pass reached Vite's lock assertion and exposed a second
false carrier: the installer test built `packages[""]#dependencies` from every
flat hoisted package. npm 11's twice-checked Vite lock keeps only the root
project's declared maps and requested ranges there. The corrected RED retains
the complete transitive package entries while rejecting their promotion to
root dependency authority.

The corrected selector probe also found that Sass requires both
`process.versions.node` for its Node bootstrap and `process.release.name ===
'node'` for the Node path API. ADR-0345 records the exact release identity;
the process compatibility row remains partial for unrelated missing fields.

The same full Vite closure activates the established esbuild recipe. Its
provenance therefore contains exactly the Sass and esbuild substitutions; the
old length-one assertion confused the slice under test with the complete
data-driven trace. Replay must preserve both facts byte-for-byte.

## External oracles

Node v24.16.0 runs the committed shared nine-row probe against exact public
`sass@1.100.0` and `sass-embedded@1.100.0`. The generator re-checks package
identity, entry bytes, complete normalized transcripts, and two isolated
2,000 ms deadlock attempts per implementation. Commands, output, versions,
and SHA-256 facts are pinned in
`sass-1.100.0-node-differential.md`; its independent evidence suite is 3/3
GREEN.

The independent constructor-liveness evidence is 1/1 GREEN. Its exact
CJS/ESM × sync/async × two-attempt artifact retains the real embedded Dart
child/process-group proof. `sassFacadeContract()` changes only rifty's two
selected gap surfaces: sync/async direct construction and CJS/ESM sync/async
internal reflection. It does not rewrite the external oracle fixtures.

Fresh post-ready audit carrier
`4c57343215c643e728061267770b554fc16f5537`, completed by
`266dfd38cef279090a4c724157fa9c2edf7bba14`,
`76f4f735642b2fccd85571320a382f9d0fce7b6d`, and
`ee7b62ad8731fd5a8ad6a9c1cc30e4d24717db07`, then finalized by
`5628be3cc460832296b01359bbcd4e9efb02f1e1`, extends that same shared probe with
initialized compiler reflection, complete constructor/prototype/method
identity, cross-instance method identity, lifecycle export accessor facts, and
exact gap feature values. Exact embedded uses its exported length-one class as
the direct prototype constructor and keeps compile/string/dispose reads stable
within and across both compiler kinds. The inherited pure-Sass wrapper is **1
RED / 2 GREEN** in its executable capsule: those facts and all four accessor
exports mismatch while the other two capsule rows remain green. The source fix
must preserve the selected direct-construction gap and every existing lifecycle
transcript.

The same exact CJS/ESM × sync/async oracle pins the embedded-only live process,
dispatcher, compilation, stream, and disposal own fields. Pure Sass exposes a
different internal object, so copying names or returning `undefined` would lie.
The selected no-runtime carrier therefore makes ownKeys and each independent
get/has/own-descriptor access to every finite observed name a second explicit
RED named `sass-embedded.compiler-internal-reflection`, including the exact
`NotImplementedError.feature`; public compiler methods remain in the positive
row. The union probe also pins embedded's absent/false/missing result for the
pure-only `_disposed` name, so no inherited pure-Sass state may leak.

The two normalized transcript JSON files are exact generator-owned bytes and
their two explicit paths are excluded from Biome formatting; the generator's
byte check is authoritative while `pnpm lint` covers every non-generated file.

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
  src/sass-contract-evidence.test.ts \
  src/sass-constructor-liveness-evidence.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-sass-embedded-substitution.contract.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/registry.fault.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-shadow-recipe-v2-replay-authority.contract.test.ts \
  src/installer.test.ts
pnpm --filter @riftydev/runtime-js exec vitest run \
  src/ipc/install-process-identity.test.ts \
  src/builtins/node-entry.test.ts \
  src/module-loader/loader-keepalive.test.ts
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

The shadow-registry batch is exactly **8 RED / 129 GREEN** across 137 rows.
RED is limited to the absent Sass recipe, redirect, three executable capsule
rows, and owner-decoded catalog rows. One capsule row instruments both
constructor exports in the exact official pure-Sass tree, then requires CJS
and ESM direct construction to throw the selected named gap with zero target
constructor entries. The deadlock capsule row first validates the committed
two-attempt embedded deadlock versus pure-Sass throw evidence, then remains RED
on the absent facade-side recipe. The official Node differential remains 3/3
GREEN and constructor-liveness authority is 1/1 GREEN.

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

The final replay carrier is **94 RED / 0 GREEN** before source pickup. All rows
share the intentionally future catalog digest and corrected declared-root-map
fixture; this is one catalog-identity/root-authority RED fan-out, not 94 new
behaviors. The focused general installer carrier is **1 RED / 48 GREEN**: the
single RED rejects the old lock writer's promotion of hoisted transitives to
root authority. The shared `process.release` carrier is **1 RED / 21 GREEN**:
only the absent exact Node v24.0.0 release identity fails; corrected node-entry
and loader keepalive carriers are fully green.

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

Real Chromium has one intended Vite RED after 19.5 s: required OPFS reports the
exact durable storage snapshot and the physical Sass-tarball abort is reached,
but the unshadowed native install incorrectly exits `0`. Behind that exact
failure the same test requires no facade/lock publication, abrupt owner reload
and retry, direct CJS/ESM, dev/HMR, exact Node build facts, raw lock/provenance
replay, a second abrupt durable offline reopen, and repeated offline
dev/HMR/build assertions. The
measurement carrier is GREEN in `capture-before`; default `verify` is the one
intended RED because the matched final perf artifact does not exist before
implementation. `capture-after` remains reserved for the implemented head.

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

npm-client, Workbench, and shadow-registry typechecks; Biome; backlog, arch,
and directory-owner gates; and diff checks pass. runtime-js typecheck is the
expected API RED: only the new test's reads of the absent `NodeProcess.release`
property fail; its executable batch is 1 RED / 21 GREEN as counted above. The
new recursive Sass boundary remains intentionally RED. Chromium requires local
loopback permission in the restricted runner; the unrestricted local commands
produce the results above.

## Fault coverage

| Fault class | Reachable proof |
|---|---|
| corrupt-input | re-signed catalog/materialization mutations; all official-manifest maps; lock/trace injections; corrupt/partial parent and child archives |
| observable-order | the exact official pure-Sass constructor exports are instrumented and CJS/ESM direct construction records zero target entries before the named rejection; the liveness oracle and capsule prove no target resource survives; every observed embedded-only reflection name rejects independently before an absent/fabricated value while `_disposed` remains absent; non-exact admission and projection drift reject before forbidden acquisition/publication; CLI/watch remain loud after facade install; importer/logger/initialized-compiler order is the shared Node probe |
| provenance-lie | exact official fresh, raw replay, durable reopen, general-Eddy, tree, lock, trace, and zero-native/watcher ledgers |
| unbounded-read | Sass parent/child reached stalls plus inherited 8/8 registry no-progress, byte-cap, retry, and cancellation suite |
| torn-state | parked facade and launcher writes publish no lock/report; exact retry reconciles |
| quota-perm-fail | facade and launcher `ENOSPC`/`EACCES` stay loud and unpublished; exact retry reconciles |
| concurrent-same-key | Sass owner FIFO parks the first lock write; both callers converge on one persisted lock, complete v2 trace, and exact materialized bytes |
| sibling-drift | one capsule and shared nine-row probe feed direct CJS/ESM and real Chromium Vite dev/HMR/build/reopen; one helper derives only the selected constructor-liveness and internal-reflection gaps while exact external fixtures and liveness evidence stay unchanged |

The contract prescribes only Sass-owned catalog/facade data, execution of the
existing generic dependency projection, strict replay validation at the
existing planner ingress, and a finite generic source gate. Zero-bundle Sass
does not invent an empty embedded-source carrier; LightningCSS retains its
existing bundled-child topology.
