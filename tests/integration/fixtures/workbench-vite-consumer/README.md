# Packed Workbench Vite consumer

External browser host that imports only published package subpaths. The
acceptance lane packs the Workbench dependency closure, installs every package
from local tarballs, builds this fixture, and runs the production output in a
fresh Chromium process.

The journey opens real Vite 7.3.6 from a loopback registry, proves preview and
native HMR, and executes `node:sqlite` using the copied Workbench asset, without
a direct host sql.js dependency. A fresh context restores the produced Vite
snapshot, runs build/dev/HMR and recursive Node with no SQLite URL or deployed
SQLite WASM. SQLite use then names the missing option. esbuild runtime bytes
come only from the admitted shadow-registry capability.

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

## Shared no-COI agent host

`src/host.ts` is the copyable composition used by this packed consumer and
`tools/agent-bench/src/no-coi-page.ts`. Supply copied worker/probe URLs, namespace,
root, a catalog model and API key, optional registry/policy values, and UI callbacks.
Only `modes.nonCoi` determines support; disposable service-worker probe rows do
not imply a runtime service worker. Defaults are unrestricted inside the project
root and the agent's100-call/600-second limits. Text-only content is a model flag.

Initial `prepare({snapshot,files})` applies the supplied snapshot with SDK
conflict behavior, then writes supplied sources. `install:{registryUrl}` is an
optional explicit initial install. No applied-ID storage, automatic force,
manifest reconciliation or replacement initialization marker (ADR-0490).

Saved reopen uses `host.call(() => host.sandbox.toolchain.open({cwd: root}))`.
Do not repeat initial source preparation on reopen: explicitly supplied files
are written each time. Snapshot checksum validation and explicit SDK force are
unchanged; any further deployment policy belongs to the application.

Agent calls bypass the host's single promise chain. `host.call` sequences only
app actions, preserving SDK busy rejection while the agent builds. Read runtime
phases/counts directly, and render the exported transcript model through callbacks.
`normalizeTerminalLines` affects display only; `downloadTrace` saves the native trace.

`reference-host-browser-proof.mjs` drives real packed Pi/Worker/Vite through both
registry configurations, model switch/string-only HTTP, health-handler edit,
install/build/ordered output, busy retry, saved reopen and another tab's
occupied retry. It also checks tool-call metadata and the displayed transcript.
The existing preview/HMR/resident proofs remain separate baseline coverage.
