# Packed Workbench Vite consumer

External browser host that imports only published package subpaths. The
acceptance lane packs the Workbench dependency closure, installs every package
from local tarballs, builds this fixture, and runs the production output in a
fresh Chromium process.

The journey opens real Vite 7.3.6 from a loopback registry, proves preview and
native HMR, and executes `node:sqlite`. The host supplies the actual
`sql.js` and `esbuild-wasm` package assets.

TypeScript still checks the consumer sources and all imported public shapes.
`skipLibCheck` isolates a documented pre-existing `@riftydev/io` declaration
inheritance conflict from this Workbench distribution oracle.
The Vite host maps TypeScript's bare Node builtins only to published
`@riftydev/runtime-js` shim subpaths, resolving their ESM exports before Vite
sees TypeScript's CommonJS imports.

Run from the repository root:

```sh
pnpm test:packed-consumer
```
