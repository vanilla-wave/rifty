# @riftydev/workbench

Framework-free, browser-only session controllers for embedding rifty's complete
development loop behind a host application's own UI.

The public surface drives project boot and teardown, PTY terminal I/O, shell
commands and npm installs, dev-server preview state, editor-to-VFS saves, and a
watched file-tree model. State is exposed through snapshots and subscribe
callbacks; every attached controller has explicit teardown. The package imports
no Solid, React, Monaco, or xterm UI surface.

## Host requirements

- A browser page with DOM, module Worker, and service-worker support.
  Construction outside a browser fails loudly. `boot()` requires
  cross-origin isolation (COOP/COEP) and rejects with the shared
  `COI_REQUIRED_MESSAGE` when it is absent, while the capability snapshot stays
  available for the host's fallback UI.
- Host-supplied URLs for the owner, kernel, Node, and dev-server Workers; the
  service worker; and the SQLite and esbuild WASM assets. The npm registry
  endpoint is required, validated before boot, and has no default; resolver
  endpoints are optional.
- A service-worker URL and scope that the host serves on its own origin.
  The scope must contain the host page. Boot first proves the controlling worker
  through rifty's versioned ping/pong; preview becomes LIVE only after a real
  request completes through that route. Registration, control, protocol, scope,
  or round-trip failures remain an error state.
- One active workbench session per page. A second boot throws until the first
  session has fully disposed its workers, PTY, and preview routes.

Vite is the verified host for the initial release. The package is plain ESM and
contains no host-bundler Vite dependency/import/plugin or `import.meta.env`
access; project-installed Vite is loaded from the sandbox VFS. Other bundlers
are not yet claimed as verified.

## Install

```bash
npm install @riftydev/workbench
```

Call `createWorkbenchSession(config: WorkbenchSessionConfig)` from
`@riftydev/workbench`; the returned session exposes terminal, preview, editor,
and files controllers through snapshots, subscriptions, methods, and explicit
`dispose()`.

Bundle these package entry points as host assets and pass their emitted URLs in
`config.assets`:

- `@riftydev/workbench/owner-worker`
- `@riftydev/workbench/kernel-worker`
- `@riftydev/workbench/node-worker`
- `@riftydev/workbench/dev-server-worker`

The host also supplies its emitted service-worker, SQLite WASM, and esbuild
WASM URLs. The package never guesses public paths or reads host environment
variables.

`project.root` cannot be `/` or the profile-wide `/.rifty` namespace.
`workspaceId` is encoded injectively into one VFS segment, preventing path
traversal and lossy tenant collisions while preserving ordinary UUID-style ids.

## License

MIT
