# ADR 0263: Workbench Playground companion subpath

Status: Accepted
Date: 2026-07
Supersedes: ADR-0224

> TL;DR: publish a sealed framework-free Workbench root plus one finite
> `@riftydev/workbench/playground` companion. The companion maps first-party
> plans to internal Vite/Node runtimes and exposes lifetime-scoped Playground
> tools without exposing the owner, protocols, or a generic extension system.

## Context

The embeddable-dev-loop needs the Playground's real boot, package acquisition,
terminal, preview, file/document, and teardown behavior without exporting its
controllers. A mechanical controller export would keep mutable ownership split
and make Vite, owner ports, and coordination races consumer API.

The generic consumer path is concrete: provide deployment assets and files,
open a Vite project, then call `.run()`. The implementation also has three real
execution shapes: Vite, Node server, and Node CLI. They share one finite
package-internal `ProjectRuntime<TReady>` seam; custom runtime registration is
not public.

ADR-0224 sealed the root and kept Node factories internal. Contract+RED work
then exposed two incompatible assumptions in its Playground migration:

- after extraction the Playground may import only exported package subpaths,
  but no exported API can construct the internal Node-server/CLI definitions;
- TypeScript, SCM, durable project catalog, and archive operations require the
  same owner-authoritative tree, including `.git` and `node_modules`, while the
  root correctly forbids raw owner ports and extension registries.

Public Node factories solve only the first problem. Rebuilding the other tools
over a shallow file mirror would create a second state owner; exporting the raw
owner would export the coordination burden. Adding every first-party tool to
the generic root would broaden its stable API more than one explicit companion.

ADR-0003 keeps Solid in the app. ADR-0078's `ProjectSpec`, ADR-0135's
`Preset.setup`, and ADR-0165's `Project`/`Scratch`/`Starter` remain Playground
product models. ADR-0185 keeps `.git` owner-only. This ADR replaces ADR-0224
and grafts its remaining module, lifecycle, acquisition, and state-authority
decisions unchanged.

## Decision

### Package surface

- Add `@riftydev/workbench` above runtime, shell, terminal, npm-client,
  service-worker, git, and TypeScript-service packages and below apps/framework
  bindings. It imports no app code, Solid, bundler query import, or
  `import.meta.env`.
- The root exports only `openWorkbench`, `projects.vite`, public
  options/handles/snapshots/results/errors, and their types.
- Worker deployment entries remain explicit `owner-worker`, `kernel-worker`,
  `node-worker`, and `dev-server-worker` subpaths.
- Add one ordinary published export, `@riftydev/workbench/playground`. It is a
  supported public companion, not private/unstable or omitted from the tarball.
- No controller constructor, generic adapter/extension registry, owner handle,
  owner key/epoch, snapshot port, worker frame, `ProjectSpec`, Solid/Monaco
  type, or foreign `src/internal/*` path is public.
- The browser host resolves Worker/SW/WASM URLs. Bundler query syntax stays in
  the host composition root. Vite is the first verified host bundler; others
  remain explicit unverified gaps.

Correction 2026-07-15 (ADR-0249): host-resolved WASM means host-owned SQLite,
not npm-derived runtime assets. The final runtime-assets join drops `esbuild`
from `WorkbenchDeployment.wasm` after controller extraction; the owner obtains
it through the verified npm pipeline. The sealed root adds semantic
`runtimeAssets.inspect()/clear()` and:

```ts
interface WorkbenchProjectOpenOptions {
  readonly onRuntimeAssetProgress?: (progress: RuntimeAssetProgress) => void
}

interface PlaygroundProjectOpenOptions
  extends WorkbenchProjectOpenOptions {
  readonly initialTerminalState?: ProjectTerminalSnapshot
}
```

Correction 2026-07-17 (ADR-0249): private storage/admin and acquisition/
admission may land first through the current app-local owner interfaces and now
block mechanical controller extraction. The deployment-field removal and
runtime-reader cutover remain post-extraction.

The companion forwards both fields. Generic open and companion trusted/snapshot
open may report assets before project-opened. ADR-0278 cold install/fallback
still happens visibly in first `session.run()`; its terminal owns asset progress
and the open callback is not retained. Manager/storage/protocol internals remain
non-public.

