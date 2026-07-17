---
area: distribution
status: ready
title: "@riftydev/workbench — deep browser project sessions"
created: 2026-06-08
why: embedders need one package that owns real project lifecycle, files, packages, terminals, and preview; exporting playground controllers would export their coordination burden and keep Vite above the correct seam
user_story: As a SaaS developer embedding rifty with my own UI, I want to provide project files and call `.run()` on a durable browser project, while Workbench owns the real Node/VFS/PTY lifecycle and exposes no playground or Vite-host internals.
epic: embeddable-dev-loop
blocked_by: [distribution/workbench-runtime-asset-acquisition]
sources: [ADR-0263, ADR-0273, ADR-0275, ADR-0276, ADR-0264, ADR-0225, ADR-0230, ADR-0267, ADR-0078, ADR-0135, ADR-0185]
code: [apps/playground/src/glue, apps/playground/src/orchestration, apps/playground/src/templates, apps/playground/src/workers, packages/kernel/src, packages/runtime-js/src, tests/integration/fixtures/workbench-vite-consumer]
---

## Outcome

Publish one browser-only, framework-free `@riftydev/workbench` deep module for
opening a project, committing real files, acquiring real packages, running it,
attaching terminals, proving preview readiness, and closing every owned
resource.

Vite is the first ready preset, built over the same internal `ProjectRuntime`
lifecycle as Node servers and Node CLIs. A Vite host resolves asset URLs in its
own composition root; there is no `@riftydev/workbench-vite` package and no
Vite plugin/query/env dependency inside Workbench.

PR #136 is an implementation quarry only. Port individual RED tests and useful
mechanisms onto current `main`; do not refactor or cherry-pick its 391-file
megacommit.

ADR-0249's app-local storage and acquisition slices land before this item.
Extraction moves their proven owner/protocol/VFS/package-FIFO semantics with
the rest of Workbench; it must not run against those shared files concurrently
or recreate them behind a migration facade.

## Public contract

The package root exports only:

```ts
openWorkbench(options)
projects.vite(options)
```

It also exports the public option, handle, snapshot/result, and error types.
Worker entries are documented subpath exports:

```text
@riftydev/workbench/owner-worker
@riftydev/workbench/kernel-worker
@riftydev/workbench/node-worker
@riftydev/workbench/dev-server-worker
```

One additional published companion subpath is finite and first-party:

```text
@riftydev/workbench/playground
```

It exports `openPlaygroundWorkbench`, neutral `PlaygroundProjectPlan` types,
and lifetime-scoped semantic Playground tools. It never exports an owner
handle/key/port, protocol frame, `ProjectSpec`, UI type, callback registry, or
custom runtime hook. The generic root remains unchanged.

No controller factory/options, `ProjectSpec`, `ProjectRuntime`, adapter
registry, owner port, worker protocol, Vite server option, glue module, or
`src/internal/*` path is public.

`ProjectDefinition<TReady>` is immutable, opaque/branded consumer intent that
only `projects.*` factories construct. It is distinct from ADR-0078's
playground-only `ProjectSpec` and ADR-0165's durable `Project`.
`ProjectSession<TReady>` owns one materialized project's files, documents,
package state, terminals, and default run. `ProjectRun<TReady>` owns one
execution.

`ProjectSession.run()` claims the run synchronously before any await. A second
run throws `ProjectBusyError` immediately until the prior `ProjectRun.close()`
completes; then the project may run again. `run.ready` is preset-specific:

- Vite/Node-server: resolves to `PreviewHandle` only after SW PONG plus a routed
  HTTP proof;
- Node-CLI: resolves after the child is admitted and can accept input.

`run.exited` resolves the exact `{ code, signal }`. `stop()` idempotently
requests process termination but keeps subscriptions attached. `close()` is an
idempotent stop + wait-for-exit + detach; the example may close a live dev
server directly. Repeated stop/close return the same settled outcome; other
operations after close throw `ClosedHandleError`.

