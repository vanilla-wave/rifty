# Feature 08-llm-flow — HTTPS outbound (https->fetch) + JSON-over-VFS storage -> session + LLM round-trip

> Part of the opencode-in-rifty facade effort. Feasibility phase P4. Staged doc — NOT a ratified ADR.

## Summary

P4 milestone: enable opencode to call an LLM provider over the network and persist a session, then prove `session create + one LLM message round-trip` with NO tool execution. Two sub-problems, classified separately.

**(1) OUTBOUND HTTPS.** opencode's provider calls go through the `ai` SDK + `@ai-sdk/*` providers, which use the global `fetch` (WHATWG) — NOT `node:https.request`. The browser already terminates TLS for `fetch`, so the provider round-trip works without any `node:https` work AT ALL, exactly as the feasibility doc states (`docs/opencode-rifty-feasibility-2026-05-30.md:22-24`). However, some transitive deps (or the `ai` SDK's Node fallback path) defensively reach for `node:https.request`/`get`. Today that is a loud-throw stub (`packages/net/src/https.ts`; registered `packages/net/src/register-builtins.ts:17` per ADR-0010). F8 maps the `node:https` CLIENT surface (`request`/`get`) onto `fetch` — reusing the EXACT pattern the `node:http` builtin already uses (`packages/net/src/http/server.ts:83-127` `request()` -> `fetch(url,...)` -> `IncomingMessageFromFetch`). `createServer`/`Agent`/server-side TLS stays loud-throw (true browser TLS termination is the real hard blocker ADR-0010 named). This SUPERSEDES ADR-0010's outbound-client clause -> IRREVERSIBLE (checklist rule 3 + rule 1 if exposed as runtime-js public API).

**(2) STORAGE.** De-risk finding `opencode-package-surface` overturns the feature's premise: opencode@dev storage is drizzle-on-SQLite (`session.sql` tables), NOT the old JSON storage. So "JSON-over-VFS" is NOT a drop-in for P4 — the persistence is whatever the `#db` shim (feature 04) provides (WASM-SQLite over a VFS-backed file). F8 therefore does NOT own a JSON storage adapter; it DEPENDS on feature 04. F8's storage contribution is narrow and reversible: a per-instance VFS storage ROOT/dbPath selection + a thin assertion harness that the SQLite-over-VFS file persists session rows across a read-back. If feature 04 lands a `sqlite-proxy`/JSON-backed driver instead of a real file, F8 just points it at a VFS path.

F8 is the integration/proof feature: it wires outbound HTTPS-via-fetch, drives `session.create` + one `prompt`/message round-trip against a REAL provider (network, sandbox-disabled per running-real-packages methodology), and asserts persisted state. Streaming responses (the LLM stream) ride the ServerResponse drain/pipe gaps already logged by feature 05/07 — F8 consumes them, does not re-fix them.

## Decisions (classified)

### D1 — Map node:https CLIENT surface (request/get) onto fetch

**Question:** Map `node:https` CLIENT surface (`request`/`get`) onto `fetch`, superseding ADR-0010's loud-throw for the outbound client path?

**Classification:** IRREVERSIBLE

> **⚠️ WARNING: IRREVERSIBLE — RECOMMENDED, AWAITING RATIFICATION. This decision supersedes the immutable ADR-0010 client clause and changes a cross-package observable builtin shape. A human MUST ratify the superseding ADR before any code edit (T2/T7). Do not invent the answer.**

**Chosen (RECOMMENDED — awaiting ratification):** Write a new ADR superseding ADR-0010 that splits `node:https` into two surfaces:
- **(a) CLIENT (`request`/`get`)** -> delegate to the existing `http.request()` fetch-mapping in `packages/net/src/http/server.ts:83-127`, forcing protocol `'https:'` so the URL is built as `https://host`. The browser terminates TLS for the resulting fetch — there is no in-tab TLS code, which is exactly what ADR-0010 said was missing; fetch sidesteps it.
- **(b) SERVER/TLS (`createServer`, `Agent` constructor, `globalAgent`, `tls.connect`)** -> STAY loud-throw `NotImplementedError`.

Implement by changing `packages/net/src/https.ts` to `import { request as httpRequest } from './http/server.ts'` and wrap it forcing the https protocol; keep `register-builtins.ts:17` registration. Per de-risk, opencode's actual provider calls go through `ai` SDK global fetch and likely never hit `node:https`; this change exists to satisfy DEFENSIVE/fallback `node:https.request` paths in transitive deps so they don't loud-throw on a code path the browser can actually serve.

