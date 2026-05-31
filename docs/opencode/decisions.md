# Decision register — opencode server facade (M12 proposed)

> **PARTIALLY RATIFIED.** Section A holds the full text of the 11 **ADR drafts**
> for this effort. Each touches a public API between packages, adds a new external
> dependency, or contradicts/supersedes an existing ADR — i.e. is **IRREVERSIBLE**
> per the project's reversibility checklist. **4 are ratified to disk + 2 are now
> SUPERSEDED by a ratified ADR** (drafts 0052, 0053, 0057→ADR-0054,
> 0059→ADR-0055; drafts 0055+0056 → SUPERSEDED by ratified ADR-0065 — see the
> renumber note below); the remaining **5 are DEFERRED**, each with the gate that
> unblocks it recorded in [`README.md`](README.md). ADRs are immutable after
> merge; do not invent answers. Section B is the **REVERSIBLE** provisional-decision
> block — those entries have since been appended to `OPEN_QUESTIONS.md` (Active).
> Q-ids were renumbered globally from `Q-2026-05-30-101` to avoid colliding with
> the landed `Q-2026-05-30-001` (promoted to ADR-0051).
>
> **Renumber note:** the SSE/Effect-HTTP drafts ratified under *next-free* ADR
> numbers (0054, 0055), NOT their draft numbers (0057, 0059). In THIS file's
> numbering, "ADR-0055" is the WASM-SQLite draft and "ADR-0056" the drizzle
> adapter — both now **SUPERSEDED by the ratified on-disk ADR-0065** (sql.js
> in-memory-first `node:sqlite` `DatabaseSync` shim; corrects the
> `bun:sqlite`→`node:sqlite` framing and voids the drizzle adapter at the pinned
> SHA). Each on-disk ADR states which draft it ratifies or supersedes.

**Tally:** 11 irreversible decisions (ADR drafts 0052–0062; 4 ratified to disk,
2 superseded by ratified ADR-0065, 5 deferred) · 19 reversible decisions
(Q-2026-05-30-101 … -119, now Active in `OPEN_QUESTIONS.md`).

---

## Section A — Irreversible decisions (ADR drafts, require human ratification)

### ADR-0052 (RATIFIED → `docs/adr/0052-ts-on-import-transform-hook.md`) — TS-on-import transform hook on `ModuleLoaderOptions`
*Feature 02. Reversibility rule 1 (cross-package public API). Ratified 2026-05-30 with the option-surface land (feature-02 T2).*

**Context.** opencode is a `.ts` graph; the core loader never strips TS types
(`esm.ts` feeds `resolved.source` straight to acorn). The single-file WASI
esbuild binding exists (`tools/shadow-registry/src/esbuild-binding.ts`) but the
loader has no injection point to reach it (`createModuleLoader` takes only
`{ cwd }`).

**Options.**
- **(A) Recommended — injected hook.** Add optional
  `transformSource?: (req: {source,id,loader,workspace}) => Promise<string>` and
  `workspace?: string` to `ModuleLoaderOptions`; the harness injects a closure
  calling `transformWithEsbuild`. Loader gains zero new package import edges.
  *Trade-off:* every loader caller now sees TS-flavoured options; the hook's
  request shape is the load-bearing contract.
- **(B) Inline import of shadow-registry in `esm.ts`.** Rejected — inverts the
  vfs→kernel→runtime layering and forces a runtime-wasi edge into runtime-js.
- **(C) Global singleton transform registry.** Reversible but order-fragile and
  hard to test; hides a hard data dependency in a global.

**Recommendation.** Option A. Ratify the hook's request-object shape
(`{source, id, loader: 'ts'|'tsx'|'jsx', workspace}` → `Promise<string>`).

