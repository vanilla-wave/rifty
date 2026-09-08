# @riftydev/workbench

Framework-free embeddable development workbench for rifty. It owns one browser
runtime authority and exposes finite project, session, run, file, document,
terminal, and preview operations.

## Public surface

- `@riftydev/workbench` — sealed generic Vite workbench.
- `@riftydev/workbench/playground` — first-party neutral project plans and
  lifetime-scoped TypeScript, SCM, archive, catalog, and terminal restoration
  tools.
- `owner-worker`, `kernel-worker`, `node-worker`, `dev-server-worker`, and
  `typescript-worker` — host-resolved deployment entries.
- `no-coi-toolchain-worker` — one-Worker SDK exact-manifest/install-bin entry
  for explicit shared-memory-free mode; package identity is not policy.
  Install/activation code loads on first install or restore.

Controllers, owner transports, worker protocols, and `src/internal/*` are not
public. Browser hosts supply Worker, Service Worker, and WASM URLs; package code
contains no bundler query imports or App policy.

## Static runtime assets

Copy the entire published `dist/assets/` directory, including opaque JS chunks:

```js
import { cp } from 'node:fs/promises';

await cp(new URL('./assets/', import.meta.resolve('@riftydev/workbench')),
  'public/rifty', { recursive: true });
```

Use ordinary served URLs in `deployment.workers`: `owner-worker.js`,
`kernel-worker.js`, `node-worker.js`, `dev-server-worker.js`,
`typescript-worker.js`. Set `deployment.serviceWorker.url` to `sw.js` and
`deployment.wasm.sqlite` to `sql-wasm.wasm`. The optional SDK toolchain URL is
`no-coi-toolchain-worker.js`. The kernel resolves its `quickjs.wasm` sibling;
copy one complete package build. No host Worker/SW bundling or builtin aliases.

Serve JS as JavaScript and WASM as `application/wasm`, from a secure context.
Workbench requires cross-origin isolation: `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`
with compatible resource headers). If SW scope extends above its directory,
set `Service-Worker-Allowed` to the intended scope. Existing deployment URL/scope
options still apply. The packed consumer fixture is a complete copy/serve example.

Custom bundler deployments remain supported. QuickJS-backed Node children then
require a host kernel wrapper: import the bundler's
`@jitl/quickjs-wasmfile-release-sync/wasm?url`, publish it under
`QUICKJS_WASM_URL_ENV` from `@riftydev/runtime-js/install-process`, and
statically import `@riftydev/workbench/kernel-worker`. Pass that wrapper's
emitted Worker URL as `deployment.workers.kernel`; using the sealed kernel entry
directly leaves browser QuickJS asset resolution unconfigured (ADR-0352).
Playground's `quickjs-kernel-worker-host.ts` is the reference composition.

See ADR-0263 and ADR-0282.


## Registry policy

Both Workbench entrypoints accept `packageAcquisition: { mode: 'snapshot-only' }`.
Omit registryUrl and Eddy configuration. Fresh projects require a compatible
snapshot; a needed missing/corrupt snapshot rejects with its reason before
startup. Valid saved projects still ignore unused new snapshots. Explicit
`npm install` can replay available lock/cache bytes; required missing bytes fail
without registry/Eddy requests. Local scripts and installed bins remain usable.
Snapshot replay cache carries substitution acquisitions; full npm installs may
need other tarballs.

Existing `{ registryUrl, eddy? }` configuration keeps registry acquisition;
`mode: 'registry'` is optional. This policy does not block guest application
network access. The producer still uses the CI environment's registry.

## Dependency snapshot production

Node22+; only installed packages are needed. Supply a registry accessible to the
CI environment and an npm v3 lockfile. No builder credential manager or new
package compatibility is implied.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { produceDependencySnapshot } from '@riftydev/workbench';

const result = await produceDependencySnapshot({
  templateId: 'my-project',
  packageJsonText: await readFile('package.json', 'utf8'),
  packageLockText: await readFile('package-lock.json', 'utf8'),
  registryUrl: process.argv[2],
});
await writeFile('dependencies.tar.gz', result.archive);
await writeFile('dependencies.json', JSON.stringify({
  snapshotId: result.snapshotId,
  installArtifactIdentity: result.installArtifactIdentity,
}));
```

Ordinary tar lists/extracts `payload/package.json`, `payload/package-lock.json`
and `payload/node_modules/`. `rifty/manifest.json` and `rifty/replay-cache/` are
control data, never project files. SnapshotId hashes decoded tar; gzip delivery
with or without HTTP Content-Encoding works. Legacy v3 JSON/gzip remains readable.

The producer uses the shared canonical manifest spelling without changing its
JSON values. Use the emitted `payload/package.json` bytes when supplying raw
files to a neutral `npm-dev-server` Playground plan; its snapshot descriptor is
`{snapshotId, assetUrl, templateId}`. Preset factories may add policy defaults;
bake the final requested manifest. The packed consumer fixture demonstrates the
public bake → Node reference → browser restore path.

Ordinary output identities must match caller lock pins. Attested native-to-WASM
materialization, fixed source acquisition and bundled children use existing
installer policy. Declared same-version companions, such as Rollup's WASM
companion, are allowed at their verified installed paths; existing companion
pins remain exact. Other new ordinary identities/paths fail before an artifact
is returned. Canonical npm tarball URLs use the configured registry proxy; other pinned
resolved URLs retain their location. Compressed and decoded archives keep the
existing 128 MiB limit.

Playground snapshot plans default to `initial-deployment-only`. After initial
admission, saved files and their current install trust win even when the host
supplies another snapshotId; unused asset bytes are not fetched. Incompatible
saved state fails with files retained. Explicit catalog Reset still reseeds the
whole project.

For a selected update, define/open the project with:

```js
firstMaterialization: {
  kind: 'snapshot',
  snapshot: { snapshotId, assetUrl, templateId },
  application: { mode: 'apply-snapshot', conflict: 'overwrite' },
}
```

Apply evaluates every request, including repeated snapshotId. Its default
conflict policy is `error`: `SnapshotApplicationConflictError.conflictingPaths`
contains project-rooted paths, with no partial payload writes. Equal bytes and
compatible directories coexist. `overwrite` replaces conflicting targets;
untargeted source and local dependency files remain. Metadata/replay cache stays
outside the project payload. See ADR-0394.
