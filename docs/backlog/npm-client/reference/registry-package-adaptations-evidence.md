# Registry package adaptations — evidence

## Baseline

PR #314 `df3cd222f`; source baseline `c64cb2ebb`. Node v24.16.0, Vitest 2.1.9.

`pnpm exec vitest run packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts packages/workbench/src/workers/vite-node-entry-edge.test.ts packages/workbench/src/workers/package-install-finalizer.test.ts packages/runtime-js/src/internal/worker-globals.test.ts`: 4 files, 42 passed (2026-09-07).

## Finite inventory

| Owner before | Adaptation | Owner after |
|---|---|---|
| Workbench workers | esbuild startup, installed WASM integrity, generated client and FS adapter | registry runtime |
| runtime-js globals | exact esbuild CJS realm identity | registry runtime; facade uses same realm carrier |
| Workbench workers | Vite CLI promise/watch patches, CLI grammar, version gate, info startup suppression, preview/env preparation | registry runtime |
| Workbench workers | emnapi 1.10.0 readable/minified backport, nested lockfile dispatch | registry installed-file preparation |
| Workbench project-definition | Vite 8 napi WASI runtime override | registry manifest preparation; visible manifest preserved |
| Workbench owner-child-dev-server | napi-rs WASI environment | registry launch preparation |
| registry catalog/index | esbuild, LightningCSS, Sass, Rollup, bcrypt substitutions/shims | unchanged registry ownership |
| Workbench files/archive/deps/boot | `.vite` exclusion and Vite provenance on generic work | removed; ordinary files and project provenance |

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
