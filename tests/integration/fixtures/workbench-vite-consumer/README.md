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

Application storage owns `snapshotState:{store,key}` (key includes namespace/root).
First `prepare({snapshot,files})` applies to empty payload targets, records the
applied ID, then writes sources. Same ID opens saved files without snapshot fetch;
omit initial files on reopen so actual agent edits survive. A changed ID forces
payload targets; untargeted files may survive, which is not a dependency claim.

Save the actual post-agent package.json in the app's canonical source storage.
For a deploy, choose the desired manifest (including any intended template changes),
then call `prepare({snapshot:newSnapshot,files:{'package.json':savedDesiredBytes},
install:{registryUrl}})`. This restores manifest/lock and actual dependency bytes
through the existing installer; no implicit manifest merge. Explicit files/install
always run, even when the ID already matches after a prior reconciliation error.
The marker describes successful apply only; partial apply or marker-write failures
remain loud and can require the app's explicit force operation. No rollback added.

Agent calls bypass the host's single promise chain. `host.call` sequences only
app actions, preserving SDK busy rejection while the agent builds. Read runtime
phases/counts directly, and render the exported transcript model through callbacks.
`normalizeTerminalLines` affects display only; `downloadTrace` saves the native trace.

`reference-host-browser-proof.mjs` drives real packed Pi/Worker/Vite through both
registry configurations, model switch/string-only HTTP, health-handler edit,
install/build/ordered output, busy retry, saved reopen/deploy and another tab's
occupied retry. It also checks tool-call metadata and the displayed transcript.
The existing preview/HMR/resident proofs remain separate baseline coverage.
