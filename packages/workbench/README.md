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

## Scoped preview

Both entrypoints accept `deployment.previewPrefix`. For a page under `/sandbox/`,
copy the published SW to `/sandbox/sw.js`, set `deployment.serviceWorker` to
`{ url: '/sandbox/sw.js', scope: '/sandbox/' }`, and select
`previewPrefix: '/sandbox/p/'`. Advertised iframe URLs then use
`/sandbox/p/<port>/`; ordinary guest asset, API and HMR URLs stay unchanged.
The copied SW's own directory permits this scope without a root allowance.

An explicit prefix is an absolute pathname within the selected SW scope. Dot
segments and Unicode/spaces normalize; query/fragment, backslash, ASCII controls
and encoded separators reject before deployment effects. The host must serve
the same copied SW bytes with its query intact: Workbench appends reserved
`__rifty_preview_prefix` while preserving existing opaque query bytes. A reserved
key collision rejects. The actual controller must prove the selected prefix.

Omission keeps `/preview/` and the original SW URL, including existing narrow
scope deployments that do not open preview. Initial iframe navigation must be
inside SW scope; this option does not rewrite new out-of-scope document
navigations. See ADR-0409 and the packed consumer's `sandbox/` entry.

## Operation budgets

Both entrypoints accept these `deployment` options, in milliseconds:

| Option | Omitted default | Bounds |
|---|---|---|
| `ownerStartupTimeoutMs` | 30,000 | Owner readiness, including storage mount/preload/catalog; each storage proof step uses the same budget. |
| `projectFileCommitTimeoutMs` | 60,000 per phase; durability acknowledgment 35,000 | File reflection/durability after an applied result, plus its durability acknowledgment and explicit recovery wait. |
| `playgroundRequestTimeoutMs` | 60,000 | Playground SCM/archive/durability/close requests, measured from request send. |
| `ownerOperationSilenceTimeoutMs` | 60,000 | Catalog and other owner-operation silence; real durability progress rearms it, ordinary traffic does not. |
| `previewProbeTimeoutMs` | 3,000 | SW control and advertised-preview HTTP proof; independent of operation budgets. |

Values must be finite numbers, greater than 0 and at most 2,147,483,647. Positive
fractions round upward. Invalid values reject before deployment effects. For
example, a slow host can set startup 90,000, file 95,000, Playground 100,000 and
owner silence 105,000 without patching package output.

Startup measurement begins after lease/SW control admission. File waits before
an applied acknowledgment retain their existing settlement semantics. Tools
that require pending document saves wait for them before sending their request.
These options are not global open/close or guest execution time limits; physical
exit observation still has its independent 30,000 budget. Snapshot acquisition
retains its existing read/byte limits, and TypeScript/PTY policies are unchanged.

An explicit file budget also replaces its shorter 35,000 acknowledgment wait.
The shared native OPFS report wait uses the largest explicit startup/file/
Playground/owner-silence override; with none supplied it stays 30,000. Preview
budget is excluded. This shared value is captured per owner storage instance;
individual outer budgets keep their own start/reset rules.

A timeout never proves that an admitted mutation did not apply. Existing
applied/unknown results remain, mutations are not retried, and late completion
cannot rewrite a settled rejection. Native OPFS reporting timeout keeps the
physical write's lane/path fence until it finishes; late success can heal its
failure report. Owner-silence expiry retains the existing owner termination
policy. See ADR-0410/0360/0358.

## Persistent storage

Set `storage: { persistence: 'required', namespace: 'my-workbench' }` to mount
one OPFS directory as the Workbench root. Both entrypoints support it. All
project, catalog, cache and proof paths stay inside that directory; guest paths
stay unchanged. New selections have no old projects; existing selections retain
their files. Close Workbench before switching; the origin-wide owner lease
still permits one Workbench at a time.

Omit `namespace` to use the historical origin root. No migration or clearing.
The name is one literal component: no empty/blank value, NUL, slash, backslash,
`.` or `..`; other characters and spaces are preserved. Valid ephemeral mode
creates no OPFS directory. Namespace open/proof failures reject required storage
or appear in preferred storage's fallback reason. This is storage addressing;
host-owned storage remains the host's responsibility. After a root is acquired,
preload read failure rejects both required and preferred storage; it cannot
open an empty memory project instead. See ADR-0402/0411.

## Orphan Scratch recovery

When `catalog.createScratch()` finds Scratch files without a catalog reference
or valid recovery journal, it first retains ordinary bytes, then creates the
requested fresh Scratch. Retained data survives persistent reopen. A failed
preservation keeps the original; a later fresh-creation failure keeps the
committed retention. Malformed journals remain preserved and report an error.

```js
for (const { id } of await workbench.playground.catalog.listRetainedScratch()) {
  const recoveryJson = await workbench.playground.catalog.exportRetainedScratch(id);
}
```

These calls need no live project session and do not consume retained data.
The `rifty-scratch-recovery` JSON envelope carries relative paths, empty
directories and base64 file bytes, including `node_modules`, build output and
Git. Workbench private metadata and install claims are excluded; downloaded
bytes carry no runnable project identity or install trust.

Export bounds:16 MiB/file,32 MiB decoded total,48 Mi UTF-16 JSON units,
10,000 files,20,000 visited entries,256 path segments. Overflow rejects while
retained storage remains intact. Preservation copies files independently of
these export allocation limits. See ADR-0406/0407.


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

Producer payloads include the existing Vite and native-adaptation preparation.
An older snapshot missing that preparation is rejected before explicit apply
with a rebake reason; legacy initial restore remains supported (ADR-0412).

Apply evaluates every request, including repeated snapshotId. Its default
conflict policy is `error`: `SnapshotApplicationConflictError.conflictingPaths`
contains project-rooted paths, with no partial payload writes. Equal bytes and
compatible directories coexist. `overwrite` replaces conflicting targets;
untargeted source and local dependency files remain. Metadata/replay cache stays
outside the project payload. See ADR-0394.