The companion exposes one composition entry and clone-safe neutral plans:

```ts
openPlaygroundWorkbench(options): Promise<PlaygroundWorkbench>

type PlaygroundProjectPlan =
  | VitePlaygroundPlan
  | NodeServerPlaygroundPlan
  | NodeCliPlaygroundPlan

interface PlaygroundWorkbench extends Workbench {
  readonly playground: {
    define(plan: VitePlaygroundPlan): ProjectDefinition<PreviewHandle>
    define(plan: NodeServerPlaygroundPlan): ProjectDefinition<PreviewHandle>
    define(plan: NodeCliPlaygroundPlan): ProjectDefinition<void>
    readonly catalog: PlaygroundProjectCatalog
    forSession<T>(session: ProjectSession<T>): PlaygroundSessionTools
  }
}
```

Plans contain only finite runtime data: project id/files/dependencies, Node
entry path, server port or CLI arguments, and first-materialization intent.
They contain no callback, custom runtime, adapter registry, arbitrary snapshot
URL, `ProjectSpec`, or UI type. A trusted snapshot descriptor is accepted only
inside an exact validated first-materialization plan.

`playground.define()` is the only exported path to package-internal Node-server
and Node-CLI definition factories. `forSession()` accepts only a live session
created by that Workbench, checked through package-private identity; forged,
foreign, and closed sessions reject. It returns semantic lifetime-scoped TS,
SCM, and archive handles, never their owner transport. Catalog methods expose
ADR-0165 operations, not index keys or transport frames. Session close closes
these tools before core resources; Workbench still owns exactly one owner.

The companion may import lower packages such as git and TypeScript service. It
must never import `apps/playground`. The app retains one one-way mapper:

```text
ProjectSpec + Starter/Preset policy
                  ↓
       PlaygroundProjectPlan
                  ↓
 internal ProjectDefinition + ProjectRuntime
```

### Generic vocabulary and lifecycle

- `WorkbenchDeployment` is host-supplied Worker/SW/WASM locations plus preview
  proof settings.
- `PackageAcquisition` is a required validating `registryUrl` plus optional
  Eddy accelerator; it has no mode/kind/raw branch.
- `StoragePolicy` is `required | preferred | ephemeral`; selected backend and
  durability remain observable.
- `ProjectDefinition<TReady>` is immutable opaque consumer intent constructed
  only by an exported finite factory. It is not ADR-0165's durable `Project`.
- `ProjectSession<TReady>` owns one materialized project's files, documents,
  package state, terminals, default run, and teardown.
- `ProjectRun<TReady>` owns one execution. `run()` claims synchronously;
  `ready`, exact physical `exited`, idempotent `stop()`, and idempotent
  stop/wait/detach `close()` have distinct contracts.
- `ProjectRuntime<TReady>` remains package-internal. Vite, Node-server, and
  Node-CLI implement it; there is no public custom runtime registration.

`projects.vite()` accepts files/dependencies and returns
`ProjectDefinition<PreviewHandle>`. Readiness requires the exact controlling
rifty service worker plus a routed HTTP proof. Vite version declarations remain
unambiguous and server-construction knobs stay internal.

Project ids are injectively storage-scoped. Initial files seed only first open.
Same identity preserves mutations; different identity rejects until explicit
inactive-project deletion. Project close releases project resources but keeps
the Workbench origin lock; only Workbench close releases it.

Construction validates DOM, Worker, cross-origin isolation, Web Locks,
deployment URLs, and registry configuration before effects. One page claim
plus origin-wide exclusive Web Lock `rifty:workbench:v1` permits one Workbench
and one active project in v0. Contention rejects; crash releases the Web Lock.

**Correction 2026-07-18 (ADR-0293):** callback-null origin contention rejects
with public `WorkbenchOriginOccupiedError`, so a host can distinguish the
ordinary competing-page outcome without matching text. Same-page duplicate
open and every capability/request/initialization failure remain fatal. The
single claim and Workbench-lifetime lease are unchanged.

### Configuration and acquisition

The stable root configuration remains:

```ts
openWorkbench({
  deployment,
  packageAcquisition: {
    registryUrl,
    eddy: { resolverUrl, bundleBaseUrl, presetPins },
  },
  storage: { persistence: 'preferred' },
})
```

The registry is always the correctness fallback. Eddy is a visible fail-soft
optimization; invalid configuration rejects, while runtime timeout, parse,
integrity, divergence, or coverage failure falls through to registry.
`bundleBaseUrl` defaults to `resolverUrl`; host pins only seed known pins.

Before the page claim, host composition snapshots `document.baseURI` as the API
base and `location.href` as the client URL. Every reference resolves once to an
absolute URL before Worker handoff. Worker scripts require client-same-origin
HTTP(S) or `blob:`; `data:` cannot retain cross-origin isolation. Service-worker
script/scope require client-same-origin HTTP(S), strip fragments, reject encoded
path separators, and the scope must prefix the client URL.

WASM assets allow HTTPS, potentially trustworthy loopback/localhost HTTP,
client-same-origin `blob:`, or `data:`. Registry and Eddy allow HTTPS or the same
local HTTP exception; fetch URLs reject credentials. Registry/bundle path bases
reject query/fragment. Resolver fragments reject; a resolver query is valid
only with an explicit query-free `bundleBaseUrl`. Cross-origin HTTPS remains
valid subject to runtime CORS, response, integrity, and MIME/byte checks.

One owner acquisition authority serializes reuse, verified snapshot restore,
automatic ensure, terminal install, manifest mutation, and reset. Selection is
existing valid tree → exact verified snapshot → covering lockfile → Eddy →
registry. Results retain tree, resolution, and per-package transport
provenance. Arbitrary host snapshot URLs are never root configuration.

### State authorities

- One owner revision authority versions every VFS mutation, including guest,
  package, snapshot, SCM, seed, and host writes.
- One page `VfsCommitCoordinator` per project handles only host file CRUD and
  document saves. Success requires owner ACK, reflected revision, and the
  applicable durability barrier. Every write is conditional; dirty document
  close requires explicit save/discard.
- One owner `PtySessionActor` per terminal owns open, run claim, stdin/EOF,
  dimensions, child, stop, close, and exit. Controls are owner-ACKed; siblings
  survive individual terminal close.
- Logical Node IPC disconnect never closes physical process control; resize and
  termination remain live until exit under ADR-0225/0230/0231.
- The owner PreviewRegistry is the sole producer of LIVE state. Workbench never
  synthesizes readiness.
- Companion tools consume these same authorities; none owns a mirror, raw
  owner channel, or second mutation queue.

### Migration and extraction

PR3 uses the future boundary app-locally:

```text
apps/playground/src/workbench/
  public.ts
  playground.ts
  internal/...
```

The app imports only those app-local entrypoints. Before PR3 merges, a temporary
extraction dry-run must succeed by move plus import rewrites. PR4 moves that
tree into `packages/workbench`, adds root/companion/worker exports and package
wiring, deletes app-local copies, and makes no semantic fix.

`instant | from-scratch` remains Playground policy mapped into the companion's
first-materialization plan. Instant may offer only an exact trusted snapshot;
from-scratch does not request one. ADR-0165 reset remains whole-project policy,
not a public cold-install alias.

## Consequences

- Generic consumers retain the small concrete Vite root API.
- The first-party app can exercise real Vite, Node-server, Node-CLI, TS, SCM,
  catalog, and archive behavior through one owner without exposing transports.
- One additional public subpath is a long-lived compatibility commitment; its
  finite neutral plans and semantic tools deliberately contain that cost.
- Playground differential tests and a packed external Chromium consumer are
  required drift oracles. The package must export `./playground` but no
  `src/internal/*` path.
- Multiple Workbenches/projects per origin, SSR, custom runtimes, raw TTY, and
  unverified bundlers remain loud unsupported gaps.
- External npm publication remains a separate confirm-first action.

## Correction 2026-07-16

ADR-0282 replaces the four-worker/extraction detail: the companion host also
supplies a dedicated TypeScript worker, and sealed semantic recovery/durability/
terminal-restore operations replace App imports of package-private functions.
The generic root and every other decision above stand.