**Consequences.** Public surface of `@rifty/runtime-js` grows by two optional
fields; future HMR/per-file invalidation reuses it. `.ts`-via-`require()` throws a
directed `NotImplementedError` (async esbuild can't run in the sync CJS path);
opencode is `type:module` so this never arises on the happy path.

---

### ADR-0053 (RATIFIED → `docs/adr/0053-ts-tsx-first-class-resolvable-extensions.md`) — `.ts`/`.tsx` as first-class resolvable + ESM extensions
*Feature 02. Reversibility rule 1 (observable cross-package behaviour) + rule 4 (>2 files).*

**Context.** Verified: `DEFAULT_EXTENSIONS = ['.js','.mjs','.cjs','.json']` and
`INDEX_FILES` lack `.ts`/`.tsx` (resolver.ts:25-26); `detectKind` classifies
unknown extensions as CJS. A bare `import … from "@/session/session"` landing on
`session.ts` does not resolve a file today.

**Options.**
- **(A) Recommended.** Add `.ts`,`.tsx` to `DEFAULT_EXTENSIONS`/`INDEX_FILES`
  **after** the `.js` family (so plain-Node packages shipping `foo.js` are
  byte-unchanged) and before `.json`; `detectKind` returns ESM for `.ts`/`.tsx`
  under a `type:module` scope, else CJS. Resolve unconditionally; a `.ts` that
  resolves with no transform hook throws a directed error (no silent stub).
- **(B) Per-package overlay rewriting `.ts`→`.js`.** Rejected — opencode ships
  hundreds of `.ts` with `exports: { "./*": "./src/*.ts" }`; does not scale.
- **(C) Resolve `.ts` but classify CJS.** Rejected — opencode is `type:module`.

**Recommendation.** Option A. The Node-resolution **deviation** (rifty resolves
bare `.ts` where Node-without-a-stripper does not) is intentional for opencode
but must be human-signed-off; cite **ADR-0004** (module loader) as the condition
set / resolution algorithm this deviates from.

**Consequences.** Changes resolver behaviour for ALL consumers (vite path,
conformance suite). Guarded by a parity case asserting `.js` still wins when both
`foo.js` and `foo.ts` exist. Spans `resolver.ts` + `esm.ts` + `loader.ts`.

---

### ADR-0054 (draft) — Per-load module resolution conditions (opt-in `bun`)
*Feature 03. Reversibility rule 1 (public API) — partial; deviates from ADR-0004's condition set.*

**Context.** opencode's `#db`/`#pty` `imports` maps carry a `bun` branch; rifty's
`CONDITIONS = ['node','default','import','require']` has no `bun`, so `#db` lands
on the `node` branch (`node:sqlite`). Both branches hit an unregistered builtin,
so adding `bun` alone unblocks nothing — it only chooses *which* specifier the
SQLite shim intercepts.

**Options.**
- **(A) Recommended-but-needs-ratification.** Add optional
  `ModuleLoaderOptions.conditions?: readonly string[]` + a `createResolver(vfs,
  {conditions})` arg; opencode loads with `['bun','node','import','default']`.
  Minimal public-API growth (one field, one arg). Deviates from ADR-0004's Node
  condition set (Node has no `bun`).
- **(B) Richer `importsOverride` table.** More flexible for feature 04's `#db`
  swap but a larger, more opinionated public API; defer.
- **(C) Zero-API-change shadow-registry `package.json` overlay.** REVERSIBLE —
  hardcode `#db`→a shim path via the VFS overlay, leaving the resolver and
  ADR-0004 untouched. Brittle across opencode versions but downgrades the whole
  decision to reversible.

**Recommendation.** **Prefer option (C)** unless a later feature truly needs
programmatic (non-overlay) condition control. The de-risk shows both `#db`
branches hit an unregistered builtin regardless of condition, so the overlay +
the throw-stub (Q-2026-05-30-102) suffice for P0/P2 with no public-API change. If
the team chooses (A), the ADR must frame the opt-in `bun` as a deliberate
deviation from ADR-0004.

**Consequences.** If (A): permanent `@rifty/runtime-js` surface; if (C): no API
change. The tier-A throw-stub registration (Q-2026-05-30-102) is REVERSIBLE
either way — only the *delivery vehicle* (conditions field) is gated.

---

### ADR-0055 (draft — SUPERSEDED by ratified ADR-0065, 2026-05-31) — WASM-SQLite engine for the `#db` shim
*Feature 04, tier B. Reversibility rule 2 (new external dependency) + rule 4.*

> **SUPERSEDED by ratified `docs/adr/0065-node-sqlite-databasesync-wasm-shim.md`
> (2026-05-31).** The engine recommendation (sql.js, in-memory-first) is ratified;
> the `#db`/`bun:sqlite` framing is CORRECTED to `node:sqlite` (the `#db` import
> map is stale at the pinned SHA — its targets don't exist and nothing imports
> `#db`; rifty resolves under the `node` condition). The text below is the
> historical draft.

**Context.** Unknown #1 is YES: the createRoutes graph statically loads
`session.ts → @/storage/db → #db → node:sqlite`. A resolvable throw-stub gets P0
graph-load, but P4 (real session storage) needs a real engine, because opencode
storage is **drizzle-on-SQLite** (`session.sql`), not the old JSON storage.

**Options.**
- **sql.js** (Emscripten SQLite, sync API). Pure-WASM, single `.wasm` + glue;
  sync `Database` with `.export() → Uint8Array`. Maps cleanly onto drizzle's
  sqlite drivers (which assume a sync prepare surface) and onto VFS-image
  persistence. *In-memory first; export-to-VFS later.*
- **wa-sqlite.** Async + OPFS persistence, but async impedance mismatch with
  drizzle's sync driver and a COI/SharedArrayBuffer requirement (interacts with
  ADR-0002).
- **absurd-sql.** Durable IndexedDB-block VFS on sql.js, but a second dep + COI/
  Worker requirement.
- **@sqlite.org/sqlite-wasm.** The source **ADR-0006 already names** in its
  substitution-source ordering. The official build is async/OO-API, which fights
  drizzle's sync prepare surface — must be evaluated and either adopted or the
  divergence documented, per ADR-0006 governance.

**Recommendation.** sql.js (in-memory first), **but** the ADR must explicitly
evaluate `@sqlite.org/sqlite-wasm` (the ADR-0006-prescribed source) and justify
the divergence. Cite ADR-0006 and ADR-0002 (COI for any OPFS path).

**Consequences.** New external dependency (IRREVERSIBLE). In-memory first light
means no cross-reload durability until export-to-VFS lands — the P4 persistence
criterion must be reconciled (Q-2026-05-30-114).

---

### ADR-0056 (draft — SUPERSEDED by ratified ADR-0065, 2026-05-31) — drizzle driver adapter for the WASM-SQLite `#db` shim
*Feature 04, tier B. Reversibility rule 2 (new dependency surface) + rule 4.*

