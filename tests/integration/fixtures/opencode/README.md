# opencode server-path fixture

A committed, reproducible, version-pinned snapshot of [anomalyco/opencode][repo]'s
**programmatic server path**, vendored the same way rifty vendors `esbuild.wasm`
(see `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs`). Unblocks F01 and
Spike C: bringing up an opencode server facade inside rifty.

- **Pinned commit:** `f401f01c05bead2fd0687004c912743d271e2b7b` (branch `dev`)
- **License:** MIT — see [`source/LICENSE`](./source/LICENSE) (opencode is MIT)
- **Vendor/refresh script:** `tools/shadow-registry/scripts/fetch-opencode.mjs`

## What is vendored (the "server path")

The target is the **programmatic** entrypoint only:

```ts
import { Server } from "opencode/server/server"   // -> source/packages/opencode/src/server/server.ts
Server.listen(opts)
```

NOT the CLI (`packages/opencode/src/index.ts`), which has a top-level
`drizzle-orm/bun-sqlite` import that `require()`s `bun:sqlite` and crashes at
import time outside Bun. Console/TUI, web, desktop, SDK codegen, SST infra and
stats packages are pruned.

### `source/`

The pinned source. A static import-graph trace from `server/server.ts`
(following only static `import/export … from`, resolving `@/` -> `./src/*`, the
`#` imports map under the **`node`** condition, and crossing every
`@opencode-ai/*` workspace boundary whose exports are `"./*": "./src/*.ts"`)
reaches **470 internal `.ts` files** across SIX workspace packages:

| package                          | traced files | vendored as                              |
| -------------------------------- | -----------: | ---------------------------------------- |
| `opencode`                       |          306 | `source/packages/opencode/`              |
| `@opencode-ai/core`              |          120 | `source/packages/core/`                  |
| `@opencode-ai/llm`               |           25 | `source/packages/llm/`                   |
| `@opencode-ai/effect-drizzle-sqlite` |       16 | `source/packages/effect-drizzle-sqlite/` |
| `@opencode-ai/sdk`               |            2 | `source/packages/sdk/js/`                |
| `@opencode-ai/plugin`            |            1 | `source/packages/plugin/`                |

plus 5 audio assets imported via `@opencode-ai/ui/audio/*`
(`source/packages/ui/src/assets/audio/`).

**We copy each needed package's whole `src/`** (a superset of the traced 470), not
a trimmed file set, because the regex tracer cannot follow non-TS asset imports
(`.txt`/`.sql`/`.md` prompt + schema files), `.js`-specifier rewrites (NodeNext
style — e.g. `./client.js` -> `client.ts`), or runtime dynamic `import()`. The
upstream `packages/<name>/` layout and each package's `package.json` +
`tsconfig.json` are preserved so all `@opencode-ai/*` export maps resolve.

`workspace:*` refs are NOT npm dependencies — they ARE this vendored source, so
they are absent from the dependency manifest.

### `facade-manifest.json` + `facade-manifest.lock.json`

The flattened EXTERNAL npm closure of the server path, as a standalone manifest:

- `catalog:` refs resolved to concrete versions from opencode's root
  `package.json` `workspaces.catalog`; semver ranges pinned to the catalog
  concrete (e.g. `semver ^7.6.3` -> `7.7.4`).
- `workspace:*` refs dropped (vendored as source above).
- 4 native/wasm packages in `optionalDependencies` so a native build failure
  cannot abort the install (all 4 resolved as platform prebuilds at pin time).
- Concrete `@ai-sdk/*` providers and cloud credential libs are **dropped**:
  `provider/provider.ts` loads them via runtime-gated dynamic `import()`
  (fetch-on-demand), so they are not part of the import-time closure.

`facade-manifest.json` and `deps/package.json` are identical; `deps/` is the
install root used by `npm ci`.

## Dependency tree (`node_modules`) — NOT committed

The materialized `node_modules` is **~217 MB** and is intentionally NOT in the
repo (see `.gitignore`). The committed lockfile reproduces it deterministically:

```bash
# from this directory
cd deps && npm ci          # 327 packages, exit 0 (verified)
```

or re-vendor everything (re-clones source at the pinned SHA and installs):

```bash
node tools/shadow-registry/scripts/fetch-opencode.mjs
```

## Honest caveats

- This is a Bun monorepo using `catalog:`/`workspace:` protocols. The dependency
  manifest above is a *hand-flattened* projection of opencode's workspace into a
  plain npm manifest; it resolves under `npm ci` but is not opencode's own
  install graph.
- The fixture is **data, not part of rifty's workspace build** — it is excluded
  from `tsconfig`/workspace globs and is not typechecked or built by rifty.
- The source is captured at one SHA; opencode's `dev` branch moves. Bump
  `PINNED_SHA` in the fetch script and re-run to refresh.

[repo]: https://github.com/anomalyco/opencode