**Alternatives:**
- **A) Keep ADR-0010 fully (do nothing):** provider calls via global fetch still work, but any dep that falls back to `node:https.request` throws and may abort the round-trip. Risk: silent feature gap discovered only at runtime.
- **B) Alias `node:https = node:http` wholesale** (the pre-ADR-0010 behavior ADR-0010 explicitly REJECTED as a silent stub): violates the no-silent-stubs rule because it would also make `https.createServer` pretend to be a TLS server.
- **C) Map ALL of `node:https` incl. `createServer` to http:** contradicts ADR-0010's core finding (no browser TLS termination) — strictly worse than A.

**Trade-offs:** Option chosen restores outbound capability with zero new browser-TLS code (fetch owns TLS) while preserving ADR-0010's true invariant (no fake server-side TLS). Cost: it reverses ADR-0010's stated 'terminal state' for the client clause, so it MUST be a superseding ADR, not an edit (ADRs immutable after merge). Touches `packages/net` public behavior (`node:https` builtin shape) -> cross-package-visible. Whether `node:https` client is itself runtime-js public API depends on feature 03/01 registering it for opencode's graph; if so, rule 1 also fires.

**Reversibility justification:** Rule 3: directly contradicts/supersedes ADR-0010 (immutable). Rule 1: `node:https` builtin is cross-package observable surface. Either alone makes it IRREVERSIBLE; do not invent — surface to human with this ADR draft.

**Proposed ADR:** ADR-00NN: node:https client (request/get) delegates to fetch; server-side TLS remains loud-throw (supersedes ADR-0010)

### D2 — Where does opencode persist session/db state?

**Question:** Where does opencode persist session/db state — JSON-over-VFS (as the feature title says) or the SQLite-over-VFS file produced by the `#db` shim (feature 04)?

**Classification:** REVERSIBLE

**Chosen:** F8 does NOT introduce a JSON storage layer. De-risk finding `opencode-package-surface` proves opencode@dev uses drizzle-on-SQLite (`session.sql`), so persistence is owned by feature 04's `#db` WASM-SQLite shim. F8 selects a per-instance VFS path for the db file (e.g. a fixed ROOT like `/opencode/storage` under `MemoryVfs`/`OpfsVfs` from `packages/vfs`) via opencode's Storage/AppFileSystem layer options, and asserts rows survive a read-back. Mark `TODO(ADR) Q-2026-05-30-001`.

**Alternatives:**
- **A) Override opencode's Storage layer itself to a JSON-on-VFS implementation, bypassing drizzle** — large, fragile (must reimplement the drizzle query surface `session.ts` uses: `eq`/`and`/`desc`/`PartTable`/`SessionTable`), and duplicates feature 04's effort.
- **B) In-memory-only SQLite (no VFS file):** simplest for the round-trip proof but loses the 'persist over VFS' acceptance criterion and can't demonstrate cross-reload durability.

**Trade-offs:** Chosen keeps F8 thin and avoids re-implementing drizzle. Cost: F8 is now blocked on feature 04's storage shape; if 04 delivers an in-memory-only proxy first, F8's durability assertion degrades to a same-process read-back rather than a reload. Selecting a VFS path is single-file, additive, <100 lines, no new dep, no public API between packages -> REVERSIBLE.

**Reversibility justification:** No public API between packages (just an option/path passed into opencode's own layers), no new dep, does not contradict an ADR, revert is trivial (change the path or drop the assertion). Rule 5 -> REVERSIBLE.

**Proposed Q-id:** Q-2026-05-30-001

### D3 — Does the LLM round-trip require streaming responses?

**Question:** Does the LLM round-trip require streaming responses (SSE/chunked) back to the rifty page, or is a buffered (non-stream) completion enough for the P4 proof?

**Classification:** REVERSIBLE

**Chosen:** Drive the P4 proof with a NON-streaming completion call where possible (request the provider's non-stream mode / await full body), so the proof rides only the already-proven buffered `res.end(body)` path (de-risk unknown-2: buffered path works AS-IS, matches express@4). The OUTBOUND fetch to the provider can stream (the `IncomingMessageFromFetch` in `request.ts:85-98` already drains chunk-by-chunk via `pipeBodyStream`), but the INBOUND response from rifty's opencode server to the test harness is asserted as a buffered JSON read. Streaming inbound (SSE) is feature 07's domain. Mark `TODO(ADR) Q-2026-05-30-002`.

**Alternatives:**
- **A) Full streaming end-to-end in P4:** exercises the ServerResponse `'drain'`/`'pipe'` gaps (de-risk unknown-2 implication; `response.ts:53-65` lacks `emit('drain')`, and ServerResponse is not a `.pipe()` Writable sink) — would force F8 to absorb feature 05/07 work and risk a hang.
- **B) Buffer everything incl. the provider call:** simplest but loses the streaming-provider realism and hides the chunk-boundary path the SDK uses.