One origin-wide exclusive Web Lock named `rifty:workbench:v1` plus a page-local
claim permits one Workbench and one active ProjectSession in v0. A second open
rejects loudly; after full project close the Workbench may open the next
project. Browser/Worker/COI/Web-Locks absence rejects at `openWorkbench()`.

## Exact configuration

```ts
type WorkbenchOptions = {
  deployment: {
    workers: {
      owner: string
      kernel: string
      node: string
      devServer: string
    }
    serviceWorker: {
      url: string
      scope: string
    }
    wasm: {
      sqlite: string
      esbuild: string
    }
    previewProbeTimeoutMs?: number // defaults to 3_000
  }
  packageAcquisition: {
    registryUrl: string
    eddy?: {
      resolverUrl: string
      bundleBaseUrl?: string
      presetPins?: Readonly<Record<string, string>>
    }
  }
  storage: {
    persistence: 'required' | 'preferred' | 'ephemeral'
  }
}
```

There is no `accelerator.kind`, `standard`, or `raw` mode. `registryUrl` is
required and is always the validating fallback. Eddy is the only supported
optional accelerator; `bundleBaseUrl` defaults to `resolverUrl`. Invalid
configuration rejects at open. Runtime Eddy failure is observable, then falls
through to registry; it never converts a failed verification into success.
Learned pins are internal profile state; `presetPins` contains only host-seeded
initial pins.

`previewProbeTimeoutMs` defaults to the service-worker readiness default of
`3_000`; one bound covers the controlling-worker and routed-HTTP proofs.

Storage behavior is exact:

- `required`: reject if durable OPFS cannot open or its bounded durability
  proof fails;
- `preferred`: try OPFS, otherwise use memory and expose the fallback;
- `ephemeral`: use memory intentionally and never open/reuse OPFS state.

The selected backend and durability state are observable on Workbench/project
snapshots.

## Project definition

`projects.vite()` accepts `id`, project-rooted `files`, `dependencies`,
`devDependencies`, and optional `viteVersion`. Paths start with `/` but are
scoped to the project root; traversal and `/.rifty` access reject. File values
are `string | Uint8Array` and round-trip without text coercion.

If `/package.json` is present, it must parse as an object; explicit
`dependencies`/`devDependencies` options override same-named manifest entries,
while other fields remain. `viteVersion` is mutually exclusive with a `vite`
entry in any supplied manifest/map and, when present, sets final
`devDependencies.vite`. Without it, exactly one final dependencies section may
declare Vite; two sections reject. If neither does, the factory adds pinned
`devDependencies.vite = '8.0.16'`. The adapter invokes installed Vite without
exposing server construction knobs.

Node-server and Node-CLI definitions exercise the same lifecycle in the first
release as package-internal adapters used by the companion and acceptance
fixtures. They are not root factories in v0. Only the finite companion
`define(plan)` path can construct them; there is no generic adapter registry.

`id` is a non-empty host string, injectively encoded into one storage segment;
it is never interpolated as a path. Workbench stores a definition identity over
preset kind/version, initial file bytes, and dependency inputs:

- first durable open seeds/materializes the definition;
- reopen with the same identity preserves every user/package mutation; initial
  files are seeds, never overlays;
- reopen with a different identity rejects `ProjectDefinitionMismatchError`;
  the host chooses a new id or calls `workbench.deleteProject(id)` while no
  session is active, then opens from a clean seed;
- ephemeral/memory-fallback state follows the same rule for the current
  Workbench lifetime and disappears when Workbench closes.

Delete is whole-project and durability-gated. It cannot race an active session.

## Full Vite-host example

Vite syntax is deliberately visible only here, in consumer code:

```ts
import {
  FileConflictError,
  openWorkbench,
  projects,
} from '@riftydev/workbench'

import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url'
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url'
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url'
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url'
import serviceWorkerUrl from '@riftydev/service-worker/sw?url'
import sqliteWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url'

const workbench = await openWorkbench({
  deployment: {
    workers: {
      owner: ownerWorkerUrl,
      kernel: kernelWorkerUrl,
      node: nodeWorkerUrl,
      devServer: devServerWorkerUrl,
    },
    serviceWorker: { url: serviceWorkerUrl, scope: '/' },
    wasm: { sqlite: sqliteWasmUrl, esbuild: esbuildWasmUrl },
  },
  packageAcquisition: {
    registryUrl,
    eddy: eddyResolverUrl
      ? { resolverUrl: eddyResolverUrl, bundleBaseUrl: eddyBundleBaseUrl }
      : undefined,
  },
  storage: { persistence: 'preferred' },
})

const project = await workbench.openProject(projects.vite({
  id: 'hello-vite',
  files: {
    '/index.html': '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
    '/src/main.ts': 'document.querySelector("#app")!.textContent = "hello"',
    '/scripts/echo.mjs': `
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', chunk => process.stdout.write(chunk))
      process.stdin.on('end', () => process.exit(0))
    `,
  },
}))

const created = await project.files.writeFile(
  '/src/message.ts',
  new TextEncoder().encode("export const message = 'hello'"),
  { expectedVersion: null },
)

try {
  await project.files.writeFile(
    '/src/message.ts',
    new TextEncoder().encode("export const message = 'updated'"),
    { expectedVersion: created.version },
  )
} catch (error) {
  if (!(error instanceof FileConflictError)) throw error
}

const document = await project.documents.open('/src/main.ts')
document.replace(`
  import { message } from './message'
  document.querySelector<HTMLDivElement>('#app')!.textContent = message
`)
await document.save()

const run = project.run()
const detachRunOutput = run.terminal.attach(chunk => renderOutput(chunk))
await run.terminal.resize(120, 32) // latched even before child readiness

const preview = await run.ready
previewFrame.src = preview.url

const note = await project.files.writeFile(
  '/note.txt',
  new TextEncoder().encode('remember this'),
  { expectedVersion: null },
)
const moved = await project.files.rename('/note.txt', '/archive.txt', {
  expectedSourceVersion: note.version,
  expectedTargetVersion: null,
})
await project.files.remove('/archive.txt', {
  expectedVersion: moved.version,
})

const shell = project.terminals.open()
const detachShellOutput = shell.attach(chunk => renderOutput(chunk))
await shell.resize(120, 32)
const install = shell.run('npm install nanoid@5.1.5')
await install.exited
await install.close()

const echo = shell.run('node ./scripts/echo.mjs')
await shell.write('hello from host') // queued in order if child is not ready
await shell.end() // explicit EOF; later write rejects StdinClosedError
await echo.exited
await echo.close()

detachShellOutput()
await shell.close()
detachRunOutput()
await run.close()
await document.close() // dirty close would reject unless save/discard is explicit
await project.close()
await workbench.close()
```

Host files CRUD always requires exact expected versions; `null` means the path
must not exist. There is no unconditional host write in v0. Document save is
always conditional on the version captured at open/last save.
`document.close()` rejects while dirty; `close({ dirty: 'save' | 'discard' })`
is the explicit alternative.

## State-owner contracts

### VFS revisions and host commits

One owner-realm revision authority observes every mutation: seed/snapshot,
files API, document save, terminal redirection, guest `fs`, npm/lockfile/
`node_modules`, SCM, reset/import, and child remote-fs. It assigns a monotonic
tree revision plus opaque per-path versions. Same-size/content-summary inference
is forbidden.

One page-side `VfsCommitCoordinator` handles only host-originated files CRUD and
document saves. A commit:

1. sends operation id plus exact expected version(s);
2. owner validates and mutates atomically;
3. owner ACK returns file version plus tree revision;
4. page observes an owner snapshot at or beyond that revision;
5. required/preferred-durable mode crosses the bounded persistence barrier;
6. only then does the caller promise resolve.

