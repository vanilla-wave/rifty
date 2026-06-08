> SUPERSEDED by reference/README.md (live results) — several premises (JSON-over-VFS storage, bun:sqlite) overturned by Spike C/ADR-0065. Kept for provenance.

# Running `anomalyco/opencode` in rifty — feasibility

Snapshot 2026-05-30. From the `opencode-rifty-feasibility` workflow (orient → 3 recon facets → synthesis → adversarial), analysing `github.com/anomalyco/opencode@dev`. **Assessment + plan, not implementation** — scopes the realistic target and the rifty work it needs.

## What opencode is

Bun-based TS monorepo AI coding agent: `packages/opencode` (server/core), `packages/console` (TUI), `packages/web`, SDKs. Primary runtime **Bun** (`packageManager: bun@1.3.14`, `@tsconfig/bun`), runs `.ts` directly. Server built on **Effect** + `@effect/platform-node` (`packages/opencode/src/server/server.ts`) — it wraps Node `http.createServer`, **not** `Bun.serve`. Native/Bun bits sit behind package.json `#db` / `#pty` conditional imports (Bun defaults, Node fallbacks).

## Verdict: `feasible-with-major-work` (medium confidence)

A **headless server slice** can run in rifty: boot the Effect HTTP server, answer read/state routes over rifty's port-registry + Service-Worker fetch bridge, persist via JSON-over-VFS, and do **real LLM round-trips** (provider calls go out via `fetch`, which works over rifty's HTTPS-via-SW). rifty already proved real express@4 + vite@5 run in-process, so a big Node/Effect server is not the blocker.

**Hard ceiling — no tool execution.** shell / PTY / git / ripgrep all need OS process spawn, which browser/WASI fundamentally cannot do. The agent can *think and talk to the model* but **cannot run code, git, or grep**. PTY is a *dynamic* `import("#pty")` inside `Pty.create`, so it doesn't block boot — stub the route to throw.

## Cleanest entry (adversarial correction)

Do **not** boot the CLI (`packages/opencode/src/index.ts`): it has a top-level static `import { drizzle } from "drizzle-orm/bun-sqlite"`, whose driver top-level-`require("bun:sqlite")` — an **import-time crash** before any command runs. Also the yargs middleware's JSON→SQLite migration doesn't self-skip on an empty storage dir (guard is `if (!exists(marker))`; absent marker ⇒ migration runs ⇒ `new Database(...)`).

Instead, drive the server **programmatically**: `import { Server } from ".../server/server"` + `Server.listen(opts)`. `server.ts` imports only `@effect/platform-node`, `node:http`, `effect`, and routes — no top-level DB. Bypasses the fatal `index.ts` import and the migration.

## Hard blockers (cannot work in rifty)

| Blocker | Detail | Boot impact |
| --- | --- | --- |
| Process spawn for tools | `Git.run()` → `ChildProcess.make("git")`; bash/shell; ripgrep | Lazy — caps slice to no-tool-execution API facade |
| PTY interactive sessions | `#pty` → `bun-pty`/`@lydell/node-pty` (native C++) | Dynamic import — stub to throw on session create |
| Native SQLite | `bun:sqlite`, or Node `node:sqlite`/`DatabaseSync` | Import-time fatal until WASM-SQLite shim (below) |
| Native file watching | `@parcel/watcher` | Not on minimal serve path — droppable/pollable |

## rifty capability gaps to build (the major work)

