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
