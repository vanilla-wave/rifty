# ADR 0080: Lazy `node_modules` remote-read protocol + async explorer path

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0076 (cross-realm reverse VFS *snapshot* — this is its anticipated request/response successor for the `node_modules` subtree; the snapshot push stays the source-of-truth for the small project tree), ADR-0077 + Q-2026-06-05-317 (worker keep-alive — the worker must stay live to answer reads; this is a SECOND consumer), ADR-0043 (Vite-in-Worker — the realm whose `node_modules` we read), ADR-0048 (cross-realm preview-port — the `requestId`-correlated request/reply + per-request idle-timeout this mirrors), ADR-0075 (file explorer), the playground-local `vfs-write-port.ts` / `vfs-snapshot-port.ts` (the two one-way bridges this complements with a two-way one). Resolves the deferred `node_modules`-placeholder item of Q-2026-06-04-316 and closes ADR-0076's "(−) node_modules is not browsable" consequence.

## Context

ADR-0076 gives the page a read-only snapshot of the worker's project tree, but `SNAPSHOT_EXCLUDE_DIRS` deliberately drops `node_modules` (a full-tree push of thousands of installed files would be a huge structured-clone per frame, on every watch event, for a tree the user rarely opens). So the explorer shows project source only; `nodeModulesPresent` records that the dir exists but it is unbrowsable.

The snapshot bridge is the wrong tool to extend: it is one-way, full-tree, push (wholesale replace). `node_modules` browsing needs the opposite shape — **pull on demand, one directory level at a time, only what the user expands** — a request/response remote read, which ADR-0076's alternatives named and deferred ("could supersede this if browsing node_modules becomes a real need"). That need is now in scope.

Constraint that shapes everything: the explorer (`FileExplorer.tsx`) and editor (`EditorHost.tsx`) read the VFS **synchronously** (`readdirSync`/`readFileBytesSync` via `FsOpsTarget`). A worker→page read is inherently **async**. We add an async browsing path for `node_modules` **without breaking the existing sync `FsOpsTarget` consumers** that render the snapshot project tree.

This adds a new cross-realm wire protocol (>2 files / >100 lines) → IRREVERSIBLE, ratified inline (ADR-0063). It introduces **no new npm dependency** and **no cross-package public API** — the bridge is playground-local glue (same scope as the write/snapshot ports; only `@riftydev/net`'s `channelNameFor` addressing primitive is borrowed). It does **not** widen `FsOpsTarget` with async methods (see §3).

## Decision

A two-way, lazy, per-directory request/response `node_modules` read bridge, consumed by an additive async branch in the explorer keyed only on the `node_modules` subtree. The existing sync snapshot path is untouched.

### 1. Wire protocol (`glue/node-modules-port.ts`)

Keyed by dev-server port via `channelNameFor('ws://vfs-nodemods.local:<port>/__rfv')` — a distinct synthetic host so it never cross-talks with the write/snapshot/preview-port bridges. Discriminated-union frames correlated by `requestId` (monotonic counter + random suffix, copied from the preview port):

```ts
type NodeModulesRequestFrame =
  | { type: 'nm-readdir-req'; requestId: string; path: string }
  | { type: 'nm-readfile-req'; requestId: string; path: string };

interface NodeModulesDirEntry { name: string; kind: 'file' | 'dir'; size: number }

type NodeModulesReplyFrame =
  | { type: 'nm-readdir-reply'; requestId: string; entries: readonly NodeModulesDirEntry[] }
  | { type: 'nm-readfile-reply'; requestId: string; size: number; content: Uint8Array | null }
  | { type: 'nm-error'; requestId: string; message: string };
```

- **`nm-readfile-reply.content` is `null`** when the file exceeds `NODE_MODULES_MAX_CONTENT_BYTES = 128 KiB` (matching `SNAPSHOT_MAX_CONTENT_BYTES`); the page surfaces "too large to preview" — no silent empty read.
- **`serveNodeModulesReads(port)`** (worker) reads against the realm-local `syncMirror()` (which holds the installed tree — the exclusion is only in `collectSnapshot`, never in the mirror). A **normalised-segment scope guard** restricts `path` to inside a `node_modules` directory: `normalizePath(path).split('/').includes('node_modules')`. Because `normalizePath` collapses `..`, a `…/node_modules/../src` traversal normalises out of scope and is refused. `readdir` stats each child for kind/size, dirs-before-files. Any throw (ENOENT, scope violation, vanished file) replies `nm-error` with the message. Bytes are copied into a fresh `ArrayBuffer` before posting (the structured-clone shared-memory hazard the write port also guards). Returns an idempotent teardown.
- **`bridgeNodeModulesReads(port, { timeoutMs = 15000 })`** (page) returns `{ readdir, readFile, dispose }`. Each call registers a `pending` waiter keyed by `requestId` with a per-request idle timeout that **rejects** (async callers handle rejection — the explorer shows an error row, the cache evicts for retry — unlike the preview port which resolves a 502). `nm-error` rejects with the worker's message; `dispose()` rejects all in-flight + closes. This is the preview port's correlation+timeout machinery minus streaming (a listing or a ≤128 KiB file fits one structured clone).

### 2. Async cache (`glue/node-modules-cache.ts`)

A pure, Solid-free `NodeModulesCache` wrapping the bridge. `readdir(path)` returns a cached **promise** (coalescing concurrent expands into one in-flight read), or issues one and caches it; a **rejected read is evicted** so a transient timeout is retryable. `peek(path)`/`has(path)` give the explorer a synchronous "already loaded?" check. `invalidate(path?)` drops a subtree or all (called on mode-leave so a stale view never lingers). `readFile` is a passthrough (the editor opens one file at a time). Bounded by being dropped on mode-leave; no LRU in v1.

### 3. Why the async path stays OFF `FsOpsTarget` (the sync→async bridge design)

`FsOpsTarget` is the **sync** contract every existing consumer relies on (`copyTree`, `renamePath`, the explorer `walk`, `EditorHost.openFile`). Adding `readdir(): Promise<…>` would force every implementation (`SyncMirrorVfs`, `SnapshotFs`, test fakes) to grow async methods they cannot honestly serve, and tempt a sync-over-async shim. We do **not** touch it. Instead:

- The explorer's sync `walk()` renders the snapshot project tree exactly as today. When `nodeModules.present`, a **synthetic collapsed `node_modules` dir row** is appended (its presence known from the snapshot frame's flag; the signature the poll watches covers only the sync tree, so the async subtree never makes the poll spuriously refresh).
- Expanding a path at/under `node_modules` takes a **separate async branch**: consult `cache.peek`; if loaded render synchronously, else render a **loading row** and call `cache.readdir(path)`, writing the result into a `nmState` signal (`path → 'loading' | {entries} | {error}`) that the rows memo reads. The async/Solid interaction is confined to event handlers/`.then`; the rows memo never awaits. The row composition is extracted to a pure `composeNodeModulesRows` in `file-tree.ts` and unit-tested Solid-free (the load-bearing async-row interleave).

