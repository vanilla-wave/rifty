# Registry package adaptations — evidence

## Baseline

PR #314 `df3cd222f`; source baseline `c64cb2ebb`. Node v24.16.0, Vitest 2.1.9.

`pnpm exec vitest run packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts packages/workbench/src/workers/vite-node-entry-edge.test.ts packages/workbench/src/workers/package-install-finalizer.test.ts packages/runtime-js/src/internal/worker-globals.test.ts`: 4 files, 42 passed (2026-09-07).

## Finite inventory

Classified 2026-10-16 under `docs/process/rules/fault-classes.md` §Guest-package
adaptations (goal `honest-guest-package-adaptations` I3). Owner history: PR #314
moved every row from Workbench/runtime-js to the registry; since then the `.vite`
exclusion (PR #314), the Vite CAC hook (ADR-0530) and the Vite root-watch and
root-URL policies (ADR-0533) are gone. `platform-gap` rows: the starter and default exact Vite pins (the CAC
hook is deleted). Sweep source: `esbuild-runtime-policy.json` `patches`,
`sass-embedded-policy.json`, the substitution catalog, `internalsShims`,
`bakedOverrides`, installed-file and launch preparations in
`tools/shadow-registry/src/runtime/`.

### Executable adaptations (installed bytes, generated twin source)

| Adaptation | Class | Authority | Loud drift anchor | Kill condition |
|---|---|---|---|---|
| esbuild `inline-worker-startup`, `node-callback-fs`, `channel-has-fs`, `runtime-default-wd`, `transform-temp-fs`, `native-validation-provenance`, `native-target-errno` | `substitution-environment` | ADR-0226 D1/D2/D4, ADR-0242 D1/D2, ADR-0421; compat `esbuild-js-api.md` | generation: every anchor matches once in `esbuild-wasm@0.28.0` `lib/browser.js`; `browser.js`, `esbuild.wasm` and validation-source sha256 pinned; policy ids = patcher ids (`esbuild-exact-patcher.mjs`, `generate-esbuild-runtime.ts`, `check:esbuild-runtime-drift`); runtime: installed `esbuild.wasm` length + sha256 (`runtime-adapters.ts`) | none — declared twin environment |
| esbuild `gate-direct-lifecycle`, `gate-sync-family`, `gate-analyze-metafile`, `gate-context-watch-serve`, `gate-one-shot-build-write` | `substitution-environment` (named `NotImplementedError` gates) | ADR-0226 D4; compat `esbuild-js-api.md` | as above | the gated surface implemented |
| esbuild `runtime-service-refs` | `handle-mapping` | ADR-0152 §1 through the host keepalive callback (ADR-0384 D1, ADR-0421); Node analogue `esbuild/lib/main.js:2308-2311` `child.ref()/unref()` | as above | none |
| esbuild facade `esbuild@0.28.0` (`lib/main.cjs`, `bin/esbuild` → `NotImplementedError('esbuild.cli')`), realm carrier `__riftyShadowRegistry.esbuild`, package-path admission | `substitution-environment` | ADR-0226 D3, ADR-0316, ADR-0371, ADR-0384 D2; compat `esbuild-js-api.md`, `incompatible-packages.md` | file, recipe and catalog digests (`catalog:check`); a failed carrier is a throwing getter; an unknown adapter id → `NotImplementedError` | none |
| `@emnapi/core@1.10.0` orphaned-reference guard in `napi_delete_reference`/`napi_reference_unref` (readable + minified) | `backport` | Rolldown WASI 1.1.5 child-thread cleanup: PR #270 real Node 24.16.0 + `NAPI_RS_FORCE_WASI=1` (Rolldown 1.0.3 crashes, 1.1.5 clean); no `@emnapi/core` release carries the guard (1.10.0, 1.11.0, 1.11.3, 2.0.0-beta.2 checked 2026-10-16); ADR-0384 D3 | missing file or drifted/partial anchor throws (`installed-files.ts`, `emnapi-core-install-policy.ts`); snapshot input proof (`check-dep-snapshot-artifacts.ts`); an initial restore prepares the bytes, a later apply source with unprepared bytes is refused (`workbench-snapshot-apply-preparation.contract.test.ts`); other versions are not patched (range: `npm-client/emnapi-orphaned-reference-version-coverage`) | the admitted Vite 8 closure no longer resolves `@emnapi/core@1.10.0` |
| Rollup `dist/native.js` → delegate to `@rollup/wasm-node/dist/native.js` (`internalsShims.rollup`) | `substitution-environment` | ADR-0027, ADR-0188, ADR-0343, ADR-0399; compat `incompatible-packages.md` | range `^4.0.0` refused outside (`shadow-shims.ts`); `@rollup/wasm-node` installed in version lockstep or refused, so the delegate re-exports the same-version upstream WASM build | none |
| LightningCSS facade over `lightningcss-wasm@1.32.0` (recipe `rifty.shadow-substitution.lightningcss.v2`; legacy `internalsShims['lightningcss-wasm']`) | `substitution-environment` | ADR-0156, ADR-0188, ADR-0361, ADR-0371; no compat page (`toolchain-build/lightningcss-compat-matrix-page`) | admission, dependency projection, digests (`npm-client` shadow `admission.ts`/`substitution.ts`); legacy range `^1.32.0` refused outside | legacy shim: the legacy table retires; recipe: none |
| Sass facade `sass-embedded@1.100.0` over `sass@1.100.0` (`sass-embedded-policy.json` ids `clean-export-namespace`, `embedded-info`, `exception-message-prefix`, `exception-span-url`, `absolute-file-stacks`, `embedded-alert-color-default`, `compiler-dispose-errors`, `compiler-identity`, `legacy-logger-routing`; declared divergence `sync-compile-async-importer`; bin gates) | `substitution-environment` | ADR-0344, ADR-0361; compat `sass-embedded.md` | exact-only admission, projection, digests | none |
| Vite 8.0.16 manifest override `@napi-rs/wasm-runtime` → `npm:@napi-rs/wasm-runtime@1.1.6` (visible in the project manifest; a caller value wins) | `upstream-edge` | real npm 11.17.0 + Node, forced WASI: 1.2.0 fails, 1.1.6 works (`docs/backlog/playground/reference/vite8-wasi-runtime-closure-probe.md`); ADR-0336 D1-D5 | exact declaration `8.0.16` only; snapshot manifest equality (`check-dep-snapshot-artifacts.ts`) | the admitted Vite 8 closure imports Rolldown unmodified under forced WASI (ADR-0336 D5 re-proof) |

### Catalog substitutions

| Substitution | Class | Authority | Loud drift anchor | Kill condition |
|---|---|---|---|---|
| `esbuild` → `esbuild-wasm@0.28.0`, `lightningcss` → `lightningcss-wasm@1.32.0`, `sass-embedded` → `sass@1.100.0` (catalog-derived `bakedOverrides`) | `substitution-environment` | the recipes above | recipe admission (exact/semver), digests | none |
| `bcrypt` → `bcryptjs@3.0.3` (`bakedOverrides.bcrypt`) | `substitution-environment` | ADR-0006 D-005, ADR-0051 D2; compat `incompatible-packages.md` (❌ since 2026-10-16) | exact pin `bcryptjs@3.0.3` (2026-10-16; before, the requested range was reused, `bcrypt@5.1.1` → `No matching version for bcryptjs@5.1.1`): every `bcrypt` range resolves that one version, a registry without it fails `No matching version` | **install broken** (Chromium, 2026-10-16, after the pin): `npm install bcrypt` and `bcrypt@5.1.1` → `+ bcryptjs@3.0.3`, then `install failed: Installed package bcrypt has no top-level lock version` (the substitution is not placed at the requested name); repair: `npm-client/bcrypt-substitution-install` |

### Launch preparations (no package bytes changed)

| Preparation | Class | Authority | Loud drift anchor | Kill condition |
|---|---|---|---|---|
| Vite CLI mode grammar (`viteCliMode`), info-mode startup suppression, version gate (`decideViteEsbuildRuntime`: 7.3.6 starts the esbuild twin, 8.x skips, other versions throw), `.bin/vite` preview scope and label | `substitution-environment` (decides when the esbuild twin starts and routes the CLI's listened port into the preview iframe; no guest-visible bytes) | ADR-0174, ADR-0226 D2, ADR-0317, ADR-0384 D2, ADR-0173 §4, ADR-0326; compat `vite-command.md` | version gate throws for an unadmitted Vite version; grammar pinned by Vite 7.3.6 CAC probes (`tests/integration/vite-cli-prep.test.ts`) | grammar, info suppression and version gate: the Vite 7 esbuild twin claim ends; preview scope: none |
| Starter and default exact Vite pins: playground `vite`/`react-vite` seeds `vite@7.3.6` (`DEFAULT_VITE7_VERSION`, PR #341), the `vite8` seed and the Workbench Vite default `8.0.16` (`project-defaults.ts`) | `platform-gap` (keeps the default path inside the 7.3.6 esbuild gate and the 8.0.16 manifest override) | `docs/backlog/distribution/reference/pr-341-starter-version-repair.md`, ADR-0317, ADR-0336; platform item `npm-client/vite-7-3-7-from-scratch-esbuild-refusal` | `apps/playground/src/templates/vite-version.contract.test.ts` pins the Vite 7 seeds (the 8.0.16 pins: the manifest-override row); the version gate throws for any other Vite 7 | the starters declare Vite's own range (`^7` / `^8`) and their lanes pass |
| `NAPI_RS_FORCE_WASI=1` in dev-server children and `.bin/vite` spawns (`launch.ts`, `vite-cli-prep.ts`) | `substitution-environment` (napi-rs's public selector for the published WASI binding; guest-visible env key) | ADR-0534 | a napi-rs loader that cannot load its WASI binding throws with the WASI error in its cause chain (Rolldown 1.0.3 loader); the loader's native-then-WASI fallback runs in the Vite 8 lanes | the Vite 8 lanes and a napi-rs-loaded package pass without the key (`npm-client/napi-rs-force-wasi-launch-env`) |

Runtime worker realm compatibility supplies generic Node/WebIDL globals, not package recognition. npm schema-one recipe ids preserve old persistence rejection. Public Vite project intent, templates, oracles and host build tools may name packages.

## Carrier decision

Independent read-only DEC-2 agent inspected raw source and ADRs. Registry `./runtime` bundles finite implementations; `./` and `./internal` remain data-only. Supply keepalive as a callback; no registry import of Workbench/npm/runtime. Realm-shared registry identity preserves duplicate-bundle identity. Reuse installed-tree bytes, admission and FIFO; no new delivery/cache/coordination authority. See ADR-0384.

## RED

`pnpm exec vitest run packages/workbench/src/workbench/ordinary-package-files.contract.test.ts tools/checks/package-adaptation-ownership.test.ts`: 2 files, 6 failures (2026-09-07). Real owner snapshot omits notes; archive roundtrip drops notes; foreign archive rejects `.vite`. Three ownership checks expose Workbench implementations, runtime package key and generic Vite provenance. No import/typecheck failures.

Contract review corrected the archive fixture: portable archive paths are relative. After changing both archive assertions/fixture to `.vite/notes.txt`, `pnpm exec vitest run packages/workbench/src/workbench/ordinary-package-files.contract.test.ts` still has 3 failures; foreign import now specifically throws `Playground archive path uses reserved segment ".vite"`. Original foreign-import failure was path normalization, not package classification; that original claim is withdrawn.

## Implementation checks

Targeted migration suites: 129 tests passed; scoped package typechecks and `check:arch` passed. Registry owns helper defaults too; Workbench only re-exports them.

Judging criteria changes (ADR-0384 / PR-4): archive/snapshot tests now retain `.vite`; runtime identity tests follow the registry carrier; esbuild replay fixture keeps independently pinned exact bytes/hash with the renamed carrier; extraction provenance points to successor files without dropping original entries; boundary coverage grows to all production Workbench workers. No package semantic row removed.

Express oracle: Node v24.16.0, actual npm express@4.21.2 installed in a disposable workspace; exact `/proof.cjs` guest from `tests/browser-unit/registry-package-ownership.spec.ts` executed with `node proof.cjs` → `200 EXPRESS_REGISTRY_OK`, exit 0. Same program is the browser carrier.

First full `pnpm pr:check`: build/types/arch and Node parity passed; 4 test files failed (98 failures, zero Vitest timeouts), same files reproduced in one isolated rerun. Failures were the old exact facade hash/length, snapshot/archive exclusion expectations and diagnostic prefixes. Compatibility gate also observed the uncommitted generated document change; committed with implementation. These are not reported as a passing full gate.

## Browser acceptance

Chromium `playwright.browser-unit.config.ts`, isolated port 5529, workers=1:

- `esbuild-vite-contract.spec.ts`: all six scenarios passed across initial run and corrected Vite 7 rerun. Direct CJS/ESM identity without Vite, unsupported admission, cache replay, actual Vite8 WASI alias/consumer, build/dev/preview, Vite7 config graph/optimizer/Node differential and offline reopen. Initial stale realm/digest probe references corrected; no semantic expectation weakened.
- `sass-vite-contract.spec.ts`: real Node differential + Vite7 SCSS dev/HMR/build offline passed.
- `workbench-vite-lifecycle.spec.ts`: optional public helper A→B→A, files and HMR passed.
- `registry-package-ownership.spec.ts`: ordinary `npm install` → Express HTTP response → explicit stop; `.vite` file snapshot, archive export/import and persisted owner reopen passed (13.5s).

The initial Express probe omitted the explicit first install (fixture open only prepares deferred materialization). After correcting that, automatic command drain stayed pending after the real 200 response; identical on unchanged `df3cd222f`, Node exits 0. Final server carrier uses user stop after response. This pre-existing automatic-drain gap is recorded in `docs/backlog/runtime-js/express-http-close-command-drain.md`; no new close/drain promise is claimed by the ownership migration.

Headerless `playwright.no-coi.config.ts`, ports 5541–5543, workers=1: 6 passed (2.1m). Generic resident SW preview, memory-tree restart, real Vite HMR/wedge restart, exact OPFS reload, real COI/no-COI dist parity and Vite8 threaded-WASM named rejection.

`pnpm test:client-bundles`: PASS; 15 first-party + 72 external packed tarballs, strict consumer TypeScript/build, generic SDK/Worker graphs and loading proofs. min/gzip bytes: main 56861/18031, SW 14056/4828, generic 725778/213598, toolchain 797038/236458; all existing ceilings preserved.

Final inventory sweep: shell/terminal `real-vite` modes are retained host/persistence discriminators, help text names example programs; WASI package mentions motivate generic syscall behavior. No additional executable guest-package adaptation found outside registry.

`pnpm test:packed-consumer`: PASS (95s); external tarball-only Workbench consumer, TypeScript/build, real Vite preview + HMR in fresh Chromium.

Production `playwright.prod.config.ts`, port 5550, workers=1: 2 passed (36.8s), fresh app build; owner/dev-server LIVE and child global/module Buffer identity preserved.

Final browser probe rerun: 7/7 esbuild/Vite/Express scenarios passed (1.0m). Additional paired Vite8 acceptance: optional Vite helper and ordinary npm-dev-server with explicit compatible manifest/dev script both pass build/dev/preview, real browser rendering, no esbuild fetch/publication (2/2, 30.8s). The shared render helper requires a server project's ready handle; the preliminary node-cli carrier ran its noop and supplied no handle, so the ordinary carrier correctly uses npm-dev-server and its user dev script.

## Final verification

`pnpm pr:check` on `c31cd02ae759a3e6eea7515da33e3297d4f1ab3d`: 25/25 PASS; unit 223.2s, Node parity 60.5s; no failing-file rerun in this final gate. Independent Final+GREEN: 32/32 coverage, zero blockers, goal complete. Reviewer independently ran 111 focused tests and the real Node Express oracle.

Reviewer advisory verified against original `df3cd222f`: standard `snapshots:bake` also resolves PostCSS 8.5.26 → 8.5.28 in all three snapshots (nine package files changed). No added adaptation or override; existing semver ranges selected the newer patch. Real browser/build/packed acceptance above covers the resulting trees. This dependency refresh is part of the delivered artifacts, not claimed as a move-only change.