Memory mode keeps the same ACK/reflection contract and reports ephemeral
durability. A stale version throws `FileConflictError`; no implicit retry or
last-writer-wins hides the conflict.

### PTY and process control

One owner-resident `PtySessionActor` owns each terminal's open, synchronous run
claim, stdin data/EOF, latched resize, child, stop, close, and exit. Closing one
terminal leaves sibling terminals alive. Owner death closes every pending
operation loudly.

`resize(cols, rows): Promise<void>` throws `RangeError` before transport for
non-positive or non-safe-integer dimensions. A valid call resolves after owner
ACK: before child attach the latest size is latched; while running each size is
applied in order. Calls after close reject `ClosedHandleError`.

After `run()` claims a terminal, `write(string | Uint8Array)` and `end()` may be
called before child readiness. The actor queues calls in order and forwards
each only after the prior owner ACK. `end()` is idempotent EOF for that run;
later writes reject `StdinClosedError`. Stop/close before child attach cancel
queued data loudly and do not affect the physical process-control channel.

ADR-0230 supplies real ordered data, pause/resume, split UTF-8, and EOF.
ADR-0264 supplies owner-ACKed idle dimensions; ADR-0225 supplies live
dimensions/`SIGWINCH`. Logical Node IPC disconnect never closes the physical
process-control channel; resize/control remains until exit.

### Package acquisition

One owner-realm acquisition authority serializes automatic ensure, verified
snapshot restore, terminal installs, package.json edits, clear/reset, and
project switch. It consumes the existing install-stamp authority rather than
inventing a second trust chain.

Selection is valid existing tree → exact verified snapshot → covering lockfile
→ Eddy if configured → validating registry. Provenance is structured:

```ts
type AcquisitionProvenance =
  | { outcome: 'existing'; identity: string }
  | { outcome: 'snapshot'; snapshotId: string; identity: string }
  | {
      outcome: 'installed'
      resolution: 'lockfile' | 'metadata'
      packages: readonly {
        name: string
        version: string
        transport: 'cache' | 'eddy' | 'registry'
      }[]
      eddyFallback?: { reason: string }
    }
```

This exposes existing/snapshot/lockfile/Eddy/registry facts without calling a
mixed install one source.

## Playground migration

ADR-0078 and ADR-0135 remain active. Migration uses one adapter:

```text
Playground ProjectSpec + Starter/Preset.setup
                       ↓
              PlaygroundProjectPlan
                       ↓
            Workbench ProjectDefinition
                       ↓
                 ProjectRuntime
```

`setup: instant | from-scratch` stays Playground product policy mapped by the
one-way app adapter; it is not generic root configuration. Instant may provide
an exact trusted snapshot descriptor in its companion plan. From-scratch never
requests one and preserves explicit first install/reuse. ADR-0165 whole-project
reset is not renamed to "cold install". The companion exposes high-level
catalog/TS/SCM/archive handles over the same captured owner; raw ownership never
crosses the boundary.

## Decisions

- ADR-0263 supersedes ADR-0224 and ratifies the sealed generic root, finite
  published Playground companion, vocabulary, exact configuration,
  cardinality, state authorities, and runtime seam. The implementer does not
  create another Workbench surface.
- ADR-0273 owns the exact files/documents methods, byte-only writes,
  path/result/error semantics, subscriptions, owner-ordered invalidation, and
  the no-owner-evidence boundary.
- ADR-0225/0230/0267 own live resize, stdin/EOF flow, and recursive worker
  bootstrap. Their Node-visible behavior is parity-gated before extraction.
- ADR-0264 owns truthful pre-run resize and preserves ADR-0225's mandatory-rid
  live fence.
- Vite `8.0.16` is the initial built-in default and Vite is the only verified
  host bundler; consumers may explicitly supply another project Vite version.
- Workbench verifies/applies trusted snapshot descriptors but does not expose a
  host snapshot URL or acquisition-adapter registry.