### 4. Editor: async open (`EditorHost.tsx`)

An optional `readNodeModulesFile?(path): Promise<{ size; content }>` prop. For a `node_modules` path with the callback present, `openFile` opens a transient loading tab (read-only), `await`s, then `setValue`s the bytes (or a "too large" / "binary" placeholder; content null → too large). A guard checks the model wasn't disposed during the await (`models.get(path) !== model`). Critically, the change listener now **skips scheduling a write for read-only paths** (`readOnlyPaths.has(id)`) so the programmatic `setValue` of the loaded content can't try to write a node_modules file back into a read-only VFS. The existing sync path is unchanged for every non-`node_modules` file.

### 5. Worker publishing + lifetime

`real-vite-bootstrap.ts` opens `serveNodeModulesReads(port)` once, alongside the other bridges, and `void`s its teardown before the keep-alive. The worker **must** stay alive to answer reads — this is the ADR-0077 / Q-2026-06-05-317 keep-alive (`await new Promise<never>(() => {})`); this ADR is a second consumer, strengthening the case for native kernel server-process support.

### 6. Wiring (`App.tsx`)

A `createEffect` (parallel to the snapshot subscribe) builds `bridgeNodeModulesReads(realVitePort())` + a `NodeModulesCache` while `mode === 'real-vite'`, stored in a signal; on cleanup/mode-leave it `dispose()`s (a fresh cache per entry, no stale bleed). The cache feeds the real-vite `FileExplorer` (new optional `nodeModules` prop) and a `readNodeModulesFile` callback to `EditorHost`. A `nodeModulesPresent` signal is updated from each snapshot frame's flag so the row appears once install completes. In non-real-vite modes both props are absent and the explorer/editor behave exactly as before.

## Alternatives considered

- **Ship the full snapshot including `node_modules`.** Rejected: thousands of files structured-cloned per snapshot (and re-cloned per watch event) — the exact cost the exclusion exists to avoid.
- **Sync-over-async via `Atomics.wait` + SharedArrayBuffer.** Rejected: rifty's signature is sync-over-OPFS-without-SAB (ADR-0014/0072); reintroducing SAB+COI for a file browser is a step back, and blocking the UI thread on an install-time read would freeze the explorer. The async path is honest and non-blocking.
- **Add async methods to `FsOpsTarget`.** Rejected: forces sync implementations to grow methods they cannot serve and invites a shim (see §3).
- **A general cross-realm remote FS (read any worker path).** Rejected for v1: a `node_modules`-scoped guard is safer (no arbitrary-file exfiltration) and matches the need.
- **Eager-prefetch the whole tree on install-done.** Rejected: the same clone-cost, paid upfront even if the user never opens `node_modules`.

## Consequences

- (+) `node_modules` is browsable in the real-vite explorer — expand-to-load, one level at a time, with loading + error rows; files open read-only (≤128 KiB inline, larger size-only). Closes ADR-0076's gap and Q-2026-06-04-316's deferred placeholder.
- (+) No regression to the sync path: the snapshot tree and `FsOpsTarget` contract are byte-for-byte unchanged; the m10 program-tab / HMR flow never went through `node_modules`. Full playground unit suite 129/129; e2e 18-pass/1-skip baseline held.
- (+) No new dependency, no cross-package public API; the symmetric request/response complement to the two one-way bridges; solid-js stays in `apps/playground`; SAB/COI not reintroduced. Pure logic (`node-modules-port` round-trip over a single-realm BroadcastChannel, `node-modules-cache` with a fake bridge, `composeNodeModulesRows`) is unit-tested in the node env.
- (−) Each expand costs a round-trip (a visible loading row). Acceptable — exploratory, not hot-path; coalesced + cached so re-expands are instant.
- (−) The worker must stay alive (the keep-alive) for reads to resolve; a `.kill()` mid-browse times out and rejects (error row; cache evicts so a retry after re-enter works). A second keep-alive consumer — adds weight to taking up the kernel server-process ADR (Q-2026-06-05-317).
- (−) Cache can go stale if `node_modules` changes mid-session (no invalidate-on-watch in v1); the explorer Refresh / mode-leave clears it. Logged as a v1 limitation, not a blocker.
- (−) A fourth playground BroadcastChannel bridge (write / snapshot / preview-port / node-modules); all share the `channelNameFor` scheme with distinct synthetic hosts. The request/response timeout means a dropped frame surfaces as a timeout-reject, not a silent stale view.
