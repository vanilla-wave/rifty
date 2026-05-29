# Running `anomalyco/opencode` in rifty — feasibility

Snapshot 2026-05-30. Produced by the `opencode-rifty-feasibility` workflow
(orient → 3 recon facets → synthesis → adversarial), analysing
`github.com/anomalyco/opencode@dev`. This is an **assessment + plan**, not an
implementation — it scopes the realistic target and the rifty work it needs.

## What opencode is

A Bun-based TypeScript monorepo AI coding agent (`packages/opencode` = the
server/core, `packages/console` = TUI, `packages/web`, SDKs). Primary runtime
is **Bun** (`packageManager: bun@1.3.14`, `@tsconfig/bun`); it runs `.ts`
directly. The server is built on **Effect** + `@effect/platform-node`
(`packages/opencode/src/server/server.ts`) — i.e. it wraps Node `http.createServer`,
**not** `Bun.serve`. Native/Bun bits sit behind package.json `#db` / `#pty`
conditional imports with Bun defaults and Node fallbacks.

## Verdict: `feasible-with-major-work` (medium confidence)

A meaningful **headless server slice** can run in rifty: boot the Effect HTTP
server, answer read/state routes over rifty's port-registry + Service-Worker
fetch bridge, persist via JSON-over-VFS, and do **real LLM round-trips** (provider
calls go out via `fetch`, which works over rifty's HTTPS-via-SW). rifty just
proved real express@4 + vite@5 run in-process, so "big Node/Effect server" alone
is not the blocker.

**The hard ceiling — no tool execution.** shell / PTY / git / ripgrep all require
spawning OS processes, which a browser/WASI runtime fundamentally cannot do. So
the agent can *think and talk to the model* but **cannot run code, git, or
grep**. PTY is a *dynamic* `import("#pty")` inside the `Pty.create` path, so it
doesn't block boot — the route is stubbed to throw.

## Cleanest entry (adversarial correction)

Do **not** boot the CLI (`packages/opencode/src/index.ts`): it has a top-level
static `import { drizzle } from "drizzle-orm/bun-sqlite"`, and that driver
top-level-`require("bun:sqlite")` — an **import-time crash** on rifty, before any
command runs. Also the yargs middleware's JSON→SQLite migration does **not**
self-skip on an empty storage dir (the guard is `if (!exists(marker))`; absent
marker ⇒ migration *runs* ⇒ `new Database(...)`).

Instead, drive the server **programmatically**: `import { Server } from
".../server/server"` + `Server.listen(opts)`. `server.ts` imports only
`@effect/platform-node`, `node:http`, `effect`, and the routes — no top-level DB.
This bypasses the fatal `index.ts` import and the migration entirely.

## Hard blockers (cannot work in rifty)

- **Process spawn** for tool execution: `Git.run()` → `ChildProcess.make("git")`;
  bash/shell tools; ripgrep. Lazy (doesn't block boot) but caps the slice to a
  no-tool-execution API facade.
- **PTY** interactive sessions (`#pty` → `bun-pty`/`@lydell/node-pty`, native
  C++). Dynamic import ⇒ stub it to throw on session create.
- **Native SQLite** as-is (`bun:sqlite`, or Node's `node:sqlite`/`DatabaseSync`)
  — removed by a WASM-SQLite shim (below), but until then it's import-time fatal.
- **Native file watching** (`@parcel/watcher`) — not on the minimal serve path;
  droppable/pollable.

## rifty capability gaps to build (the major work)

1. **TS-on-import across a package graph** — extend the existing esbuild.wasm
   transform (already used for vite TS/JSX) to transform `packages/opencode/src/**`
   on import, honouring the package's `#` import conditions.
2. **`node:http` `createServer` → SW/port-registry bridge for Effect** — map
   `@effect/platform-node` `NodeHttpServer.layer` (`createServer().listen(port)`)
   onto rifty's port-registry + SW fetch intake (the express@4 bridge proved the
   `http.Server` shape; this needs the same for Effect's request/response objects).
3. **Conditional-import resolution + `bun:sqlite` specifier intercept** — the
   resolver must honour package.json `#imports` AND override `#db` (→ sql.js /
   wa-sqlite + drizzle) and `#pty` (→ throw-stub), AND intercept the bare
   `bun:sqlite` builtin specifier itself (drizzle-orm/bun-sqlite hard-requires it;
   the `#db` override doesn't cover it).
4. **ws-over-SW bridge** for the SSE/event stream route (PTY-connect route stays
   stubbed). Without it the streaming event API degrades to non-streaming.
5. **ripgrep substitute** (JS/WASM search over the VFS) — only when search tools
   are exercised; not on the boot path.

Incidental shims: `Heap.start()` (v8/process memory), `process.env`/`argv`,
`node:os` hostname (mDNS gate, already loopback-skipped), yargs surface.

## Make-or-break unknowns (verify first)

1. Does `HttpApiApp.createRoutes(opts)` **statically** import the storage/Database
   layer? If yes, the programmatic `Server.listen` path also trips `bun:sqlite`
   at layer-build time and the `#db`/specifier shim is required even for "first
   light."
2. Are `@effect/platform-node`'s `IncomingMessage`/`ServerResponse` shapes fully
   reproducible over rifty's SW bridge, as they were for express@4?

## Plan (smallest-runnable-milestone first)

- **P0 — module-graph load.** Point rifty at the server entry; enable
  TS-on-import across the tree; honour `#` import conditions; provide stub `#db`
  (init→wa-sqlite or throw) and `#pty` (throw-on-create); intercept `bun:sqlite`.
  Goal: the graph resolves with no unresolved-import / native crash.
- **P1 — bridge `node:http`.** Extend rifty's bridge so the Effect
  `NodeHttpServer` `createServer().listen(port)` registers in the port registry
  and SW fetch routes into `HttpApiApp.webHandler()`.
- **P2 — build the server layer headlessly.** `Server.listen(opts)` with mDNS
  disabled; confirm the ~40 default layers build (drop/stub `ptyConnectApi`).
  Resolve unknown #1 here.
- **P3 — first HTTP request.** From a rifty page, `fetch` a trivial route
  (version / instance status) through the SW bridge → assert 200 JSON.
- **P4 — meaningful flow.** Session create + an LLM message round-trip (provider
  via `fetch`; storage JSON-over-VFS; no tools). Demonstrates a real slice.
- **P5 (ceiling) — one tool.** A JS/WASM read/grep over the VFS to mark the
  tool-execution boundary; shell/git/PTY documented out of scope (process-spawn).

## Bottom line

opencode's *server* is portable to rifty as a **no-code-execution agent
facade** (it can converse with the model and manage sessions over VFS storage),
gated behind real but buildable rifty capabilities (TS-on-import, Effect http
bridge, `#`/`bun:sqlite` shims, ws bridge). Tool execution (the part that makes
it an *agent that edits code*) is a hard browser/WASI ceiling. P0–P3 (boot +
first request) is the de-risking spike; P4 proves it's meaningful.