1. **TS-on-import across a package graph** — extend the existing esbuild.wasm transform (already used for vite TS/JSX) to transform `packages/opencode/src/**` on import, honouring the package's `#` import conditions.
2. **`node:http` `createServer` → SW/port-registry bridge for Effect** — map `@effect/platform-node` `NodeHttpServer.layer` (`createServer().listen(port)`) onto rifty's port-registry + SW fetch intake (express@4 bridge proved the `http.Server` shape; this needs the same for Effect's request/response objects).
3. **Conditional-import resolution + `bun:sqlite` specifier intercept** — resolver must honour package.json `#imports`, override `#db` (→ sql.js / wa-sqlite + drizzle) and `#pty` (→ throw-stub), AND intercept the bare `bun:sqlite` builtin specifier itself (drizzle-orm/bun-sqlite hard-requires it; `#db` override doesn't cover it).
4. **ws-over-SW bridge** for the SSE/event stream route (PTY-connect route stays stubbed). Without it the streaming event API degrades to non-streaming.
5. **ripgrep substitute** (JS/WASM search over the VFS) — only when search tools are exercised; not on boot path.

Incidental shims: `Heap.start()` (v8/process memory), `process.env`/`argv`, `node:os` hostname (mDNS gate, already loopback-skipped), yargs surface.

## Make-or-break unknowns (verify first)

1. Does `HttpApiApp.createRoutes(opts)` **statically** import the storage/Database layer? If yes, the programmatic `Server.listen` path also trips `bun:sqlite` at layer-build time — the `#db`/specifier shim is required even for "first light."
2. Are `@effect/platform-node`'s `IncomingMessage`/`ServerResponse` shapes fully reproducible over rifty's SW bridge, as they were for express@4?

## Plan (smallest-runnable-milestone first)

- **P0 — module-graph load.** Point rifty at the server entry; TS-on-import across the tree; honour `#` import conditions; stub `#db` (init→wa-sqlite or throw) and `#pty` (throw-on-create); intercept `bun:sqlite`. Goal: graph resolves with no unresolved-import / native crash.
- **P1 — bridge `node:http`.** Extend the bridge so Effect `NodeHttpServer` `createServer().listen(port)` registers in the port registry and SW fetch routes into `HttpApiApp.webHandler()`.
- **P2 — build the server layer headlessly.** `Server.listen(opts)` with mDNS disabled; confirm the ~40 default layers build (drop/stub `ptyConnectApi`). Resolves unknown #1.
- **P3 — first HTTP request.** From a rifty page, `fetch` a trivial route (version / instance status) through the SW bridge → assert 200 JSON.
- **P4 — meaningful flow.** Session create + an LLM message round-trip (provider via `fetch`; storage JSON-over-VFS; no tools). Proves a real slice.
- **P5 (ceiling) — one tool.** A JS/WASM read/grep over the VFS marks the tool-execution boundary; shell/git/PTY documented out of scope (process-spawn). Authoritative FEASIBLE-vs-IMPOSSIBLE tool table lives in [`docs/compat/opencode-tool-ceiling.md`](compat/opencode-tool-ceiling.md) (compat source-of-truth): ✅ read substitutes (`fs.readFileSync`/`readdirSync`, pure-JS `vfsGrep`, stat) vs ❌ process-spawn tools (bash, native git, ripgrep binary, PTY). ripgrep-WASM / isomorphic-git deferred behind explicit ADR ratification.

## "What to build" checklist (input for a design session — only "what", not "how")

**0. De-risk first:**
- Does `HttpApiApp.createRoutes` statically pull the DB layer (→ `bun:sqlite` shim needed immediately)?
- Are `@effect/platform-node` `IncomingMessage`/`ServerResponse` shapes reproducible over the SW bridge (as for express@4)?

**1. Load opencode code into rifty:**
- opencode sources + deps in VFS (vendor/clone + install the Bun tree);
- TS-on-import across the package tree (extend esbuild.wasm transform to a multi-file ESM graph);
- resolver: package.json `#` conditions (`#db`/`#pty`) + intercept of the bare `bun:sqlite` specifier.

**2. Bring up the server (facade, no tool execution):**
- `node:http` `createServer().listen()` → port-registry + SW bridge (for Effect/platform-node);
- `#db` → WASM-SQLite (sql.js/wa-sqlite) + drizzle;
- `#pty` → stub (throw on create);
- ws-over-SW bridge (event/SSE stream);
- programmatic entry `Server.listen(opts)` (bypass CLI), mDNS off.

**3. Real flow (without tools):**
- HTTPS-outbound for LLM providers (`https`→fetch; currently loud-throw);
- JSON-over-VFS storage;
- milestones: first GET route → 200 JSON; then session create + LLM round-trip.

**4. Lift the tool ceiling (WebContainers model, no server — replace the tool layer):**
- intercept opencode's tool layer (bash/shell, git, grep, file-edit, spawn);
- substitutes: `@riftydev/shell` + WASI-coreutils; isomorphic-git (or wasm-git); VFS search (JS/ripgrep-WASM); VFS file ops;
- no native spawn.

**5. Verification:**
- headless harness (like `real-vite-smoke.ts`) for milestones 1–3;
- browser e2e (cross-origin isolated) for the full flow.

## Bottom line

opencode's *server* is portable to rifty as a **no-code-execution agent facade** (converse with the model, manage sessions over VFS storage), gated behind real but buildable rifty capabilities (TS-on-import, Effect http bridge, `#`/`bun:sqlite` shims, ws bridge). Tool execution (the part that makes it an *agent that edits code*) is a hard browser/WASI ceiling. P0–P3 (boot + first request) is the de-risking spike; P4 proves it's meaningful.