- Node-server/CLI remain finite internal adapters in v0; adding public factories
  is a later public-API decision pulled by a consumer.
- One semantic implementation exists throughout migration. Temporary adapters
  are one-way and removed before the public package is sealed.
- npm publication is not implicit acceptance: pack/dry-run and a clean
  tarball-installed browser consumer close the PR; publish requires approval.

## Delivery plan

Every stateful PR has Contract+RED and Final+GREEN review checkpoints. RED is a
review checkpoint, never a merge state. Every correctness blocker gets a fault
class, a RED test, and a sibling sweep. Repeated class/state owner stops point
fixes and forces redesign/split. Each merged SHA is green; file moves are
mechanical commits separate from behavior.

0. **Decision contract (this docs commit).** Land ADR-0263/0273/0264/0225/0230/0267,
   this ready item, and aligned epic/downstream contracts. No extraction.
1. **Parallel prerequisites.** (A) Restore runtime-js/kernel stdin EOF,
   pause/resume, logical IPC/process-control separation, and recursive bootstrap
   parity. (B) Land the install-stamp authority and bounded OPFS persist
   watchdog. No second trust mechanism.
2. **Parallel state owners.** (A) Add owner-resident `PtySessionActor` and live
   resize. (B) Add owner VFS revision/CAS/durability authority plus the
   host-origin `VfsCommitCoordinator` and document conflict contract.
3. **Package acquisition authority.** Serialize the full package writer set;
   implement structured provenance, snapshot gates, and Eddy→registry fallback.
4. **App-local ProjectRuntime deepening.** Introduce immutable definitions and
   real Vite, Node-server, and Node-CLI adapters; differential-test current
   ProjectSpecs. No package move yet.
5. **App-local deep facade.** Implement `openWorkbench`, project/run/files/
   documents/terminal handles, origin claim, and one-way Playground adapter.
   Repoint the Playground before choosing the package boundary.
6. **Mechanical package extraction.** Move the proven facade/runtime into
   `packages/workbench`; seal root/worker subpaths; delete app-local copies;
   update architecture/publish wiring. Include the landed runtime-asset
   storage/acquisition semantics unchanged. No semantic fixes in move commits.
7. **Acceptance and seal.** Packed-tarball external Vite host; real Chromium
   Vite HMR, Express preview, CLI stdin/exit, storage/fault/teardown cases;
   remove migration-only paths; update compat and CHANGELOG files.
8. **Downstream distribution.** Build React bindings, then the built reference
   embed host. Actual npm publication is a separate explicit approval.

## Acceptance

- Vite consumer supplies files and calls `.run()` without Vite server config;
  SW-proven preview becomes ready and a committed edit produces HMR.
- Express Node-server preview and a pure-JS Node CLI use the same
  internal `ProjectRuntime` lifecycle through real browser fixtures.
- First open seeds; same-identity reopen preserves edits/dependencies; identity
  mismatch rejects; explicit inactive-project delete and reopen starts clean.
- Registry-only, Eddy success, every Eddy decline/failure fallback, final
  registry failure, and structured provenance are real integration tests.
- `required`, `preferred`, and `ephemeral` storage behaviors are observable;
  reload and forced OPFS failure are covered.
- Files/document writes resolve after exact owner reflection and durability;
  conflicts preserve both versions; dirty close cannot discard silently.
- PTY same-tick run, pre-ready/mid-run resize, split UTF-8, pause/resume, EOF,
  logical disconnect, per-terminal close, owner death, and exit are covered.
- Two tabs race open: one wins the Web Lock, one rejects; crash releases it.
- Project close revokes preview routes, kills runs/terminals/workers/ports,
  and settles pending work but retains the Workbench's origin lock. Only
  `workbench.close()` releases that lock after all project cleanup.
- Every current ProjectSpec differentially preserves seed files, manifest,
  dependency identity, and start command. Instant first-open accepts only an
  exact verified snapshot and falls back safely on corruption/mismatch;
  from-scratch first materialization skips snapshot and shows the owner install;
  same project reuses a valid tree, while two project ids never share a stamp.
