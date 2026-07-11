# Embed the headless workbench

`@riftydev/workbench` is the browser-only, framework-free session layer for a
host that supplies its own UI. Its public session exposes terminal, preview,
editor, and file-tree controllers through plain methods, snapshots,
subscriptions, and explicit `dispose()`.

## Host contract

The host must:

- serve COOP/COEP so `crossOriginIsolated` and shared-memory process IPC are
  available;
- bundle the `owner-worker`, `kernel-worker`, `node-worker`, and
  `dev-server-worker` package subpaths and inject their emitted URLs;
- inject same-origin service-worker, SQLite WASM, and esbuild WASM URLs;
- serve the preview service worker at a configured scope that contains the host
  page; boot proves the controlling worker with the versioned rifty ping/pong,
  and LIVE is reported only after a real fetch completes through that route;
- inject an explicit npm registry proxy URL. The package has no registry or
  asset-path defaults.

Constructing the session outside a DOM/Worker browser fails loudly. Booting a
second session on the same page fails until the first session has fully
disposed its PTY, workers, and preview routes. OPFS failure is surfaced as a
memory-only storage backend; a failed write or durability barrier rejects.

```ts
import { createWorkbenchSession } from '@riftydev/workbench';

const session = createWorkbenchSession({
  assets: {
    ownerWorkerUrl,
    kernelWorkerUrl,
    nodeWorkerUrl,
    devServerWorkerUrl,
    serviceWorkerUrl,
    sqliteWasmUrl,
    esbuildWasmUrl,
  },
  registry: { registryUrl },
  project: { catalog, starterId, root, workspaceId, setup: 'from-scratch' },
});

const { terminal, preview, editor, files } = await session.boot();
// Bind snapshots/subscriptions to the host UI, then await session.dispose().
```

The project catalog is serializable host data: templates define the real
runtime/install contract, while starters provide the initial files. A host may
overlay starter files in `project.files`; omitted files remain intact.
`project.root` must be a non-root workspace path and cannot target the
profile-wide `/.rifty` metadata namespace. `workspaceId` remains host-visible as
supplied and is encoded injectively into one VFS path segment, so tenant ids
cannot traverse or collide after scoping.

## Verified host boundary

Vite is the only verified bundler host for this release. Browser acceptance
boots the public session with Vite-emitted worker/WASM URLs, runs a real npm
install and Vite dev server, proves the service-worker preview route, saves an
editor change through the owner durability barrier, observes HMR, mutates the
file tree, and disposes the session. The package itself remains plain ESM and
contains no host-bundler Vite dependency/import/plugin or `import.meta.env`
dependency. Project-installed Vite is loaded inside the sandbox from its VFS.

Webpack, Rollup used directly, Parcel, esbuild applications, and other bundler
hosts are **not verified**. Their asset URL syntax and service-worker emission
remain the host's responsibility; this release makes no compatibility claim for
them.

The playground's optional TypeScript language-service relay remains
application-owned and is not part of the workbench controller contract.
