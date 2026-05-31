# M12 (proposed) — opencode server facade in rifty

> **STAGED PROPOSAL — partially shipped.** This is the lean current-state doc for
> the effort to run **anomalyco/opencode** (the Effect/Bun TypeScript *source*
> graph, not the published native `opencode-ai` npm package) inside rifty as a
> **no-tool-execution agent facade**. The full per-feature designs and the
> adversarial review that produced this plan were consolidated away (2026-05-31
> doc audit); their load-bearing content — what shipped, what is blocked, and the
> exact gate for each — is captured below. The detailed decision register with
> the full text of every ADR draft (ratified + deferred) lives in
> [`decisions.md`](decisions.md); the feasibility verdict in
> [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md).

## Goal and verdict

Run opencode's Effect HTTP server headlessly in rifty: build its ~40 Effect
layers, serve trivial routes, create a session, and perform one LLM round-trip —
but **cannot** spawn processes, run a shell, drive native git/ripgrep, or open a
PTY. Feasibility verdict: **feasible-with-major-work (medium confidence)** — the
server is portable as a server facade up to a hard, browser/WASI-imposed
**tool-execution ceiling**. rifty already proved real express@4 + vite@5 run
in-process, so "big Node/Effect server" alone is not the blocker; tool execution
(spawn/PTY/native git/ripgrep) is the hard ceiling.

opencode is **NOT vendored** in this repo. The entire no-vendored-tree slice is
implemented and green; everything needing the vendored tree is blocked.

## What shipped (green)

All verified WITHOUT the vendored tree. Last full local verification on HEAD
`3890fc6`: typecheck PASS, `check:deps` PASS, `test:run` 867 passed / 16 skipped
/ 0 failed (the only red is pre-existing whole-tree `pnpm lint` debt in
`packages/npm-client/src/installer.ts`, unrelated to this effort).

- **TS-on-import across the module graph** (feature 02). `.ts`/`.tsx` are
  first-class resolvable + ESM extensions (ordered after the `.js` family so
  plain-JS packages are byte-unchanged), type-stripped on import via an injected
  esbuild WASI `transformSource` hook on `ModuleLoaderOptions`. `.d.ts` excluded
  from candidate matching; `require()` of a `.ts` CJS-scope module loud-throws;
  id-keyed transform cache. **Ratified: ADR-0052** (transform hook) + **ADR-0053**
  (`.ts`/`.tsx` extensions). Commits `ef41164`, `5ef51e0`, `19dbeac`, `b63ff27`,
  `c12d864`, `1be1201`, `3ddf9b0`, `c283c20`. **The gold multi-file `.ts` parity
  case is GREEN** (`85ed795`, `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`)
  — diffed head-to-head against Node-via-`tsx`. **P0's language unit is closed**;
  P0's tree-integration half (createRoutes smoke F02-T9) is still blocked on the
  vendored tree.

- **Effect consumes rifty `node:http` AS-IS** (feature 05). `HttpServer.listen`
  options-object overload; `ServerResponse` emits Node-style `'drain'`;
  no-handler `createServer()` + `on('request')` buffered `res.end(JSON)` returns
  200; WS/SSE upgrade boundary negative-locked; opt-in parity-net mode with real
  Node-vs-rifty `node:http` parity cases. **Ratified: ADR-0054** (additive
  shape-widening, no dedicated Effect adapter; pipe-sink DEFERRED). Commits
  `39bff6a`, `12edbd2`, `376e3cd`, `faaaf8f`, `8fe16b8`.

- **SSE-over-streaming-HTTP principle** (feature 07). opencode's `/event` route is
  `text/event-stream` over HTTP GET, not a WebSocket; it flows page-direct over
  the existing SW→page bridge with no new code (`ServerResponse.toResponse()`
  resolves a live-stream `Response` at header-flush). **Ratified: ADR-0055** (no
  `ws` shim; page-direct only). The page↔Worker v3 frame bump is DEFERRED (see
  below).

- **F09 tool-ceiling marker** (feature 09). Pure-JS `vfsGrep` over `node:fs` (zero
  spawn, not a public export), read-substitute parity, failure-mode contracts,
  and a spawn-ceiling conformance test pinning `spawn('git'|'bash')` →
  ENOENT/exit-127 (never fake-succeeds) + PTY throw-on-create. Commits `61da8da`,
  `15c6895`, `93e055b`, `6e5b2e5`. The authoritative FEASIBLE-vs-IMPOSSIBLE table
  is `docs/compat/opencode-tool-ceiling.md` (`3890fc6`). The earlier `vfsGrep`
  global/sticky-RegExp silent-zero-match (review MAJOR) is **fixed** (`8a57400`).

> Slate renumber note: ADR-0054/0055 ratified the SSE/Effect-HTTP drafts under
> *next-free* ADR numbers, NOT under their `decisions.md` draft numbers (0057,
> 0059). In `decisions.md` numbering, "ADR-0055" is the DEFERRED WASM-SQLite
> draft. Each on-disk ADR states `ratifies decisions.md draft ADR-00NN` to make
> the mapping explicit.

## What is BLOCKED (and the exact gate for each)

The single headline blocker is that **opencode is not vendored**. Everything
below is tree-dependent or a deferred irreversible decision.