- Playground imports only the public root, `playground`, and worker subpaths;
  no duplicate mutable implementation or raw owner surface remains.
- The packed consumer at
  `tests/integration/fixtures/workbench-vite-consumer` installs tarballs without
  workspace resolution, performs a Vite production build, and passes Chromium
  acceptance.
- `pnpm pr:check`, browser-unit, e2e, prod-e2e, publish dry-run, and the packed
  consumer all pass sequentially on one SHA with zero Final+GREEN blockers.

## Parity cases

Node is the oracle for these runtime-visible cases:

| case | required observation |
|---|---|
| stdin flow | ordered chunks, split-UTF-8 decoder state, pause holds delivery, resume drains in order, EOF/end once, CLI output/code |
| logical IPC disconnect | child remains alive; later resize/control and final exit still arrive |
| live TTY resize | stdout/stderr columns/rows/getWindowSize update; stream `resize` precedes `SIGWINCH`; non-TTY streams unchanged |
| recursive execSync/Worker env | inherited cwd/env, explicit user-env replacement, reserved host-key override resistance |

Runtime regressions additionally pin missing bootstrap config as a loud failure
for recursive runner, worker_threads, and real-COI execSync. VFS durability,
OPFS, snapshots, HMR, Web Locks, preview proof, and browser teardown use
real-browser/fault tests, not fake Node parity.

## Fault matrix

| fault × operation | honest outcome / proof |
|---|---|
| `concurrent-same-key` × two tabs open | origin Web Lock admits one; loser rejects; crash releases — Chromium two-page test |
| `concurrent-same-key` × two runs same tick | owner actor claims synchronously; second throws — actor test |
| `torn-state` × resize before rid / logical disconnect | latest size latches; physical control survives through exit — worker regression |
| `torn-state` × editor vs files/guest same-size overwrite | exact owner version/revision conflicts; no aggregate shortcut — Memory+OPFS tests incl. >128 KiB |
| `torn-state` × rename/delete/reset vs save | one owner-applied state frame invalidates Documents before Files/reply; stale save rejects, neither version hidden — stateful tests |
| `quota-perm-fail` × owner apply then persist failure/hang | promise rejects in bound, durability degrades visibly, no false durable ACK — OPFS fault tests |
| `concurrent-same-key` × install/install or install/manifest/reset | acquisition authority serializes/fences stale stamp — integration tests |
| `provenance-lie` × corrupt/mismatched snapshot | discard; continue through recorded acquisition chain — real loader test |
| `false-fallback` × Eddy timeout/404/corrupt/divergent | visible reason then registry; registry failure rejects with both causes — integration tests |
| `provenance-lie` × preview LIVE | only owner PreviewRegistry SW+HTTP proof can publish LIVE — Chromium test |
| `torn-state` × close during write/run/install | deterministic settle/cancel; project resources close once; Web Lock releases only on Workbench close — teardown test |
| `quota-perm-fail` × preferred/required storage open | preferred exposes memory; required rejects; ephemeral never touches OPFS — Chromium faults |

## Out of scope

- UI/framework bindings (next distribution items).
- Playground's TypeScript language-service relay and other app-specific owner
  protocols; no generic owner extension port leaks through the root.
- Multiple concurrent projects/Workbenches per origin.
- Public runtime/acquisition plugins.
- SSR, non-browser, non-Worker, non-COI, or no-Web-Locks hosts.
- Raw TTY (`setRawMode`, ETX/Ctrl-D line discipline), byte-stdio
  backpressure, and other unsupported Node surfaces: retain loud errors and
  compat ❌, never stubs.
- Native modules/node-gyp, production performance guarantees, non-Chromium
  claims, and Vite server internals as configuration.
- Webpack/Next/other host examples. They remain unverified, not rejected by a
  fake bundler-name check.