> **SUPERSEDED by ratified `docs/adr/0065-node-sqlite-databasesync-wasm-shim.md`
> (2026-05-31).** Premise VOID at the pinned SHA: opencode uses
> `@effect/sql-sqlite-node` over `node:sqlite` `DatabaseSync`, NOT a drizzle
> driver, so no drizzle subpath redirect is needed — the shim target is the
> synchronous `DatabaseSync` surface. The text below is the historical draft.

**Context.** opencode's handlers use drizzle query builders (`eq/and/desc` over
`SessionTable`/`PartTable`) directly; the drizzle core (`export * from
"drizzle-orm"`) must stay real. Only the driver constructor + `migrate`
entrypoint are redirected.

**Options.**
- **`drizzle-orm/sql-js` driver (recommended).** Officially matches sql.js;
  smallest adapter; `init(path)` returns `{ db: drizzle(sqljs,{schema}), client }`
  matching `db.node.ts`'s shape. Redirect `drizzle-orm/bun-sqlite`,
  `drizzle-orm/node-sqlite`, and the runtime `drizzle-orm/bun-sqlite/migrator`
  subpath to a sql.js-backed shim.
- **`drizzle-orm/sqlite-proxy`.** Engine-portable (`(sql,params,method)=>rows`)
  but hand-rolled result-shape mapping risks dialect/return-shape bugs.
- **Hand-written drizzle-compatible Database.** Rejected — re-implements
  prepare/all/get/run.

**Recommendation.** `drizzle-orm/sql-js`, hard-coupled to the ADR-0055 engine.
**Open sub-question for the ADR:** `overrides.ts:resolveOverride` is PACKAGE-level
only — a SUBPATH remap (`drizzle-orm/bun-sqlite` → `drizzle-orm/sql-js`) needs
either an override-engine extension (a further cross-package change) or a
VFS-overlay of the subpath file. Determine which before ratifying.

**Consequences.** Pulls a drizzle subpath into the install/override graph. A
parity case must pin the drizzle result shape (rows vs run vs get) vs Node.

---

### ADR-0057 (RATIFIED as ADR-0054 → `docs/adr/0054-effect-consumes-node-http-as-is.md`) — Effect `@effect/platform-node` consumes rifty `node:http` AS-IS
*Feature 05. Reversibility rule 1 (the alternative adds cross-package public API).*