**Trade-offs:** Chosen isolates F8's proof from the unfinished streaming-inbound machinery while still proving a real provider round-trip. Cost: P4 does not yet prove token-by-token streaming to the browser — explicitly deferred to feature 07. Reversible: it's a test-harness mode choice + which opencode endpoint the proof hits; no source change, no dep, no API.

**Reversibility justification:** Pure test/harness strategy and endpoint selection; no cross-package API, no dep, no ADR conflict, trivially revertible. Rule 5 -> REVERSIBLE.

**Proposed Q-id:** Q-2026-05-30-002

### D4 — How does the provider API key / config reach the runtime?

**Question:** How does the LLM provider API key / config reach the provider inside the runtime without a hardcoded URL or secret?

**Classification:** REVERSIBLE

**Chosen:** Inject provider base URL + key via the headless harness's `process.env` (the harness already replaces `globalThis.process` per `tests/integration/fixtures/real-vite-smoke.ts`) and let opencode's normal provider config read them; the registry/base-URL stays configurable (honors D-004 'no hardcoded URLs'). For the parity/live test, run sandbox-disabled (running-real-packages methodology) and read the key from the real env the user already has set (do not echo/check it — per global instruction). Mark `TODO(ADR) Q-2026-05-30-003`.

**Alternatives:**
- **A) Mock the provider with a local in-runtime fetch interceptor returning a canned completion:** deterministic, no network, no key — good for CI, but does NOT satisfy 'keep provider calls real (network)' from the feature intent. Recommended to ADD as a SEPARATE CI-friendly test alongside the live one, not as a replacement.
- **B) Hardcode a provider URL:** violates D-004, rejected.

**Trade-offs:** Chosen keeps the call real and config-driven. Cost: the live test needs network + a real key, so it cannot run in default sandboxed CI — gate it like the existing live/parity tests. Reversible: env wiring + test gating only.

**Reversibility justification:** Config injection via env + test gating; no new dep, no cross-package API, no ADR conflict (actively honors D-004). Rule 5 -> REVERSIBLE.

**Proposed Q-id:** Q-2026-05-30-003

## Interface contract

Outbound https client (`packages/net/src/https.ts`), reusing the http fetch-mapping:

```ts
// node:https CLIENT surface delegates to the existing http.request fetch path,
// forcing https: protocol so the URL is built as https://host:port/path.
function request(
  opts: string | { method?: string; hostname?: string; port?: number; path?: string; headers?: Record<string,string>; protocol?: string },
  cb?: (res: IncomingMessageFromFetch) => void,
): EventEmitter & { write(chunk: Uint8Array|string): void; end(chunk?: Uint8Array|string): void };

function get(opts, cb): /* request() with method GET, auto-.end() */ ...;

// UNCHANGED (still loud-throw — real server TLS is the hard blocker):
createServer: () => never;     // NotImplementedError('node:https.createServer')
Agent: class { constructor() { throw NotImplementedError } };
globalAgent: <throwing proxy>;
```