| Blocked work | Gate to unblock |
|--------------|-----------------|
| **Vendor opencode (feature 01)** | Pin a SHA of anomalyco/opencode, generate a facade manifest (`catalog:`→concrete, drop `workspace:`, prune to the KEEP set), snapshot `node_modules`, add a shared `bootOpencodeFacade` helper. Network-gated dev-acquisition; scripts/+fixtures only (REVERSIBLE, Q-2026-05-30-101). Unblocks Spike C + features 03/04/06/07-T1/08 + F02-T9. |
| **Spike C — real-graph layer-build** | Needs the vendored tree. Run the graph-load harness against the REAL `createRoutes` (~40 layers) with the tier-A throw-stub alone; assert NO `Database` constructed at module eval. **Decides whether WASM-SQLite is a deferred P4 need or a pulled-forward P2 prerequisite** (if a Database is built at layer-build, the milestone ordering is re-cut). |
| **`#db`/`#pty` shims + WASM-SQLite + drizzle (features 03/04)** | Tier-A resolvable throw-on-USE stub is REVERSIBLE but gated on Spike C. Tier B adds NEW external deps — DEFERRED: **ADR-0055 draft (WASM-SQLite engine)** + **ADR-0056 draft (drizzle `sql-js` adapter)**, NOT ratified. Gate: Spike C confirms a `Database` is constructed, the `@sqlite.org/sqlite-wasm`-vs-sql.js evaluation (per ADR-0006) + COI/SAB analysis (ADR-0002) is written, and the P4 persistence scope (Q-2026-05-30-114) is decided. The per-load `conditions` field is DEFERRED to an OPEN_QUESTIONS option-C overlay (no public-API change) until the overlay is proven insufficient against the real tree. |
| **Headless server boot (feature 06)** | Needs the vendored tree to boot `Server.listen` headlessly. **ADR-0058 draft DEFERRED** — nothing concrete to ratify (`os.hostname()` already exists; the substance is a process commitment). Gate: a real boot surfaces a CONCRETE unimplemented builtin via a loud throw → open a fresh, specific ADR for the named method then. |
| **v3 SSE frame bump (feature 07)** | **ADR-0060 draft DEFERRED** — non-additive bump of a versioned wire contract (`PREVIEW_PORT_FRAME_VERSION` 2→3) that CONTRADICTS ADR-0048 D2 and ADR-0017's M12 deferral. Page-direct SSE (ADR-0055) ships first with no code. Gate: the Worker becomes the actual opencode owner (ADR-0046 `WorkerOwnerBinding`) AND a superseding ADR cites+supersedes ADR-0048 D2 and amends ADR-0017. |
| **LLM round-trip + `node:https`→fetch (feature 08)** | Needs the vendored tree, a live provider endpoint via env (Q-2026-05-30-116, D-004), and features 01-06. **ADR-0061 draft DEFERRED** (supersedes immutable ADR-0010). Gate: clear the **C1 pre-flight** — inspect pinned `ai@6`/`@ai-sdk/*` source for whether the global-`fetch` path constructs an `https.Agent` at init (a thrown Agent constructor would be init-time-fatal for the round-trip). Run the live flow with `node:https` left as loud-throw FIRST; adopt the client→fetch split only if it actually trips. The superseding ADR must preserve ADR-0010's no-silent-plaintext invariant. |
| **Real ripgrep/git tool fidelity (feature 09, future)** | **ADR-0062 draft is a DEFERRAL tripwire** — adopting ripgrep-WASM / isomorphic-git / wa-sqlite-search (each a NEW external dep) is BLOCKED until a concrete measured need. The pure-JS marker shipped under Q-2026-05-30-061. Do not silently cross this. |

## Critical path

```
vendor opencode (F01)  →  Spike C (real createRoutes layer-build)  →  WASM-SQLite decision (ADR-0055/0056)
        │                          │                                            │
        └─ unblocks ───────────────┴── decides P2-vs-P4 ordering ───────────────┘
                                   │
   then: headless boot (F06) → first route (P3) → session + 1 LLM round-trip (P4, after C1 pre-flight)
                                                              → ceiling already marked (P5, shipped)
```

`vendor opencode → Spike C → WASM-SQLite decision` is the spine. Spike C is the
make-or-break gate: it decides whether the irreversible WASM-SQLite dependency is
a deferred P4 need or a pulled-forward P2 prerequisite. P4 additionally holds on
the C1 `https.Agent` pre-flight. P5 (the tool ceiling) is already marked.

## Links

- Decision register (full ADR-draft text + the reversible Q-block):
  [decisions.md](decisions.md)
- Retained feature designs (each cited by a ratified, immutable ADR's References
  section): [feature-02-ts-on-import-graph.md](feature-02-ts-on-import-graph.md)
  (ADR-0052/0053) · [feature-05-effect-http-bridge.md](feature-05-effect-http-bridge.md)
  (ADR-0054) · [feature-07-ws-sse-bridge.md](feature-07-ws-sse-bridge.md) (ADR-0055).
  The other 6 feature designs + the adversarial review + the execution log were
  consolidated into this doc (2026-05-31).
- Feasibility study:
  [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md)
- Tool-execution boundary (compat source-of-truth):
  [`../compat/opencode-tool-ceiling.md`](../compat/opencode-tool-ceiling.md)
- Ratified ADRs: [0052](../adr/0052-ts-on-import-transform-hook.md) ·
  [0053](../adr/0053-ts-tsx-first-class-resolvable-extensions.md) ·
  [0054](../adr/0054-effect-consumes-node-http-as-is.md) ·
  [0055](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md)
