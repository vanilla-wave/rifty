# ADR 0224: Deep Workbench project sessions over generic runtimes

Status: Accepted
Date: 2026-07

> TL;DR: publish one sealed, framework-free `@riftydev/workbench` module whose
> public unit is a project session; Vite is a ready preset over a generic
> project-runtime seam, while host Vite wiring remains in the host composition
> root.

## Context

The embeddable-dev-loop scenario needs the playground's real boot, package
install, terminal, preview, editor/VFS, and teardown behavior without importing
`apps/playground` or Solid. A mechanical export of the existing controllers
would move files but preserve their shallow coordination: lifecycle ownership
would remain split, Vite would leak into the public altitude, and file/install/
PTY races would become consumer-visible API.

The desired experience is still concrete: supply deployment assets and project
files, open a Vite project, then call `.run()`. The abstraction belongs one
level below that convenience. The playground already has three real execution
shapes — Vite dev server, Node server, Node CLI — so `ProjectRuntime` is a
finite shared seam, not a speculative plugin system.

ADR-0003 keeps Solid in the playground. ADR-0078's `ProjectSpec` and ADR-0135's
`Preset.setup` remain playground product models. ADR-0165's durable `Project`,
`Scratch`, and `Starter` remain storage/product concepts. This ADR defines the
public Workbench vocabulary without replacing them.

## Decision

### Module and public surface

- Add `@riftydev/workbench` above runtime, shell, terminal, npm-client, and
  service-worker packages and below apps/framework bindings. It imports no
  playground code, Solid, host-bundler plugin, query import, or
  `import.meta.env`.
- The root exports only `openWorkbench`, `projects`, public options/handles,
  snapshots/results, and errors. Worker entry subpaths are explicit deployment
  assets. Controller constructors, adapter registries, owner ports, glue
  modules, `ProjectSpec`, and foreign `src/internal/*` are not public.
- The browser host resolves Worker/SW/WASM URLs. Vite query syntax such as
  `?worker&url` stays in a Vite host's composition root; it never enters the
  Workbench implementation. Vite is the first verified host bundler. Other
  bundlers are unverified, not implicitly supported.
- Browser construction validates DOM, Worker, cross-origin isolation, Web
  Locks, deployment URLs, and registry URL. Missing capabilities fail loudly.
  One origin-wide exclusive Web Lock named `rifty:workbench:v1` plus a
  page-local claim permits one active Workbench and one active project session
  in v0; contention rejects and a crash releases the origin claim.

### Vocabulary and lifecycle

- `WorkbenchDeployment`: emitted Worker/SW/WASM locations and preview proof
  settings supplied by the host.
- `PackageAcquisition`: required validating `registryUrl` plus optional `eddy`.
  It has no `kind`, `accelerator`, `standard`, or `raw` branch.
- `StoragePolicy`: required `persistence: 'required' | 'preferred' |
  'ephemeral'`; the selected durable/memory backend remains observable.
- `ProjectDefinition<TReady>`: immutable opaque/branded host intent returned
  only by `projects.*`. It is not ADR-0165's durable `Project` or ADR-0078's
  `ProjectSpec`.
- `ProjectSession<TReady>`: the one materialized project's files, documents,
  package state, terminals, and default run. It owns their teardown.
- `ProjectRun<TReady>`: one execution. `run()` claims synchronously;
  `ready` resolves to the preset-specific ready value, `exited` reports the
  exact exit, and stop/close are distinct idempotent operations. `stop()` only
  requests termination; `close()` stops if needed, waits for exit, then detaches.
- `ProjectRuntime<TReady>`: package-internal materialize/start/stop adapter.
  Vite, Node-server, and Node-CLI adapters all implement it. Custom runtime
  registration is not public in v0.

`projects.vite()` is the ready public preset. It accepts project files and
dependencies, supplies the pinned default Vite dependency/start contract, and
returns `ProjectDefinition<PreviewHandle>`. Its `ProjectRun.ready` resolves
only after the controlling rifty service worker and a routed preview request
prove the URL. `viteVersion` is exclusive with other supplied Vite entries;
ambiguous dependency-section declarations reject. No Vite server knobs cross
the public interface.

Node-server and Node-CLI are real package-internal adapters in v0, used by the
Playground and acceptance to prove the base seam. They are not public factories.

