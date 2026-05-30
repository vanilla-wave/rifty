# M12 (proposed) — opencode server facade in rifty

> **STAGED PROPOSAL — NOT RATIFIED.** This directory is the output of a design
> session, not a committed plan. Nothing here modifies `PROJECT_PLAN.md`,
> `TASKS.md`, `OPEN_QUESTIONS.md`, or `docs/adr/*`. The ADR *drafts* in
> `decisions.md` are **drafts** staged for human review — ADRs are immutable
> after merge and must be human-ratified before any irreversible work begins.
> The reversible `Q-2026-05-30-1NN` entries in `decisions.md` are a copy-paste
> block for the maintainer to append to `OPEN_QUESTIONS.md`; this workflow does
> not append them itself.

## Framing

The goal is to run **anomalyco/opencode** (the Effect/Bun TypeScript *source*
graph, not the published native `opencode-ai` npm package) inside rifty as a
**no-tool-execution agent facade**: a headless HTTP server that can build its
~40 Effect layers, serve trivial routes, create a session, and perform one LLM
round-trip — but cannot spawn processes, run a shell, drive native git/ripgrep,
or open a PTY. The verdict from the feasibility study
(`docs/opencode-rifty-feasibility-2026-05-30.md`) is **feasible-with-major-work
(medium confidence)**: the server is portable as a server facade up to a
hard, browser/WASI-imposed **tool-execution ceiling**. This proposal stages the
work as nine designed features mapped onto the feasibility phases P0–P5.

Two make-or-break unknowns gate everything:

- **Unknown #1 — createRoutes statically pulls the DB layer.** *Resolved YES* by
  source inspection: `HttpApiApp.createRoutes` → `session/session.ts` →
  `@/storage/db` → `#db` → (on rifty's `node` condition) `node:sqlite`, an
  unregistered builtin → `MODULE_NOT_FOUND` at resolve time. A resolvable
  SQLite shim is therefore required for **first light** (P0/P2), not just P4.
- **Unknown #2 — Effect's `IncomingMessage`/`ServerResponse` shapes reproducible
  over rifty's bridge.** *Resolved reproducible-with-adapter*: the request
  pull-stream contract and the buffered `res.end(body)` path already work
  (matching the express@4 precedent); only a thin additive `ServerResponse`
  `'drain'`/pipe-sink adapter is needed before streaming (P4+).

---

## Feature → feasibility-phase map

| Phase | Feasibility milestone | Owning feature(s) |
|------|------------------------|--------------------|
| **P0** | Module-graph load: TS-on-import across the tree; honour `#` import conditions; stub `#db`/`#pty`; intercept the sqlite specifier | **01** (load into VFS), **02** (TS-on-import), **03** (conditional imports + sqlite intercept, tier A) |
| **P1** | Bridge `node:http`: Effect `NodeHttpServer.createServer().listen()` registers a port + SW routes to `webHandler()` | **05** (Effect HTTP bridge, listen overload) |
| **P2** | Build the server layer headlessly: `Server.listen(opts)`, mDNS off, ~40 default layers build, drop/stub ptyConnectApi | **04** (`#db`/`#pty` shims, tier A resolvable), **06** (headless boot, layers-build marker) |
| **P3** | First HTTP request: fetch a trivial no-storage route → 200 JSON through the bridge | **05** (buffered `end(body)`), **06** (route marker) |
| **P4** | Meaningful flow: session create + one LLM round-trip (provider via fetch; storage = WASM-SQLite over VFS; no tools) | **04** (tier B WASM-SQLite), **08** (https→fetch + session/LLM), **07** (page-direct SSE only) |
| **P5** | Ceiling: one JS/WASM read/grep over the VFS to MARK the tool-execution boundary; shell/git/PTY documented out of scope | **09** (tool-ceiling marker) |

---

## Dependency DAG

```
                 01 load-opencode-into-vfs
                          │
                          ▼
                 02 ts-on-import-graph ───────────────┐
                          │                            │
                          ▼                            │
   03 conditional-imports + sqlite-intercept (tier A)  │
                          │                            │
                          ▼                            │
            04 db-and-pty-shims (tier A resolvable;    │
                       tier B WASM-SQLite)             │
                          │                            ▼
                          │              05 effect-http-bridge
                          │            (T1–T5 net-only, no opencode dep
                          │             — can run in parallel with 01/02)
                          │                            │
                          ▼                            ▼
                 06 headless-server-boot  ◄────────────┘
                  (P2 layers-build + P3 route)
                          │
            ┌─────────────┼──────────────┐
            ▼             ▼               ▼
   07 ws-sse-bridge   08 llm-flow    09 tool-ceiling-marker
   (page-direct SSE;  (https→fetch;   (read-only VFS grep;
    v3 Worker bump     session +       depends 01 + 06)
    deferred)          1 LLM RT)
```

Edges (consumer ← producer):

- **02 ← 01** (needs the VFS-loaded `.ts` tree).
- **03 ← 01, 02** (resolver/condition work over the loaded, TS-strippable tree).
- **04 ← 01, 02, 03** (consumes the sqlite specifier intercept; adds the engine).
- **05 ← 02, 04** *for its integration harness only*; **T1–T5 are net-only and
  depend on nothing in this DAG** (see execution order).
- **06 ← 01, 02, 03, 04, 05** (boots the real server; the integration capstone).
- **07 ← 05, 06, 08** (proves streaming on the already-booted flow).
- **08 ← 01, 02, 03, 04, 05, 06** (the P4 round-trip).
- **09 ← 01, 06** (marks the ceiling on the booted facade's VFS).

---

## De-risk-first recommended execution order

The naive linear order (01→02→…→09) defers the two make-or-break verifications
behind their dependencies. The adversarial review found three load-bearing
de-risk inversions. **Verify the unknowns before committing to the P0 deps:**

1. **Spike A — TS-strip round-trip (de-risks 02's IRREVERSIBLE API).** Hand-wire
   the existing single-file `transformWithEsbuild` into a throwaway fork of
   `executeEsm` and load a 3-file `.ts` graph. Confirm esbuild's stripped output
   round-trips through `transformEsm` (acorn) **before** designing the public
   `ModuleLoaderOptions.transformSource` hook. *No ADR, no public-API change.*

2. **Spike B — Effect req/res shape (de-risks unknown #2, 05 T1–T5).** Build the
   `packages/net` unit work (`listen({port,host})` overload, `'drain'` emission,
   pipe-target duck shape) in isolation — it has **zero opencode dependency**.
   This retires unknown #2 in pure net unit tests and can run **in parallel with
   01/02**, not queued behind the sqlite work.

3. **Spike C — real-graph layer-build past the throw-stub (de-risks unknown #1
   *in practice*).** Once 01 lands a vendored tree and 03/04 register the
   *resolvable throw-on-use* sqlite stub, run the graph-load harness against the
   **real** `createRoutes` module (NOT a synthetic `#db` fixture). Assert the ~40
   layers BUILD with the stub alone — no Database constructed at module eval. **If
   layer-build constructs a Database, the IRREVERSIBLE WASM-SQLite dep (04 tier B)
   is pulled forward from P4 to a hard P2/P3 prerequisite and the milestone
   ordering must be re-cut.** This gate must precede any "P3 first-light is cheap"
   claim.

4. **Spike D — streaming probe (de-risks 07 vs 08 circularity).** Independently of
   opencode, drive a never-ending `ReadableStream` through `ServerResponse
   .toResponse()` → SW page-direct path (confirm incremental delivery) **and**
   through the page↔Worker `preview-port` v2 path (confirm it hangs/reaps at the
   30s idle timer, proving the v3 bump is genuinely needed). Decide the v3 ADR
   *before* declaring P4 done, or scope P4 as "buffered completion only".

5. **Verify the IRREVERSIBLE gate premises against the tree** before spending ADR
   cycles: `os.hostname()` **already exists** (so 06's named gate is wrong — see
   review); confirm whether anything actually trips `node:https` before paying the
   ADR-0010-supersession cost (08).

After the spikes: **01 → 02 → 03 → 04(tierA) → [Spike C gate] → 05(T6) → 06 →
{04 tierB, 08, 07, 09}**.

---

## Acceptance criteria per phase

### P0 — Module-graph load
- [ ] The vendored opencode `src` tree + the KEEP-set `node_modules` are present in a memory VFS; install completes without `ENATIVEUNSUPPORTED` (01).
- [ ] `.ts`/`.tsx` resolve as first-class ESM extensions and are type-stripped on import via the WASI esbuild hook across a multi-file graph (02).
- [ ] A gold-standard parity case shows a multi-file `.ts` graph's runtime stdout matches Node-with-a-stripper (02 T7).
- [ ] `#db`/`#pty` `#`-imports resolve; `node:sqlite` (+ `bun:sqlite`, the drizzle `*-sqlite` migrator subpath) resolve to a **throw-on-USE** builtin (no `MODULE_NOT_FOUND` at resolve time) (03/04 tier A).
- [ ] `import('#pty')` succeeds (lazy wrapper); only PTY session-create throws (04).
- [ ] A static inventory of the createRoutes graph's global/builtin/provider references exists (completeness gap — see review).

### P1 — node:http bridge
- [ ] `HttpServer.listen({port,host}, cb)` accepts Node's options-object overload, extracts the port, registers it in the port registry (05 T1).
- [ ] A no-handler `createServer()` + `server.on('request', …)` buffered `res.end(JSON)` returns 200 via `dispatchToPort` (05 T2).

### P2 — Headless layer build
- [ ] `Server.listen(opts)` resolves with mDNS off (loopback hostname) and the port registers — the ~40 createRoutes layers build with **no native crash** (06 marker `RIFTY_OPENCODE_LAYERS_OK`).
- [ ] **Spike C passed:** the real createRoutes graph builds against the throw-stub alone, no Database constructed at module eval.
- [ ] `bonjour-service`/mDNS loads (or is correctly pruned) without a module-scope native dlopen — contradiction resolved (see review).

### P3 — First HTTP request
- [ ] A no-storage GET route (version/status) returns 200 + parseable JSON through `dispatchToPort` (06 marker `RIFTY_OPENCODE_ROUTE_OK`).
- [ ] The route rides the proven buffered `res.end(body)` path; no streaming/upgrade path is exercised (05).

### P4 — Meaningful flow (session + one LLM round-trip, no tools)
- [ ] WASM-SQLite-backed `#db` `init(path)` returns a drizzle-compatible Database; a `CREATE TABLE` migrate + insert/select over a SessionTable-shaped schema returns rows in drizzle's expected shape (04 tier B; parity case on the result shape).
- [ ] `node:https` client `request`/`get` delegate to `fetch` (https URL); `createServer`/`Agent`/`globalAgent` still loud-throw (08).
- [ ] `POST /session` → 200 `{id}`; `POST /session/:id/message` (no tools, **non-stream**) → 200 JSON assistant reply against a real provider via global `fetch`, sandbox-disabled (08 live; plus a canned-provider CI companion).
- [ ] Page-direct SSE `/event` flows incrementally (resolves before stream end; byte-matches Node) (07 T1).
- [ ] **Persistence decision recorded:** either VFS-durable (04 export-to-VFS promoted to a first-class task) or explicitly "in-memory only" with the feasibility doc's "JSON-over-VFS" wording corrected (see review completeness gap).
- [ ] Streaming-LLM-to-browser scope stated: proven for page-direct only; Worker path blocked on the v3 frame bump.

### P5 — Ceiling marker
- [ ] One read-only VFS grep/read substitute (pure-JS, zero spawn) works over the VFS (09 T2/T3).
- [ ] The spawn ceiling is pinned as a behavioral contract: `spawn('git'|'bash')` surfaces ENOENT-127 and never fake-succeeds; PTY throws on session-create (09 T4).
- [ ] The canonical FEASIBLE-vs-IMPOSSIBLE tool table lives in `docs/compat/` (09 T5).

---

## Feature status table

> **Status as of the 2026-05-30 execution session** (see
> [EXECUTION-LOG.md](EXECUTION-LOG.md)). 4 of 11 ADR drafts ratified; the
> no-vendored-tree slice of feature 05 + the resolve/option-surface half of
> feature 02 implemented; everything needing the (absent) vendored opencode tree is
> blocked or deferred.

| Feature | Status | Ratification gate (ratified ✓ / deferred / blocked) | Depends on |
|---------|--------|-----------------------------------------------------|------------|
| [01 load-opencode-into-vfs](feature-01-load-opencode-into-vfs.md) | blocked — opencode NOT vendored (network-gated dev acquisition; unblocks Spike C + all integration smokes) | **NONE** (all REVERSIBLE; scripts/ + fixtures only) | — |
| [02 ts-on-import-graph](feature-02-ts-on-import-graph.md) | partially implemented — resolver+option-surface done (T1 `ef41164`, T8 `5ef51e0`, T2 `19dbeac`); transform-execution T3–T7 + the gold parity case **not yet landed** | ✓ **ADR-0052** ([adr/0052](../adr/0052-ts-on-import-transform-hook.md)) + ✓ **ADR-0053** ([adr/0053](../adr/0053-ts-tsx-first-class-resolvable-extensions.md)) — both RATIFIED (Spike A passed) | 01 |
| [03 conditional-imports + sqlite-intercept](feature-03-conditional-imports-and-bun-sqlite-intercept.md) | blocked — tier-A stub gated on Spike C (vendored tree) | deferred — per-load `conditions` field converted to an OPEN_QUESTIONS option-C overlay (NOT ratified); gate: overlay proven insufficient against the real tree | 01, 02 |
| [04 db-and-pty-shims](feature-04-db-and-pty-shims.md) | blocked — tier B needs new external deps + Spike C | deferred — **ADR-0055 (draft, WASM-SQLite)** + **ADR-0056 (draft, drizzle adapter)** NOT ratified; gate: Spike C confirms a `Database` is constructed + the `@sqlite.org`-vs-sql.js eval is written | 01, 02, 03 |
| [05 effect-http-bridge](feature-05-effect-http-bridge.md) | implemented (T1 `39bff6a`, T2 `12edbd2`, T3 `376e3cd`, T5 `faaaf8f`, M1 `8fe16b8`); integration harness T6 blocked on 02/04 | ✓ **ADR-0054** ([adr/0054](../adr/0054-effect-consumes-node-http-as-is.md), ratifies decisions.md draft 0057) — RATIFIED (Spike B passed); pipe-sink DEFERRED | (02, 04 for harness; T1–T5 none) |
| [06 headless-server-boot](feature-06-headless-server-boot.md) | blocked — needs the vendored tree + Spike C | deferred — **ADR-0058 (draft)** NOT ratified (no concrete gap; `os.hostname` already exists, review M7); gate: a real boot surfaces a named missing builtin | 01, 02, 03, 04, 05 |
| [07 ws-sse-bridge](feature-07-ws-sse-bridge.md) | designed — page-direct SSE needs no code (ratified); T1 parity proof + v3 path blocked on vendored tree / Worker owner | ✓ **ADR-0055** ([adr/0055](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md), ratifies decisions.md draft 0059) — RATIFIED (Spike D passed); **ADR-0060 (draft, v3 frame bump)** DEFERRED | 05, 06, 08 |
| [08 llm-flow](feature-08-llm-flow.md) | blocked — needs vendored tree + live provider | deferred — **ADR-0061 (draft, node:https→fetch, supersedes ADR-0010)** NOT ratified; gate: clear the C1 ai-Agent pre-flight, then live-flow proof | 01, 02, 03, 04, 05, 06 |
| [09 tool-ceiling-marker](feature-09-tool-ceiling-marker.md) | designed — T1–T5 assigned this session but **not reached** (no blocker; net/runtime-js/docs-only) | **NONE** to start; **ADR-0062 (draft)** stays a DEFERRAL tripwire (ripgrep-WASM/isomorphic-git) — must not be silently crossed | 01, 06 |

> ADR numbers: **0052–0055 are now ratified ADR files on disk** (0054 ratifies
> decisions.md draft 0057; 0055 ratifies draft 0059 — see the slate renumber note in
> [EXECUTION-LOG.md §(a)](EXECUTION-LOG.md)). Drafts **0056, 0058, 0060, 0061, 0062**
> and the converted draft-0054 (conditions) remain in `decisions.md` as DEFERRED /
> OPEN_QUESTIONS — not reserved, not ratified.

---

## Links

- Feature designs+plans: [01](feature-01-load-opencode-into-vfs.md) · [02](feature-02-ts-on-import-graph.md) · [03](feature-03-conditional-imports-and-bun-sqlite-intercept.md) · [04](feature-04-db-and-pty-shims.md) · [05](feature-05-effect-http-bridge.md) · [06](feature-06-headless-server-boot.md) · [07](feature-07-ws-sse-bridge.md) · [08](feature-08-llm-flow.md) · [09](feature-09-tool-ceiling-marker.md)
- Cross-cutting: [decisions.md](decisions.md) (ADR drafts + OPEN_QUESTIONS block) · [review.md](review.md) (5-lens adversarial review)
- Feasibility study: [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md)
- Source of truth for what works / what does not: `../compat/`