Storage selection (no new public API — passed into opencode's OWN layer options):

```ts
// chosen at harness/boot time, not a rifty package export:
Server.listen({ storageRoot: '/opencode/storage', mdns: false, /* dbPath derives from storageRoot via #db shim */ })
```

P4 proof harness (forks `tests/integration/fixtures/real-vite-smoke.ts`; not a public API):

```ts
bootOpencodeFacade(vfs, { providerBaseUrl, providerKeyFromEnv }) -> { port }
// then via SW/cross-realm bridge or in-process dispatchToPort(port, Request):
//   POST /session                      -> 200 JSON { id }
//   POST /session/:id/message (no tools, non-stream) -> 200 JSON assistant message
//   assert: a session row + message part persisted (read-back through #db / VFS)
```

No change to `PortHandler` (`packages/net/src/registry.ts`: `(Request)=>Promise<Response>`) — F8 only consumes it.

## Affected packages & seams

Affected packages:
- `packages/net`
- `tests/integration`
- `docs/adr`
- `docs/opencode-rifty-feasibility-2026-05-30.md`

Seam anchors:
- `packages/net/src/https.ts:1-46` (loud-throw stub to be superseded for the client surface)
- `packages/net/src/register-builtins.ts:16-17` (node:https registration point)
- `packages/net/src/http/server.ts:83-127` (existing `request()` -> fetch mapping; the exact pattern node:https client reuses, incl. `fetch(url,{method,headers,body})` at L112)
- `packages/net/src/http/request.ts:85-98` (`IncomingMessageFromFetch` — client response shape, chunk-by-chunk drain via `pipeBodyStream` L46-67)
- `packages/net/src/http/response.ts:53-65` (pull/pendingPulls; ServerResponse drain gap that F8 AVOIDS by using buffered `res.end(body)` — de-risk unknown-2)
- `packages/net/src/http/response.ts:185-221` (`end(body)` buffered path the P4 proof rides; proven for express@4)
- `packages/net/src/registry.ts` (`PortHandler (Request)=>Promise<Response>`; F8 consumes `dispatchToPort`, no change)
- `tests/integration/fixtures/real-vite-smoke.ts` (headless harness template to fork for the opencode facade boot + round-trip proof)
- `docs/adr/0010-https-loud-throw.md:1-40` (ADR superseded for the outbound-client clause)
- `packages/vfs/src/index.ts:9-11` (`MemoryVfs`/`OpfsVfs`/`OpfsFsSync` — the VFS the storage db file lives on)

## Dependencies

Depends on:
- `01-load-opencode-into-vfs`
- `02-ts-on-import-graph`
- `03-conditional-imports-and-bun-sqlite-intercept`
- `04-db-and-pty-shims`
- `05-effect-http-bridge`
- `06-headless-server-boot`

**Blocker proximity:** CLOSEST feature to the hard ceiling but stays strictly on the feasible side.
1. **Outbound:** sits right at the `node:https`/TLS blocker but routes AROUND it — provider calls use global fetch and the new `https.request` delegates to fetch, both of which let the BROWSER terminate TLS; no in-tab TLS code is written, so ADR-0010's real invariant (no browser TLS termination) is untouched. `https.createServer`/`Agent` stay loud-throw, explicitly NOT crossing the server-TLS blocker.
2. **Round-trip is deliberately NO-TOOLS:** it stops exactly at the documented tool-execution ceiling (no `Git.run`/`ChildProcess.make`, no bash, no ripgrep, no PTY) — the message is generated and persisted but never executes a tool.
3. **Storage rides feature 04's WASM-SQLite,** NOT native `bun:sqlite`/`node:sqlite` (those are the import-time-fatal blockers).
4. **Streaming-inbound is fenced off to feature 07** to avoid F8 tripping the ServerResponse drain/pipe gaps (de-risk unknown-2) — F8 uses only the proven buffered `res.end(body)` path.

The one residual risk is that a transitive dep needs `node:https.createServer` (true server TLS) — if so it loud-throws by design, marking the boundary rather than faking it.

## Test strategy

Levels: parity (gold standard) where Node-comparable, plus integration/live and unit.

1. **PARITY (node:https client === node:http client mapping):** a parity case that issues `https.request` and `http.request` to the SAME endpoint and diffs the response shape/headers/body — confirming the client mapping is Node-faithful (status, lowercased headers, streamed body). This is the project-preferred level for the https->fetch behavior because it pins our client to Node's observable contract, not hand-rolled asserts.

2. **UNIT (net):** `https.createServer`/`Agent`/`globalAgent` STILL throw `NotImplementedError` (lock in that the ADR-0010 server-TLS invariant is preserved — no silent regression); `https.request` forces protocol `https:` and builds `https://host` URL.

3. **INTEGRATION / LIVE (the P4 proof, sandbox-disabled per running-real-packages methodology):** fork `real-vite-smoke.ts` to boot opencode's `Server.listen` headlessly (depends on features 01-06), then POST `/session` -> 200 JSON, POST a no-tools message (non-stream) -> 200 JSON assistant reply against a REAL provider via global fetch; assert persisted session/message rows read back through the `#db` shim. Gate like existing live tests (needs network + real key).

4. **INTEGRATION (CI-friendly companion, no network):** same flow with a local in-runtime fetch interceptor returning a canned completion — deterministic regression guard so the wiring is tested in default sandboxed CI even when the live test is skipped.

Streaming-inbound (SSE token stream) is NOT tested here — owned by feature 07.

## Implementation plan (test-first)

1. **T1 — Lock in the ADR-0010 SERVER-TLS invariant (regression lock, kind: unit).** Before touching `https.ts`, assert that `https.createServer` / `new https.Agent()` / `globalAgent` property access STILL throw `NotImplementedError` (`'node:https.createServer'` / `'.Agent'` / `'.globalAgent.*'`). This is a unit test in `@rifty/net` (not parity): the parity runner's rifty side imports ONLY `@rifty/runtime-js/loader` and does NOT register `node:http`/`node:https` — confirmed in `tools/node-parity-runner/src/run-in-rifty.ts:14-16` and documented in `cases/http/parse-url.case.ts` — so `node:https` behavior is unreachable from the parity runner without a runner change out of F8 scope. The net-package is the correct level for this builtin's shape.
   - **Failing test to write first:** `packages/net/src/https.test.ts` (NEW): test `'server-side TLS surface stays loud-throw'` — `expect(() => https.createServer()).toThrow(NotImplementedError)` with message matching `/node:https.createServer/`; `expect(() => new https.Agent()).toThrow(/node:https.Agent/)`; `expect(() => https.globalAgent.maxSockets).toThrow(/globalAgent/)`. Note: these pass today since all throw — phrase as a regression lock written to STAY green through T2. Write it now, confirm green, and T2 must keep it green.
   - **Files:** `packages/net/src/https.test.ts`
   - **Kind:** unit

2. **T2 — Map the node:https CLIENT surface (request/get) onto the http fetch-mapping, forcing protocol `'https:'` (kind: unit).** Reuse `packages/net/src/http/server.ts:83-127` `request()` — do NOT duplicate the fetch logic. `https.request(opts, cb)` delegates to http `request()` with `opts.protocol` coerced to `'https:'` so the URL is built as `https://host:port/path`; `https.get` is `request()` with method `'GET'` that auto-calls `.end()`. `createServer` / `Agent` / `globalAgent` remain the loud-throw stubs from T1. This is the IRREVERSIBLE change (supersedes ADR-0010 client clause + cross-package observable builtin shape) — see ratification gate.
   - **Failing test to write first:** `packages/net/src/https.test.ts` (extend, NEW assertions, RED before edit): test `'https.request builds an https:// URL and delegates to fetch'` — stub `globalThis.fetch` with a `vi.fn()` returning a canned `Response('{"ok":true}', {status:200, headers:{'content-type':'application/json'}})`; call `https.request({ hostname:'api.example.com', port:443, path:'/v1/x', method:'POST', headers:{'content-type':'application/json'} }, cb)`; `req.end('{}')`; await the `'response'` event; assert fetch was called with first arg `=== 'https://api.example.com:443/v1/x'` (NOT http://), method `'POST'`, and the cb received an `IncomingMessageFromFetch` with `statusCode 200` and lowercased `headers['content-type']==='application/json'`. Second test `'https.get auto-ends and defaults GET'` — `https.get('https://api.example.com:443/v1/y', cb)`; assert fetch called with method `'GET'` and URL unchanged. These FAIL today (request/get currently notImpl-throw).
   - **Files:** `packages/net/src/https.ts`, `packages/net/src/https.test.ts`
   - **Kind:** unit

3. **T3 — Pin the Node-faithful equivalence between the https and http client mapping at the parity level WHERE REACHABLE (kind: parity).** The parity runner cannot register `node:https` (see T1), so the parity case exercises the URL/headers/body SHAPE the client builds via `node:url` + a stubbed fetch installed in the case code itself — matching the existing `parse-url.case.ts` precedent that exercises only the runner-reachable slice of the http contract. The case asserts: given the same `{hostname,port,path,method,headers}`, the URL string and the lowercased-header normalization are byte-identical to what Node's https client would produce, differing only in the `http:`->`https:` scheme. If parity is judged too thin (no node:https in runner), this degrades to a net unit parity-style diff in `https.test.ts`; prefer the runner case for the URL-build slice and keep the fetch-delegation proof in T2's unit tests.
   - **Failing test to write first:** `tools/node-parity-runner/cases/https/client-url-shape.case.ts` (NEW): `ParityCase` whose code uses `node:url` to build the request target the way the https client does, plus header lowercasing via `Object.fromEntries(new Headers(...))`; `console.log` the protocol/host/port/pathname/search and JSON of normalized headers. Node side and rifty side must diff-clean. RED: case does not exist yet; add it and confirm it diffs clean (pins the Node-observable URL+header contract our client must honor). NOTE in the case doc-comment WHY it does not call `https.request` directly (runner does not register `@rifty/net` builtins — top-down layering).
   - **Files:** `tools/node-parity-runner/cases/https/client-url-shape.case.ts`
   - **Kind:** parity

4. **T4 — Provide a per-instance VFS storage ROOT/dbPath selection and assert SQLite-over-VFS rows survive a same-process read-back (kind: integration).** F8 does NOT implement a JSON storage layer — persistence is owned by feature 04's `#db` WASM-SQLite shim (de-risk: opencode@dev uses drizzle-on-SQLite, not JSON). F8 only selects a VFS path (e.g. `/opencode/storage` under `MemoryVfs`/`OpfsVfs` from `packages/vfs/src/index.ts`) passed into opencode's OWN layer options at boot, and asserts a write then read-back through the `#db` shim. Mark `TODO(ADR) Q-2026-05-30-001`. Lives in the test harness fixture, not a rifty package export (REVERSIBLE).
   - **Failing test to write first:** `tests/integration/storage-vfs-readback.test.ts` (NEW): test `'session row written via #db shim persists across a read-back on a VFS-backed db file'` — using `MemoryVfs` at root `'/opencode/storage'`, drive feature-04's `#db` shim to create a table + insert a row, then open a fresh handle at the same VFS path and SELECT it back; assert the row is present. RED: depends on feature 04 landing the `#db` shim — until then this test is skipped-with-reason (`it.skip` referencing `dependsOn 04`) so it cannot give a false green. When 04 lands, un-skip; it then drives the path-selection code.
   - **Files:** `tests/integration/storage-vfs-readback.test.ts`, `tests/integration/fixtures/opencode-facade-boot.ts`
   - **Kind:** integration

5. **T5 — CI-friendly companion proof (NO network, default sandboxed CI) (kind: integration).** Boot the opencode facade headlessly by forking `tests/integration/fixtures/real-vite-smoke.ts` into `opencode-facade-boot.ts`, install a LOCAL in-runtime fetch interceptor that returns a canned non-stream completion for the provider host, then drive the round-trip through the port registry: `dispatchToPort(port, POST /session)` -> 200 JSON `{id}`; `dispatchToPort(port, POST /session/:id/message, no-tools, non-stream)` -> 200 JSON assistant message. Assert via the BUFFERED `res.end(body)` path only (`response.ts:185-221`) — never the streaming drain/pull path (`response.ts:53-65`) which feature 07 owns. This is the regression guard that the wiring (https->fetch client + storage path + buffered inbound) holds even when the live test is skipped.
   - **Failing test to write first:** `tests/integration/opencode-llm-flow.ci.test.ts` (NEW): test `'session.create + one no-tools message returns a buffered 200 JSON assistant reply (canned provider)'` — `bootOpencodeFacade(memVfs, { providerBaseUrl:'https://fake.provider.local', fetchInterceptor: cannedCompletion })`; POST `/session` via `dispatchToPort` -> expect 200 + JSON has string id; POST message -> expect 200 + JSON assistant content === canned text; then assert a session row + message part read back through `#db` (reuse T4 helper). RED: depends on features 01-06 + 04; skipped-with-reason until they land, then un-skipped. Assert the inbound Response was buffered (Content-Length set, no `Transfer-Encoding: chunked`) to prove it rode the buffered path.
   - **Files:** `tests/integration/opencode-llm-flow.ci.test.ts`, `tests/integration/fixtures/opencode-facade-boot.ts`
   - **Kind:** integration

6. **T6 — LIVE P4 proof (sandbox-disabled, real network + real provider key, per running-real-packages methodology) (kind: integration).** Same flow as T5 but against a REAL provider via the ai-SDK global fetch (the provider call uses WHATWG fetch — browser/host terminates TLS — and any defensive `node:https.request` fallback now delegates to fetch via T2). Provider base URL + key injected via the harness's replaced `process.env` (honors D-004: no hardcoded URLs; read key from the env the user already has set — do NOT echo/check it). Request the provider's NON-stream mode and assert a buffered 200 JSON assistant reply; assert persisted session/message rows read back through `#db`. Gate exactly like the existing live/parity tests (network needed; skipped in default sandboxed CI). Mark `TODO(ADR) Q-2026-05-30-002` (buffered-not-streaming inbound) and `Q-2026-05-30-003` (env-injected provider config).
   - **Failing test to write first:** `tests/integration/opencode-llm-flow.live.test.ts` (NEW): test `'real provider: session.create + one no-tools non-stream message persists and returns 200 JSON'` — gated by the same live-test guard the repo already uses (env-driven skip), sandbox-disabled. `bootOpencodeFacade` with `providerBaseUrl` + `providerKeyFromEnv` from `process.env`; POST `/session` -> 200 `{id}`; POST message (no tools, non-stream) -> 200 JSON assistant message with non-empty content; read-back asserts a session + message part row via `#db`. RED until features 01-06 + 04 land and a real key is present; otherwise skipped-with-reason so it never false-greens.
   - **Files:** `tests/integration/opencode-llm-flow.live.test.ts`, `tests/integration/fixtures/opencode-facade-boot.ts`
   - **Kind:** integration

7. **T7 — Docs/metadata: split-surface comment, compat-matrix, CHANGELOG, superseding ADR draft, OPEN_QUESTIONS (kind: unit).** Update `register-builtins.ts:16-17` comment to reflect the split surface (client->fetch; server-TLS still loud-throw) and regenerate the compat-matrix entry for `node:https`: client `request`/`get` => supported(via fetch); `createServer`/`Agent`/`globalAgent` => not-supported(loud-throw). Add CHANGELOG entries for `@rifty/net`. Author the superseding ADR draft (do NOT mark ratified — see ratification gate). Appending a supersession note pointer to `docs/adr/0010-https-loud-throw.md` is NOT allowed (ADRs immutable); instead the NEW ADR references 0010. Add OPEN_QUESTIONS entries `Q-2026-05-30-001`/`002`/`003`.
   - **Failing test to write first:** No new behavioral test — docs/metadata. Verification: `pnpm typecheck` + `pnpm lint` + `pnpm check:deps` stay green, and the existing T1/T2 unit tests + T3 parity case still pass (they encode the behavior this task documents). If `compat:generate` is wired to assert matrix consistency, that check is the gate; otherwise the milestone closer runs `compat:generate` per A-033.
   - **Files:** `packages/net/src/register-builtins.ts`, `packages/net/CHANGELOG.md`, `docs/adr/00NN-https-client-delegates-to-fetch.md`, `OPEN_QUESTIONS.md`, `docs/opencode-rifty-feasibility-2026-05-30.md`
   - **Kind:** unit

### Scaffolding sketch

```ts
// packages/net/src/https.ts — split surface (client -> fetch; server-TLS loud-throw)
import { NotImplementedError } from '@rifty/io';
import { request as httpRequest } from './http/server.ts';
import type { IncomingMessage } from './http/request.ts';

function notImpl(method: string): never {
  throw new NotImplementedError(
    `node:https.${method}`,
    'server-side TLS termination is not available in the browser; the client surface delegates to fetch',
  );
}

// CLIENT: force protocol https: and reuse the existing http fetch mapping.
function request(
  opts: string | { method?: string; hostname?: string; port?: number; path?: string; headers?: Record<string,string>; protocol?: string },
  cb?: (res: IncomingMessage) => void,
) {
  const forced = typeof opts === 'string'
    ? opts.replace(/^http:/, 'https:')        // string form: coerce scheme
    : { ...opts, protocol: 'https:' };        // object form: pin protocol
  return httpRequest(forced, cb);             // -> fetch(https://host..., {...}) in server.ts:112
}

function get(opts: Parameters<typeof request>[0], cb?: (res: IncomingMessage) => void) {
  const req = request(opts, cb);
  req.end();                                   // GET has no body; auto-end
  return req;
}

const https = {
  request,
  get,
  createServer: (..._a: unknown[]) => notImpl('createServer'), // UNCHANGED
  Agent: class { constructor() { notImpl('Agent'); } },        // UNCHANGED
  globalAgent: new Proxy({}, { get(_t, p) { notImpl(`globalAgent.${String(p)}`); } }), // UNCHANGED
  default: undefined as unknown,
};
(https as { default: unknown }).default = https;
export default https;

// ---------------------------------------------------------------------------
// tests/integration/fixtures/opencode-facade-boot.ts — forks real-vite-smoke.ts
import type { Vfs } from '@rifty/vfs';
import { dispatchToPort } from '@rifty/net';

interface FacadeOpts {
  storageRoot: string;                          // e.g. '/opencode/storage' (T4); dbPath derives via #db shim
  providerBaseUrl: string;                      // configurable; honors D-004
  providerKeyFromEnv?: string;                  // env var NAME to read at boot (live, T6)
  fetchInterceptor?: typeof fetch;              // canned non-stream completion (CI, T5)
}
// Boots opencode programmatically via Server.listen({ storageRoot, mdns:false }) — NOT the CLI
// (CLI top-level-imports drizzle-orm/bun-sqlite => import-time crash). Returns the registered port.
export async function bootOpencodeFacade(vfs: Vfs, opts: FacadeOpts): Promise<{ port: number }>;
// (impl depends on features 01-06; if a hard blocker is hit it throws NotImplementedError, never fakes)

// round-trip driver used by T5/T6 (in-process, no SW needed):
//   const { port } = await bootOpencodeFacade(vfs, opts);
//   const created = await dispatchToPort(port, new Request('http://x/session', { method:'POST' }));
//   const { id } = await created.json();
//   const msg = await dispatchToPort(port, new Request(`http://x/session/${id}/message`, { method:'POST', body: JSON.stringify({ parts:[{type:'text',text:'hi'}], tools:false }) }));
//   assert msg.status === 200 && (await msg.json()).role === 'assistant'  // buffered res.end(body)

// ---------------------------------------------------------------------------
// tools/node-parity-runner/cases/https/client-url-shape.case.ts
import type { ParityCase } from '../../src/types.ts';
const c: ParityCase = { code: `
  const { URL } = require('node:url');
  // Mirrors the URL the https client builds (server.ts:90-93) with protocol forced to https:.
  const u = new URL('https://api.example.com:443/v1/x?q=1');
  console.log('protocol:' + u.protocol);            // https:
  console.log('host:' + u.host);
  console.log('pathname:' + u.pathname);
  console.log('search:' + u.search);
  const h = Object.fromEntries(new Headers({ 'Content-Type':'application/json' })); // lowercasing
  console.log('hdr:' + JSON.stringify(h));
` };
export default c;
// doc-comment: does NOT call https.request — the parity runner registers only
// @rifty/runtime-js/loader, never @rifty/net (top-down layering). The fetch
// delegation proof lives in packages/net/src/https.test.ts (unit).
```

### Risks

- **PARITY LEVEL IS NOT REACHABLE for the actual https.request->fetch roundtrip:** the parity runner's rifty side (`tools/node-parity-runner/src/run-in-rifty.ts:14-16`) imports ONLY `@rifty/runtime-js/loader` and never registers `node:http`/`node:https` (those live in the higher `@rifty/net` layer; registering them in the runner would invert layering). The existing `cases/http/parse-url.case.ts` documents this exact limitation. The design's 'parity case (https===http client mapping)' must therefore be reduced to a URL/header-SHAPE parity case (T3) plus net-package UNIT tests with a stubbed global fetch (T2). Flagged because the design called parity the gold standard for this seam; it is not achievable as described without a runner change outside F8 scope.
- **F8 is the most dependency-heavy feature:** T4/T5/T6 cannot meaningfully RED-then-GREEN until features 01-06 (load/TS-on-import/conditional+bun:sqlite/db+pty shims/effect-http-bridge/headless-boot) AND specifically feature 04's `#db` WASM-SQLite shim land. They are written as skipped-with-reason tests so they never false-green; this means F8's proof tasks are scheduling-blocked, not just code-blocked.
- **Unknown #1 (HttpApiApp.createRoutes statically importing the storage/Database layer):** if true, `Server.listen` trips `bun:sqlite` at LAYER-BUILD time, so even the CI companion (T5) needs feature 03/04's specifier intercept already working — F8 cannot stub around it.
- **Unknown #2 (IncomingMessage/ServerResponse shapes reproducible over the SW bridge as for express@4):** T5/T6 deliberately use the BUFFERED `res.end(body)` path (`response.ts:185-221`) and assert Content-Length-not-chunked to avoid the streaming drain/pull gaps (`response.ts:53-65`). If opencode's HttpApi forces a streamed/SSE response even for a non-stream completion, F8 trips feature 07's unfinished streaming-inbound path and may hang.
- **string-form https.request scheme coercion:** `opts.replace(/^http:/, 'https:')` only fixes a leading `http:`; a caller passing a bare host string with no scheme would build an `http://` URL in `server.ts:90-93`. Object-form (the common dep path) is safe via `{...opts, protocol:'https:'}`. Edge: callers passing an already-https string are untouched (correct). Cover the string-form coercion in a T2 unit assertion.
- **Residual ceiling risk:** a transitive dep that needs `node:https.createServer` (true server TLS) will loud-throw BY DESIGN. This is the marked boundary, not a bug — but if opencode's provider transport unexpectedly constructs an `https.Agent` (e.g. for keep-alive/proxy), the Agent constructor throws and aborts the round-trip; that would force an Agent no-op stub decision (new IRREVERSIBLE question) rather than mapping to fetch.
- **T1 is a regression-LOCK, not a classic RED test** (the behaviors already throw today). Its value is keeping the server-TLS invariant green THROUGH the T2 refactor; a reviewer expecting an initially-failing test should understand this framing.

### Estimate

2-3 evenings for the directly-buildable slice (T1+T2+T3+T7: the https client->fetch mapping, server-TLS lock, URL-shape parity case, docs/ADR draft). T4/T5/T6 (the storage read-back + CI-companion + live P4 proof) are scheduling-blocked on features 01-06 and 04; once those land, ~2-3 further evenings to fork the harness and drive the round-trip. Total ~5-6 evenings, but only ~2-3 are unblocked today.

### Ratification gate

> **⚠️ BLOCKED-FOR-T2-and-T7 until ratified.**

The `node:https` CLIENT -> fetch mapping (decision D1) is IRREVERSIBLE — it directly supersedes ADR-0010's outbound-client clause (checklist rule 3) and changes a cross-package observable builtin shape (rule 1). It MUST NOT be invented; a NEW superseding ADR ('ADR-00NN: node:https client (request/get) delegates to fetch; server-side TLS remains loud-throw, supersedes ADR-0010') must be ratified by a human before T2 (the `https.ts` edit) and T7 (the ADR/compat/changelog) may start.

T1 (server-TLS regression lock) and T3 (URL-shape parity case) are NOT blocked and may proceed immediately to characterize current behavior. T4/T5/T6 carry only REVERSIBLE provisional decisions (Q-2026-05-30-001 storage-path selection, Q-2026-05-30-002 buffered-not-streaming inbound, Q-2026-05-30-003 env-injected provider config) — logged in OPEN_QUESTIONS with `TODO(ADR)` markers, no ratification needed — but are scheduling-blocked on features 01-06 + 04.