**Context.** Effect's `NodeHttpServer` touches only `createServer()` (no-handler
+ `server.on('request')`), `server.listen(options)`, and the
`IncomingMessage`/`ServerResponse` duck shapes (unknown #2). The request side and
buffered `end(body)` already work (express@4 precedent).

**Options.**
- **(A) Recommended — no new export.** Effect consumes the existing `node:http`
  builtin; all bridge work is **additive widening** of the shared http surface
  (listen overload, `'drain'` emission, pipe-target duck shape — each
  independently Node-parity-justified). Zero new cross-package public API.
- **(B) New `createEffectHttpServer()` export in `packages/net`.** IRREVERSIBLE —
  commits packages/net to an Effect-coupled public symbol forever and inverts the
  dependency direction (net knowing Effect).
- **(C) Adapter from a higher layer (harness/tools).** Avoids net API growth but
  couples to Effect's `NodeHttpServer` factory injection.

**Recommendation.** Option A. *Selecting between A and B/C is the irreversible
architectural fork* (once a public Effect adapter ships it cannot be quietly
removed) and needs human ratification, even though A itself is reversible.

**Consequences.** Evolves the shared http surface; each widening is documented as
a Node-parity gap closure, not an Effect hack. (The individual widenings are
logged as REVERSIBLE Q-2026-05-30-105/106/107.)

---

### ADR-0058 (draft) — runtime-js builtin surface additions for the Effect boot
*Feature 06. Reversibility rule 1 (public builtin surface) — CONTINGENT on a real gap.*

**Context.** Booting `Server.listen` headlessly may exercise a runtime-js builtin
method that does not yet exist (an Effect-runtime global, etc.). Adding such a
method widens the public builtin surface (Node-parity semantics matter).

**Correction (verified against the tree).** `os.hostname()` **already exists**
(`os.ts:20`) and `networkInterfaces()` returns `{}` (`os.ts:83`). The named
exemplar gap is closed; **re-aim this gate at the genuinely-unknown items**
discovered at bring-up, and add an explicit pre-boot check that `bonjour-service`
(mDNS) does not open a native UDP socket at module scope.

**Options.**
- **(A) Recommended — harness-local first.** Populate `process.env`/`argv` on the
  existing shim; only if a real boot path calls an unimplemented builtin does it
  become an ADR.
- **(B) Pre-emptively add `os.*`/`net.*`.** Rejected as speculative.
- **(C) Monkeypatch missing methods from the harness.** Rejected — a back-door
  silent stub mutating shared runtime-js state from a test.

**Recommendation.** Discover the gap by running the harness (it throws
`NotImplementedError` loudly), then STOP and ratify the concrete missing
method(s) with Node-parity semantics. Do not pre-add API, do not monkeypatch.
**Pre-flight:** statically inventory the createRoutes graph's `globalThis.*` /
`node:` / `process.*` references before the harness runs.

**Consequences.** Any added method is permanent public surface consumed
cross-package. If the mDNS path needs a native UDP socket at module scope, that is
a **hard blocker** to stub/prune, not an API addition to ratify.

---

### ADR-0059 (RATIFIED as ADR-0055 → `docs/adr/0055-opencode-sse-streaming-http-no-ws-shim.md`) — opencode event stream rides SSE-over-streaming-HTTP; no `ws` shim
*Feature 07. Reversibility rule 1 + bounds ADR-0048's streaming scope.*

**Context.** opencode's `/event` route is `text/event-stream` over HTTP GET
(Effect `HttpServerResponse.stream`), **not** a WebSocket. The only WS-shaped
route is PTY-connect (a hard blocker, stays stubbed). The SW→page hop already
transfers `ReadableStream` zero-copy; `ServerResponse.toResponse()` resolves a
live-stream `Response` at `flushHeaders()` — so SSE flows page-direct with no
transport change.

**Options.**
- **(A) Recommended.** SSE = streaming HTTP `Response` over the existing bridge.
  No `ws` shim for `/event`.
- **(B) Cross-realm `ws` shim for the event route.** Rejected — opencode never
  serves events over WS; pure impedance mismatch (the existing HMR
  `BridgedWebSocket` is same-origin BroadcastChannel and does not cover the SSE
  HTTP request).
- **(C) Buffer the SSE response.** Rejected — degrades the streaming event API.

**Recommendation.** Option A. The page-direct **implementation needs no new
code**, but this ADR formally rules OUT a `ws` shim and pins "SSE=streaming-HTTP"
as the cross-package contract — so even the zero-code page-direct ship and any
compat-matrix "supported" claim is **merge-gated** on this ADR. Cite ADR-0048.

**Consequences.** PTY-connect stays a throw-on-connect stub. SSE keep-alive/
reconnect semantics ride on top.

---

### ADR-0060 (draft) — `PREVIEW_PORT_FRAME_VERSION` 2→3: incremental SSE over the page↔Worker bridge
*Feature 07. Reversibility rule 3 (bumps a versioned wire contract governed by ADR-0048/ADR-0040) + rule 4 (>100 lines, page+worker paths).*

**Context.** Verified: `PREVIEW_PORT_FRAME_VERSION = '2'` (preview-port.ts:49);
the page side reassembles on `reply-stream-end`, which never fires for SSE, so an
opencode-in-Worker deployment hangs and trips the 30s no-progress idle timer.
**This directly contradicts ADR-0048 D2** ("page memory unchanged until M12;
true end-to-end ReadableStream is M12, ADR-0017") and partially fulfils
ADR-0017's deferred M12 criterion ("SerializedResponse carries a ReadableStream
body across postMessage").

**Options.**
- **(A) v3 bump (recommended, deferred).** Page constructs the `Response` from a
  live `ReadableStream` resolving on `reply-stream-start`; idle timer re-armed on
  every chunk (tolerating SSE keep-alive `:\n`); worker-death mid-stream errors
  the handed-out stream. Negotiated v3 with v2 buffered fallback.
- **(B) Keep v2, document Worker SSE as buffered/non-streaming.** Smallest;
  recommended SHIP order — defer the bump until `WorkerOwnerBinding`
  (Q-2026-05-27-002) is actually the opencode owner.
- **(C) Dedicated MessagePort with real backpressure.** The M12/ADR-0017 endgame;
  far larger.

**Recommendation.** Ship **page-direct SSE first (B)**; the v3 bump is SPECIFIED
here but **must not be coded/shipped until this ADR ratifies**. The ADR MUST cite
and supersede ADR-0048 D2's "page memory unchanged until M12" clause, clarify
whether this pulls M12 forward, and confirm v3 stays on the BroadcastChannel
carrier (no MessagePort) so the M12 envelope is intact. Amend ADR-0017's "SSE
hangs until M12" line.

**Consequences.** Non-additive change to a versioned contract; resolution
semantics change from resolve-on-end to resolve-on-start — in-repo callers of
`bridgeCrossRealmPreview` must be audited. Getting the idle-timer re-spec wrong
reaps live event streams.

---

### ADR-0061 (draft) — `node:https` client (request/get) delegates to fetch; server TLS stays loud-throw (supersedes ADR-0010)
*Feature 08. Reversibility rule 3 (supersedes ADR-0010) + rule 1 (cross-package builtin shape).*

**Context.** opencode provider calls use the `ai` SDK global `fetch` (browser
terminates TLS) — node:https likely never hits the hot path. node:https is a
loud-throw stub today (ADR-0010). Defensive/fallback `node:https.request` paths in
transitive deps would abort on a code path the browser can actually serve.

**Options.**
- **(A) Recommended.** Split node:https: **client** (`request`/`get`) → delegate
  to the existing `http.request → fetch` mapping forcing `https:`; **server/TLS**
  (`createServer`, `Agent`, `globalAgent`, `tls.connect`) → STAY loud-throw.
- **(B) Keep ADR-0010 fully.** Provider calls still work via global fetch, but a
  dep that falls back to node:https aborts — silent feature gap at runtime.
- **(C) Alias node:https = node:http wholesale.** Rejected — the silent stub
  ADR-0010 explicitly rejected; would fake server-side TLS.

**Recommendation.** Option A, as a **superseding ADR** (ADRs immutable — no edit
to 0010). The ADR MUST state explicitly: *ADR-0010's no-silent-plaintext
invariant is PRESERVED* — fetch performs real browser TLS; server TLS remains
loud-throw. **Pre-flight gate:** verify against pinned `ai@6`/`@ai-sdk/*` source
whether the global-fetch path constructs an `https.Agent` (keep-alive/proxy) at
init — if it does, the thrown Agent constructor is init-time-fatal for the LLM
round-trip and needs its own decision (no-op Agent vs P4-blocked).

**Consequences.** Restores outbound capability with zero new in-tab TLS code.
Fix the string-form scheme coercion to handle scheme-less hosts. Keep
`createServer`/`Agent`/`globalAgent` regression-locked as throwing.

---

### ADR-0062 (draft) — read-only tool substitutes: JS-first; ripgrep-WASM/isomorphic-git DEFERRED
*Feature 09. Reversibility rule 2 (any of these is a new external dependency).*

**Context.** Feature 09 marks the feasible side of the tool ceiling with ONE
read-only tool. The marker is a **pure-JS** VFS grep/read over the existing
`node:fs` builtin (zero spawn, zero new dep) — this needs NO ADR. But a future
effort wanting real ripgrep fidelity would adopt ripgrep-WASM (run via `runWasi`
like esbuild) or isomorphic-git or a WASM-search engine — each a NEW external
dependency.

**Options.**
- **Recommended — DEFER.** Keep the marker pure-JS now; open this ADR only when
  real ripgrep/git fidelity is actually needed.
- **Adopt ripgrep-WASM now.** Production-grade search + reuses esbuild WASI
  plumbing, but commits to a vendored binary before the facade stresses search.
- **Adopt isomorphic-git now.** Adds read-only git (log/blob) too — broader than
  needed to mark the line.

**Recommendation.** DEFER. This ADR is a **tripwire**: the pure-JS marker ships
under Q-2026-05-30-118/119 with no gate; adopting ripgrep-WASM/isomorphic-git/
wa-sqlite-search is BLOCKED until this ADR ratifies. Do not silently cross it
while implementing the marker tool.

**Consequences.** None until adopted; the deferral preserves the option to pick
ripgrep-WASM vs isomorphic-git vs JS later against concrete requirements.

---

## Section B — Reversible decisions (OPEN_QUESTIONS.md entries — copy-paste block)

> Append the block below to the **Active** section of `OPEN_QUESTIONS.md`. Q-ids
> are renumbered globally from `Q-2026-05-30-101` (the landed high-water mark is
> `-001`). Each carries a `TODO(ADR): Q-…` code marker and "Needs human review
> by: end of milestone M12".

```markdown
### Q-2026-05-30-101 — opencode source acquisition + facade-manifest flattening (feature 01)
- **Encountered in:** scripts/opencode-facade/*, tests/integration/fixtures/opencode/*
- **Context:** opencode is a Bun monorepo (workspace:/catalog: deps) the npm installer cannot parse; opencode is not vendored.
- **Options:** (a) vendor a pinned SHA snapshot + a derived npm-installable facade manifest (catalog:→concrete, drop workspace:, prune to the KEEP set); (b) teach npm-client Bun protocols (IRREVERSIBLE); (c) bun install + snapshot node_modules; (d) hand-write static facade JSON.
- **Decision taken (provisional):** (a) — vendor + generate facade.package.json via a one-shot pin script; overlay siblings by path; install the KEEP set unchanged.
- **Code markers:** TODO(ADR): Q-2026-05-30-101
- **Reversibility justification:** scripts/ + tests/fixtures only; no cross-package API; no bundled runtime dep; revert = delete the fixture dir. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-102 — node:sqlite/bun:sqlite throw-on-USE builtin registration site (features 03/04 tier A)
- **Encountered in:** tools/shadow-registry/src/register-sqlite-stub.ts (NOT runtime-js)
- **Context:** the createRoutes graph statically loads #db→node:sqlite, an unregistered builtin → MODULE_NOT_FOUND at resolve time; the registry is a process-wide singleton.
- **Options:** (a) register node:sqlite + bun:sqlite as throw-on-USE builtins from a shadow-registry/harness-local side-effect module imported ONLY by the opencode harness (mirrors net/register-builtins.ts); (b) register from runtime-js/builtins/index.ts (leaks the Bun specifier into ALL loads, wrong layer — contradicts feature 03).
- **Decision taken (provisional):** (a) — harness-local registration, scoped to the opencode load; constructor throws (no silent stub). RESOLVED CONFLICT with feature 04 (which proposed (b)): single owner is feature 03, harness-local.
- **Code markers:** TODO(ADR): Q-2026-05-30-102
- **Reversibility justification:** additive registration via the existing registerBuiltin extension point from a new harness-local module; ≤2 files; no new dep; matches net/https precedent. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-103 — opt-in 'bun' condition order (feature 03)
- **Encountered in:** packages/runtime-js/src/module-loader/resolver.ts (activeConditions)
- **Context:** #db/#pty carry a bun branch; rifty has no 'bun' condition. Adding it only chooses which specifier the sqlite shim intercepts (both branches hit an unregistered builtin).
- **Options:** (a) prepend 'bun' (steer #db→db.bun.ts→bun:sqlite, one canonical specifier) scoped per-load; (b) append after 'node' (steer→node:sqlite); (c) always-global 'bun' (rejected — could mis-resolve unrelated packages).
- **Decision taken (provisional):** scoped, opt-in per-load (default loads keep no 'bun'); branch choice flippable by feature 04 after measuring which drizzle driver shims cleaner. NOTE: reversibility is CONTINGENT on the scoped delivery (overlay or conditions field, ADR-0054); a global unconditional prepend would be cross-cutting (closer to IRREVERSIBLE).
- **Code markers:** TODO(ADR): Q-2026-05-30-103
- **Reversibility justification:** one internal array + a default, scoped per-load; revert <20 lines, one file; no ADR conflict. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-104 — TS-on-import esbuild loader selection + JSX default (feature 02)
- **Encountered in:** parity-runner + harness transform-hook call site
- **Context:** which esbuild loader per file, and how to handle JSX.
- **Options:** extension-only (.ts→'ts', .tsx→'tsx', .jsx→'jsx', else passthrough) with jsx:'automatic'; vs reading tsconfig jsx settings.
- **Decision taken (provisional):** extension-only loader; jsx:'automatic' for .tsx/.jsx. The facade serve path is JSX-free so this is dead weight in P0.
- **Code markers:** TODO(ADR): Q-2026-05-30-104
- **Reversibility justification:** pure call-site logic, no public API, no dep, <20 lines. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-105 — transformed-source cache key (feature 02)
- **Encountered in:** packages/runtime-js/src/module-loader/loader.ts
- **Context:** the opencode graph is large; each transform is a WASI process spawn.
- **Options:** id-keyed Map (drop on invalidate(id)); vs no cache; vs content-hash key.
- **Decision taken (provisional):** id-keyed Map, lazy-populated, cleared via the existing invalidate(id) path; content is immutable for an installed package version.
- **Code markers:** TODO(ADR): Q-2026-05-30-105
- **Reversibility justification:** internal Map inside createModuleLoader; no public API, no dep, <30 lines, one file. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-106 — esbuild 'workspace' (cwd preopen) for graph-wide transforms (feature 02)
- **Encountered in:** packages/runtime-js/src/module-loader/loader.ts → transform hook
- **Context:** a type-strip-only transform does not resolve relative imports through esbuild (rifty's resolver does), so a single cwd preopen suffices.
- **Options:** single workspace root = opts.workspace ?? opts.cwd; vs per-file package root; vs fixed '/workspace' literal.
- **Decision taken (provisional):** single root = opts.workspace ?? opts.cwd; matches the real-vite-smoke precedent.
- **Code markers:** TODO(ADR): Q-2026-05-30-106
- **Reversibility justification:** internal wiring of an existing optional field; <15 lines. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-107 — HttpServer.listen(options) overload (feature 05)
- **Encountered in:** packages/net/src/http/server.ts
- **Context:** Effect calls server.listen({port,host}, cb); rifty listen() takes only a bare number.
- **Options:** (a) widen listen() to accept Node's full overload (additive, benefits all consumers); (b) a separate Effect-only adapter export (IRREVERSIBLE — see ADR-0057); (c) shadow-registry shim on Effect's call site.
- **Decision taken (provisional):** (a) — widen listen(port|options, hostOrCb?, cb?); extract port from either form; ignore host (loopback-only); existing bare-number path unchanged. Node's real http.Server.listen accepts an options object, so this is a genuine parity gap.
- **Code markers:** TODO(ADR): Q-2026-05-30-107
- **Reversibility justification:** single file, additive widening of an existing method's input, no new exported symbol, <100 lines. Rule 4 → no → Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-108 — ServerResponse emits Node-style 'drain' (feature 05)
- **Encountered in:** packages/net/src/http/response.ts
- **Context:** Effect's streaming write loop parks on nodeResponse.on('drain') and ignores write()'s return; rifty signals backpressure only via the write() Promise, never a 'drain' event → streaming hangs.
- **Options:** (a) emit 'drain' on the internal pull() with room, gated by a _needDrain flag set when write() returned the backpressure Promise (avoid spurious drain); (b) patch Effect via shadow-registry (rejected — couples to Effect internals); (c) buffer everything (rejected).
- **Decision taken (provisional):** (a) — additive event; write()'s boolean|Promise return unchanged for existing callers.
- **Code markers:** TODO(ADR): Q-2026-05-30-108
- **Reversibility justification:** single file, additive event, no new export, no dep, <30 lines. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-109 — ServerResponse as a valid pipe target (feature 05)
- **Encountered in:** packages/net/src/http/response.ts AND packages/io/src/streams/readable.ts
- **Context:** Effect uses Readable.fromWeb(stream).pipe(res); ServerResponse is an EventEmitter, not a Writable pipe-sink. Making it a target requires widening @rifty/io PipeableWritable.write return type to boolean|Promise<boolean> — a SECOND package (io) change.
- **Options:** (a) add the duck-sink + widen PipeableWritable in @rifty/io (touches packages/io — affectedPackages MUST include io; cite ADR-0034 which restores Node's boolean-only write contract, so this is a deliberate divergence); (b) DEFER pipe-sink entirely (the facade serves JSON/SSE not FormData; the Effect web-stream-response path is unsupported until Readable.fromWeb lands — which @rifty/io lacks, no owner).
- **Decision taken (provisional):** PREFER (b) DEFER — register the gap in compat-matrix; pipe-sink + the io widening only if a real P4 route needs it. If (a) is taken, keep write() returning raw boolean (drain carries backpressure) to stay Node-faithful per ADR-0034.
- **Code markers:** TODO(ADR): Q-2026-05-30-109
- **Reversibility justification:** if deferred, zero change; if taken, ≤2 files (response.ts + io readable.ts), additive duck methods + a one-line return-type widen. Rule 4 borderline — re-classify to cross-package if the io widen lands. Rule 5 if deferred.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-110 — opencode mDNS-off / ptyConnectApi via Server.listen(opts)+env (feature 06)
- **Encountered in:** tests/integration/fixtures/real-opencode-smoke.ts
- **Context:** disable mDNS and drop ptyConnectApi at boot without patching opencode source.
- **Options:** (a) drive via Server.listen(opts) + env opencode already reads (loopback hostname gates mDNS; never construct a PtyConnectApi consumer); (b) patch opencode source in the VFS overlay (rejected — boot-config source edits drift on every bump).
- **Decision taken (provisional):** (a). Set env/argv before importing the server module. If Server.listen has no mDNS knob, depend on bonjour-service being import-safe (escalate to feature 03's prune/keep list if it dlopens at module scope).
- **Code markers:** TODO(ADR): Q-2026-05-30-110
- **Reversibility justification:** lives in one fixture file (a test asset); no public API, no dep. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-111 — staged success markers for the headless boot (feature 06)
- **Encountered in:** tests/integration/fixtures/real-opencode-smoke.ts
- **Context:** distinguish "layers build" (P2) from "route round-trips" (P3) for regression localization.
- **Options:** (a) two staged markers (RIFTY_OPENCODE_LAYERS_OK then RIFTY_OPENCODE_ROUTE_OK) in one fixture; (b) single all-or-nothing marker; (c) two separate fixtures.
- **Decision taken (provisional):** (a) — localizes a regression to shim (03/04) vs bridge (05) vs harness (06).
- **Code markers:** TODO(ADR): Q-2026-05-30-111
- **Reversibility justification:** log strings + assertions in two new test assets. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-112 — trivial no-storage route + in-process dispatch (feature 06)
- **Encountered in:** tests/integration/fixtures/real-opencode-smoke.ts
- **Context:** which P3 route to hit, and how to address it without a SW in a tsx child.
- **Options:** (a) a version/status GET route that touches NO Storage, addressed via dispatchToPort(port, Request); (b) a session/project route (rejected — instantiates Storage → pulls P4 in); (c) the SW cross-realm bridge (rejected — no SW in a tsx child).
- **Decision taken (provisional):** (a). The exact route is pinned from opencode's real route table with a TODO(ADR) that it MUST avoid Storage to stay below the WASM-SQLite/P4 line.
- **Code markers:** TODO(ADR): Q-2026-05-30-112
- **Reversibility justification:** route selection + in-process dispatch in the fixture; one-line change. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-113 — SSE chunk-vs-event boundary on the byte transport (feature 07)
- **Encountered in:** packages/net/src/cross-realm/preview-port.ts (MAX_CHUNK_BYTES)
- **Context:** the page↔Worker hop splits at 64KiB byte boundaries; an SSE event may span multiple chunks.
- **Options:** (a) keep byte-level splitting; the page-side consumer must feed bytes to a TextDecoder/EventSource and NOT treat a chunk boundary as an event boundary; (b) align chunk boundaries to SSE event boundaries (rejected — couples a byte transport to a text protocol).
- **Decision taken (provisional):** (a) — byte-faithful framing + a consumer-contract note.
- **Code markers:** TODO(ADR): Q-2026-05-30-113
- **Reversibility justification:** a comment + a consumer-contract note, no API change. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-114 — opencode persists to SQLite-over-VFS (not JSON-over-VFS) (feature 08)
- **Encountered in:** tests/integration/fixtures/opencode-facade-boot.ts
- **Context:** the feasibility doc's "JSON-over-VFS" is overturned by the de-risk — opencode@dev is drizzle-on-SQLite; persistence is owned by feature 04's #db shim.
- **Options:** (a) F8 selects a per-instance VFS db path and asserts read-back; persistence shape is feature 04's; (b) override opencode's Storage layer to JSON-on-VFS (rejected — re-implements drizzle); (c) in-memory-only (loses durability).
- **Decision taken (provisional):** (a) — select a VFS path; durability degrades to same-process read-back if feature 04 ships in-memory-first. CROSS-REFERENCE: P4 durability criterion must be reconciled (export-to-VFS promoted in feature 04, or P4 scoped to in-memory).
- **Code markers:** TODO(ADR): Q-2026-05-30-114
- **Reversibility justification:** a path/option passed into opencode's own layers; no public API, no dep. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-115 — buffered (non-stream) inbound completion for the P4 proof (feature 08)
- **Encountered in:** tests/integration/opencode-llm-flow.*.test.ts
- **Context:** streaming inbound (SSE) rides the unfinished ServerResponse drain/pipe gaps (feature 05/07).
- **Options:** (a) drive P4 with a non-stream completion riding the proven buffered res.end(body) path (outbound fetch may still stream); (b) full streaming end-to-end (pulls feature 05/07 work into F8, risks a hang).
- **Decision taken (provisional):** (a) — assert a buffered JSON read (Content-Length, not chunked). Streaming inbound is feature 07's domain.
- **Code markers:** TODO(ADR): Q-2026-05-30-115
- **Reversibility justification:** test-harness mode + endpoint selection; no source change, no dep. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-116 — provider URL/key via harness env (feature 08)
- **Encountered in:** tests/integration/fixtures/opencode-facade-boot.ts
- **Context:** the LLM provider config must reach the runtime without a hardcoded URL or secret (honors D-004).
- **Options:** (a) inject provider base URL + key via the harness process.env; run the live test sandbox-disabled, reading the key from the user's existing env (do not echo/check it); ADD a CI-friendly canned-fetch companion; (b) hardcode a provider URL (rejected — violates D-004).
- **Decision taken (provisional):** (a) — env-injected config + a live test gated like existing live tests + a canned companion for default CI.
- **Code markers:** TODO(ADR): Q-2026-05-30-116
- **Reversibility justification:** config injection via env + test gating; no dep, no cross-package API; actively honors D-004. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-117 — boundary doc lives in docs/compat/ (feature 09)
- **Encountered in:** docs/compat/opencode-tool-ceiling.md
- **Context:** where the FEASIBLE-vs-IMPOSSIBLE tool table is authoritative and discoverable.
- **Options:** (a) docs/compat/ (the compat source-of-truth per CLAUDE.md), cross-linked from the feasibility doc; (b) feasibility-doc-only (drifts from compat); (c) auto-via-NotImplementedError feature keys (presupposes the tool-layer integration exists).
- **Decision taken (provisional):** (a) — ✅/⚠ read substitutes, ❌ spawn-ceiling tools.
- **Code markers:** TODO(ADR): Q-2026-05-30-117
- **Reversibility justification:** documentation placement only (the "always reversible" category). Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-118 — pure-JS VFS grep marker tool over ripgrep-WASM (feature 09)
- **Encountered in:** packages/runtime-js/src/utils/vfs-grep.ts
- **Context:** mark the feasible side of the tool ceiling with ONE read-only tool.
- **Options:** (a) pure-JS recursive grep/read over the existing node:fs builtin (zero spawn, zero dep); (b) ripgrep-WASM via runWasi (NEW dep — IRREVERSIBLE, ADR-0062); (c) isomorphic-git read ops (NEW dep — IRREVERSIBLE).
- **Decision taken (provisional):** (a) — pure-JS, in-realm, no spawn; promote to ripgrep-WASM only if/when search is exercised at scale (gated by ADR-0062).
- **Code markers:** TODO(ADR): Q-2026-05-30-118
- **Reversibility justification:** a private helper (not a cross-package export); uses node:fs + JS RegExp; no new dep; revert ≤2 files <100 lines. Rule 5.
- **Needs human review by:** end of milestone M12

### Q-2026-05-30-119 — pin the spawn ceiling as a behavioral contract (feature 09)
- **Encountered in:** packages/runtime-js/src/builtins/child_process-ceiling.test.ts
- **Context:** prove the impossible side is walled off, not just asserted in prose.
- **Options:** (a) a conformance test that spawn('git'|'bash') surfaces ENOENT-127 (never fake-succeeds) and PTY throws on session-create, tested on rifty's spawn substrate; (b) vendor opencode and drive its real git/bash tool (out of scope — opencode not vendored); (c) prose-only (insufficient by project rules).
- **Decision taken (provisional):** (a) — assert on 'git'/'bash' (always-fallthrough), avoid coupling to 'node' routing which is env-dependent.
- **Code markers:** TODO(ADR): Q-2026-05-30-119
- **Reversibility justification:** a test only; no production code, no API, no dep. Rule 5.
- **Needs human review by:** end of milestone M12
```

---

## New external dependencies introduced (each IRREVERSIBLE per rule 2)

| Dependency | Introduced by | Purpose | Gate |
|------------|---------------|---------|------|
| **sql.js** | 04 tier B (now P2) | WASM-SQLite engine (synchronous, in-memory) behind the `node:sqlite` `DatabaseSync` shim — the P2 boot prerequisite | **RATIFIED: ADR-0065** |
| ~~**drizzle-orm/sql-js** driver subpath~~ | ~~04 tier B~~ | VOID at the pinned SHA — opencode uses `@effect/sql-sqlite-node` over `node:sqlite`, not drizzle (see ADR-0065 §Supersedence) | n/a (ADR-0056 superseded) |
| **@sqlite.org/sqlite-wasm** + OPFS *(DEFERRED)* | 04 follow-up | durable persistence engine for the deferred OPFS-`SyncAccessHandle` follow-up | Q-2026-05-31-301 — do not adopt now |
| **ripgrep-WASM** *(DEFERRED)* | 09 (future) | production-grade search substitute via `runWasi` | ADR-0062 — do not adopt now |
| **isomorphic-git** *(DEFERRED)* | 09 (future) | read-only git (log/blob) substitute | ADR-0062 — do not adopt now |

Explicitly **NOT** new dependencies (verified): the vendor script's dev-only
shell-out to git/curl (not bundled, feature 01); the parity-runner gaining
`@rifty/runtime-wasi`+`shadow-registry` import edges + the `esbuild.wasm`
artifact (feature 02 T6) — *confirm `esbuild.wasm` is already vendored, not a new
fetch, before declaring T6 dependency-free*; no `ws` shim for the
event route (feature 07 explicitly rules it out); no `Agent` mapping (feature 08
keeps it loud-throw — unless the `ai`-SDK Agent-at-init pre-flight forces a new
decision).