Project ids are injectively storage-scoped. Initial files are first-open seeds,
not reopen overlays. Same definition identity reopens the durable tree;
different identity rejects until the inactive stored project is explicitly
deleted. Project close releases project resources but Workbench retains the
origin Web Lock; only Workbench close releases it.

### Configuration and package acquisition

The stable top-level configuration is:

```ts
openWorkbench({
  deployment,
  packageAcquisition: {
    registryUrl,
    eddy: { resolverUrl, bundleBaseUrl, presetPins }, // optional as a whole
  },
  storage: { persistence: 'preferred' },
})
```

`registryUrl` is always present and remains the correctness fallback. Eddy is
one optional, fail-soft optimization: invalid configuration rejects at open;
runtime timeout, parse, integrity, divergence, or coverage failure is visible
and falls through to the validating registry path. `bundleBaseUrl` defaults to
`resolverUrl` per ADR-0195. Host `presetPins` only seed known pins; learned pins
are internal persisted profile state.

One owner-realm acquisition authority serializes dependency-tree reuse,
snapshot restore, automatic ensure, terminal installs, manifest changes, and
tree reset. Selection is existing valid tree → exact verified snapshot →
covering lockfile → Eddy when configured → registry. Its result distinguishes
tree outcome (`existing | snapshot | installed`), resolution evidence
(`lockfile | metadata`), and per-package transport (`cache | eddy | registry`),
so mixed installs cannot be reported as one misleading enum.

Snapshot verification/application belongs to Workbench acquisition. Trusted
snapshot descriptors may come only from a built-in preset or the one-way
playground adapter; arbitrary host snapshot URLs are not root configuration.
The public Vite preset works without a snapshot through Eddy/registry.

### State authorities

- One owner-resident revision authority assigns a monotonic tree revision and
  opaque per-path versions for every VFS mutation, including guest `fs`, npm,
  snapshot, SCM, seed, and host writes. Every reflected snapshot carries the
  owner revision.
- One `VfsCommitCoordinator` per project handles host-originated files CRUD and
  document saves. A conditional commit resolves only after owner ACK, a
  reflected revision at or beyond that ACK, and the applicable durability
  barrier. Every host CRUD call supplies exact expected versions; no
  unconditional host write exists in v0. Document save always uses its opened
  version; dirty close requires explicit save or discard. Guest/package writers
  remain owner-side, not fake page-side coordinator clients.
- One owner-resident `PtySessionActor` per terminal owns open, synchronous run
  claim, stdin data/EOF, latched pre-ready resize, running process, stop, close,
  and exit. Host `write(string | Uint8Array)`/`end()` queue in order before
  readiness; EOF is idempotent and later writes reject. Closing one terminal
  never closes siblings.
- Logical Node IPC disconnect is separate from the physical process-control
  port. Resize/control remains live until process exit. ADR-0225 and ADR-0230
  define the resize and stdin mechanisms; ADR-0231 protects recursive worker
  bootstrap configuration from Node-faithful user env replacement.
- The existing owner PreviewRegistry remains the sole producer of LIVE state;
  Workbench reports it but never synthesizes readiness.

### Playground migration

The migration is one-way:

```text
Playground ProjectSpec + Starter/Preset policy
                       ↓
            Workbench ProjectDefinition
                       ↓
                 ProjectRuntime
```

ADR-0078 stays playground-internal. ADR-0135's `instant | from-scratch` remains
playground Starter/gallery behavior and is not exposed as Workbench acquisition
configuration. ADR-0165 reset remains whole-workspace reseed, not a public
synonym for a cold install. The adapter may supply trusted snapshot metadata
and an initial materialization plan but never becomes a second state owner.

## Consequences

- Consumers get the concrete `projects.vite(files).run()` path without a
  Vite-shaped top-level module; Node server/CLI exercise the same base lifecycle.
- The deep seam hides concurrency, durability, acquisition, preview proof, and
  worker protocols instead of exporting their coordination burden.
- Playground dogfood and a packed external Chromium consumer are required drift
  oracles. The extraction is complete only when app-local duplicate behavior is
  deleted.
- Multiple Workbenches/projects per origin, SSR, custom runtimes, raw TTY, and
  unverified host bundlers stay explicit unsupported gaps; none silently
  degrade.
- External npm publication remains a separate confirm-first release action.
