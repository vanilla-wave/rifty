# Adversarial review — opencode server facade (M12 proposed)

Five lenses applied to the nine-feature decomposition: **hard-blocker boundary**,
**ADR-conflict & protocol governance**, **dependency ordering & de-risk-first**,
**reversibility classification audit**, and **completeness critic**. Findings are
consolidated and grouped by severity. Anchors were spot-verified against the
working tree (e.g. `os.hostname()` exists; `DEFAULT_EXTENSIONS` lacks `.ts`;
`PREVIEW_PORT_FRAME_VERSION = '2'`).

## Headline verdict

**Feasible-as-designed, conditional on three pre-P4 verification gates.** The
decomposition genuinely designs *to* the four hard blockers (process spawn, PTY,
native git/ripgrep, native SQLite) rather than around them — no feature secretly
requires a forbidden capability. The honest-stub discipline (throw-on-use, loud
`NotImplementedError`, document-the-ceiling) holds. But the program's feasibility
rests on under-verified assumptions at the native-SQLite boundary and a live
`https.Agent` collision risk, and it carries genuine ADR contradictions, two
reversibility misclassifications, and a corrupted Q-id ledger that must be fixed
before coding.

---

## CRITICAL

### C1 — `node:https.Agent` could make the P4 round-trip init-time-fatal (lens: hard-blocker)
*Features 08 / 04.* F8 routes around the TLS blocker by mapping `https.request`→
`fetch` (mechanically sound), but the `ai`/`@ai-sdk` providers frequently
construct an `https.Agent` (keep-alive/proxy) **before** issuing a request. F8/F04
correctly leave `https.Agent` a loud-throw stub — so a thrown Agent constructor at
provider-init is import/init-time-fatal for the LLM round-trip, and F8's only
fallback is "open a new IRREVERSIBLE question." The P4 "feasible" verdict is
conditional on a provider hot path that has **not been verified** to avoid
`https.Agent`.
**Action:** before declaring P4 feasible, inspect pinned `ai@6`/`@ai-sdk/*`
source for `https.Agent`/`node:https` on the global-fetch path. If Agent is
constructed at init, surface a new decision (no-op Agent the fetch path ignores
vs P4-blocked) — do not invent it. Also fix F8's string-form scheme coercion for
scheme-less hosts. (ADR-0061 pre-flight gate.)

### C2 — P3 "first-light is cheap" is unproven; WASM-SQLite may be a P2 prerequisite (lens: dependency-ordering)
*Feature 06 / 04.* Unknown #1 is confirmed YES: `session.ts` (and the whole
`storage/db → #db → node:sqlite` graph) is on the **static** import graph of
`createRoutes`, so it loads at resolve time regardless of which route you hit. The
throw-on-USE stub (03/04 tier A) suffices **only if `init()` is never called
during layer build** — an assumption asserted from reading source, verified only
against **synthetic** fixtures (03/T6, 04/T4), never the real `createRoutes` layer
set. If layer-build constructs a Database, the IRREVERSIBLE WASM-SQLite dep is
pulled forward from P4 to a hard P2/P3 prerequisite and the milestone ordering
collapses.
**Action:** insert Spike C — run the graph-load harness against the REAL vendored
opencode tree and assert no Database constructed / no native dlopen at module eval
across `session.ts → @/storage/db → #db → node:sqlite` AND
`drizzle-orm/bun-sqlite/migrator`. This gate must precede any P3 claim. (README
execution-order item 3.)

### C3 — feature 07's v3 bump silently contradicts ADR-0048 D2 and ADR-0017 (lens: ADR-conflict)
*Feature 07.* Verified: `PREVIEW_PORT_FRAME_VERSION = '2'`; the page side
reassembles on `reply-stream-end`, which never fires for SSE → Worker-owned SSE
hangs and trips the 30s idle timer. The v3 fix resolves the `Response` from a live
`ReadableStream`, which **directly contradicts ADR-0048 D2** ("page memory
unchanged until M12; true end-to-end ReadableStream is M12") and partially
fulfils ADR-0017's deferred M12 criterion ("SerializedResponse carries a
ReadableStream body across postMessage"). The design names the bump ratifiable
but the draft does not commit to citing/superseding either ADR.
**Action:** the v3 ADR (ADR-0060 draft) MUST cite and supersede ADR-0048 D2's
clause, clarify whether this pulls M12 forward, confirm v3 stays on the
BroadcastChannel carrier (no MessagePort, so the M12 envelope is intact), and
amend ADR-0017's "SSE hangs until M12" line. Do NOT ship v3 (T5–T7) until
ratified.

### C4 — features 03 and 04 contradict each other on the sqlite throw-stub layer (lens: ADR-conflict + dependency-ordering)
*Features 03 / 04.* Both features own the **same** make-or-break de-risk probe
(register node:sqlite/bun:sqlite throw-stubs + a first graph-load harness), in
**different layers**: feature 03 says shadow-registry/harness-local (to avoid
leaking the Bun specifier into ALL loads and to keep top-down layering, matching
the `net/register-builtins.ts`/ADR-0035 precedent); feature 04 adds
`packages/runtime-js/src/builtins/sqlite-stub.ts` + edits the global
`builtins/index.ts`. The registry is a process-wide singleton, so two
registrations collide or last-write-win on import order, and the de-risk has two
parents with no agreed owner.
**Action:** single owner = **feature 03**, **harness-local registration**
(resolved in Q-2026-05-30-102). Delete feature 04's runtime-js builtins edit;
feature 04 consumes 03's stub and extends 03's harness rather than forking a
parallel one.

---

## MAJOR

### M1 — parity (the project gold standard) is structurally unreachable for node:http/https (lens: completeness + hard-blocker)
*Features 05 / 07 / 08.* `run-in-rifty.ts` imports only `@rifty/runtime-js/loader`
+ `@rifty/vfs` and never registers `@rifty/net` builtins, so node:http/https/net
are unreachable from the parity runner. EVERY Node-compatible HTTP/streaming
behavior the effort leans on (IncomingMessage pull-stream, buffered `end(body)`,
the new `'drain'` event, the `https.request→fetch` mapping) is verified only by
hand-written unit asserts — exactly where unknown #2 would silently diverge.
**Action:** teach the parity runner an opt-in mode that registers `@rifty/net`
builtins on the rifty side (layer-legal — the runner is a tools/ harness already
permitted to import higher layers per feature 02 T6), then add real Node-vs-rifty
parity cases for createServer+request+`res.end(body)`, the streaming write loop
with `'drain'`, and `https.request`. Owned by a new task in feature 05.

### M2 — P4 durable storage falls between features 04 and 08 (lens: completeness)
The feasibility doc still says "JSON-over-VFS" (overturned: opencode@dev is
drizzle-on-SQLite). Feature 04 chooses **in-memory** sql.js for first light;
feature 08 T4 asserts "persists across a read-back" but only same-process. So the
P4 "storage over VFS" criterion is owned by **nobody** — export-to-VFS is deferred
in 04 and merely consumed in 08.
**Action:** decide explicitly. If P4 needs VFS-durable storage, promote
export-to-VFS (`db.export()`→VFS file + read-on-boot) to a first-class feature-04
task and have 08 T4 assert cross-reload durability. Else update the feasibility
doc + the P4 criterion to "in-memory only." Reconcile the stale "JSON-over-VFS"
wording. (Q-2026-05-30-114.)

### M3 — streaming-LLM-to-browser is proven by no feature in the realistic deployment (lens: completeness + dependency-ordering)
Feature 08 drives P4 with a **non-stream** completion (to dodge the drain/pipe
gaps), fencing streaming to feature 07. Feature 07 ships only the page-direct SSE
path and defers the page↔Worker v3 bump. But the long-term opencode owner is the
**Worker** (`WorkerOwnerBinding`, Q-2026-05-27-002), where SSE hangs until v3. So
token-by-token streaming is proven in NO configuration; "one LLM round-trip" is
demonstrable only as non-streaming page-direct — a materially weaker claim than
"agent facade." There is also a near-circular 07↔08 ordering.
**Action:** state plainly that P4 ships non-streaming LLM + page-direct SSE only;
token-streaming-to-browser is unproven until ADR-0060 (Worker v3) ratifies.
Resolve the ordering: 08 proves the buffered round-trip, 07 separately proves
page-direct streaming, neither claims the other's half. Run Spike D (README) to
prove the page-direct path streams and the v2 Worker path hangs, before P4 is
declared done.

### M4 — feature 05 hides a `@rifty/io` interface change behind a net-only label (lens: reversibility)
F5 T4 makes ServerResponse a pipe target, which requires widening
`@rifty/io`'s `PipeableWritable.write` from `(chunk)=>boolean` to
`boolean|Promise<boolean>` (T4's own files list includes
`packages/io/src/streams/readable.ts`). Yet `affectedPackages` lists ONLY
`packages/net`, and the reversibility justification claims "confined to one file"
— false. This touches a lower-layer public stream typing governed by **ADR-0034**
(whose purpose is to restore Node's boolean-only write contract), so the widening
moves io *further* from Node — the opposite of ADR-0034's intent.
**Action:** prefer the design's own escape hatch — **DEFER pipe-sink** (the facade
serves JSON/SSE not FormData), keeping F5 truly net-only and io untouched. If
kept, correct `affectedPackages` to include `packages/io`, cite ADR-0034 in the
OPEN_QUESTIONS entry as a deliberate divergence, and keep `write()` returning raw
boolean (drain carries backpressure). (Q-2026-05-30-109.)

### M5 — colon-key builtin round-trip (`bun:sqlite`) is asserted as fact but never exercised (lens: hard-blocker)
`isBuiltinSpecifier('bun:sqlite')` is true ONLY if feature 04 registers under the
literal key string `'bun:sqlite'` (the registry slices only a leading `node:`).
If unregistered (P0 graph-load before the stub lands, or a registration-order slip
on the process-wide singleton), `'bun:sqlite'` falls through to a npm-PACKAGE
lookup → a confusing `MODULE_NOT_FOUND` on a package, not the clean native→WASM
boundary error. No test in the tree exercises a colon-bearing builtin key today.
F04's interfaceContract states it as fact without the conditional.
**Action:** treat the colon-key round-trip as a make-or-break GATE (F03-T5/F04-T2):
RED-first against the unregistered state (assert package-lookup MODULE_NOT_FOUND),
GREEN after registration. Because rifty picks the `node` condition, **prioritize
the `node:sqlite` path** (clean `node:`-prefix, key `'sqlite'`) and treat the
riskier `bun:sqlite` colon-key as a secondary safety net.

### M6 — Q-id ledger is corrupted across features (lens: reversibility + ADR-governance)
Verified: `Q-2026-05-30-001` is ALREADY consumed (ADR-0051). Yet features 04, 07,
08, 09 mint IDs independently, and features 05 and 06 both claim identical
`Q-2026-05-30-101/102/103`; feature 08 re-uses the taken `-001`. Colliding/reused
IDs make `pnpm todo:adr`, the OPEN_QUESTIONS log, and `pnpm adr:promote`
ambiguous.
**Action (DONE in this synthesis):** all reversible decisions renumbered globally
and sequentially from `Q-2026-05-30-101` … `-119` in `decisions.md` Section B. The
maintainer appends that block as-is.

### M7 — the runtime-js builtin gate (06) is predicated on a false premise (lens: dependency-ordering + reversibility)
Feature 06 gates an IRREVERSIBLE ADR on adding `os.hostname` — but `os.hostname()`
**already exists** (`os.ts:20`), as does `networkInterfaces()` (`os.ts:83`). The
de-risk for 06's only IRREVERSIBLE decision was done from priors, not the tree,
undermining confidence that the unspecified "Effect-runtime globals" were checked.
Also: the harness assumes it can make hostname "resolve to a loopback value"
without adding a method — but `os.hostname()` may not be reachable to override
without monkeypatching (forbidden).
**Action:** drop `os.hostname` from the gate (ADR-0058 corrected). Re-aim at the
actually-unknown items via a real boot smoke; add a pre-flight static inventory of
the createRoutes graph's `globalThis.*`/`node:`/`process.*` references; verify
whether mDNS reads `os.hostname()` vs an env var; add an explicit check that
`bonjour-service` does not open a native UDP socket at module scope.

### M8 — TS-on-import IRREVERSIBLE APIs gate everything but are de-risked last (lens: dependency-ordering)
The two IRREVERSIBLE ADRs feature 02 needs (the transform hook + `.ts`/`.tsx`
first-class extensions, both verified absent in the tree) gate the entire
downstream chain, yet the cheapest probe (does esbuild's stripped output
round-trip through `transformEsm`/acorn) is buried behind the ratification gate at
T6/T7 rather than run first.
**Action:** run Spike A (README) — a throwaway esbuild-into-`executeEsm` fork over
a 3-file `.ts` graph — to retire the acorn-can't-parse-esbuild-output risk BEFORE
designing the public `transformSource` shape.

---

## MINOR / INFO

- **bonjour-service prune-vs-import contradiction (completeness).** The de-risk says
  `server.ts` statically imports MDNS (bonjour-service); feature 03's PRUNE list
  prunes it. If it's on the static graph it CANNOT be pruned (would MODULE_NOT_FOUND
  at P0/P2). Resolve: install/shim it (if static) or verify it's lazy (then prune).
  Add a single owned assertion in feature 06's harness.
- **drizzle migrator subpath interception has no designed mechanism (completeness +
  reversibility).** `resolveOverride` is PACKAGE-level only; the runtime
  `drizzle-orm/bun-sqlite/migrator` subpath (on the static graph) has no confirmed
  interception. Promote subpath-specifier interception to a designed mechanism in
  03/04 (override-engine extension — possibly its own IRREVERSIBLE ADR — or a
  documented VFS-overlay with the real post-install path). Do not leave as a
  "confirm whether" contingency. (ADR-0056 open sub-question.)
- **`Readable.fromWeb` is missing with no owner (completeness).** Effect's web-stream
  response path is `Readable.fromWeb(webStream).pipe(res)`; `@rifty/io.Readable` has
  NO `fromWeb`. F5 T4 tests an object-mode `Readable.from(['a','b','c'])`, giving
  false confidence the Effect path works. Mark T4 as proving only an object/byte
  pipe target; register `fromWeb` absence as a compat gap with an owning ticket.
- **`.ts`-via-CJS-`require()` latent fatal (hard-blocker).** F2-T4 correctly throws a
  directed error for `require()`-of-`.ts`, but a transitive non-`type:module` dep
  shipping `.ts` would HALT graph load unexpectedly. Add a pre-P0 scan of the real
  tree for `.ts` reachable via a non-module scope; document the path covers ESM-`.ts`
  only.
- **`bun` is a non-spec condition (ADR-conflict).** Adding it deviates from ADR-0004's
  `node/default/import/require` set. ADR-0054 must cite ADR-0004, OR prefer the
  shadow-registry overlay (option c) which leaves the resolver untouched and stays
  REVERSIBLE.
- **WASM-SQLite engine ignores the ADR-0006-named source (ADR-conflict).** ADR-0006
  already names `@sqlite.org/sqlite-wasm`; the ADR-0055 draft must evaluate it (vs
  sql.js) and justify any divergence, and consider COI/SAB interaction with ADR-0002.
- **ADR-0051 "infeasible" vs nine "feasible" features (ADR-governance, info).** ADR-0051
  names `opencode-ai` (the published NATIVE package). The facade targets
  `anomalyco/opencode` SOURCE and never installs the native bin — add a one-line
  governance note distinguishing the artifacts so the two reads aren't contradictory.
  Confirm feature 01's KEEP set passes `assertNativeSupported`.
- **`@ai-sdk` provider sublist + `@modelcontextprotocol/sdk` are guesses
  (completeness).** No feature verifies WHICH provider opencode@dev wires by default
  on the P4 path, nor that MCP's transport (stdio would need spawn — a blocker) is on
  the minimal serve path. Pin the default provider in feature 01 from source; verify
  MCP's transport import surface before keeping it.
- **~7 near-duplicate harness forks, no shared bootstrap (completeness).** Every
  integration feature forks `real-vite-smoke.ts`; a shim-ordering fix in one will not
  propagate. Add one owned `bootOpencodeFacade(vfs, opts)` helper (feature 01,
  alongside `overlay.ts`); downstream harnesses become thin callers.
- **parity-runner gains new import edges + esbuild.wasm (reversibility, info).** F2-T6
  lets the runner import `runtime-wasi` + `shadow-registry` and depend on
  `esbuild.wasm`. Layer-legal for a harness, but confirm `esbuild.wasm` is already
  vendored (not a new fetch) before declaring T6 dependency-free; log it.
- **F8 node:https ADR may be dead weight (dependency-ordering, info).** Run the live
  flow with node:https left as the loud-throw stub first; if nothing trips it (the
  de-risk's own prediction), ADR-0061 is deferrable and should not block T2/T7.
- **F9 ceiling test is sound (hard-blocker, info).** Assert on `git`/`bash`
  (always-fallthrough ENOENT-127), not `node` routing (env-dependent). F9 is the model
  for marking *to* a blocker; no crossing.
- **ADR-0010 invariant preservation (ADR-governance, info).** ADR-0061 must state
  explicitly that ADR-0010's no-silent-plaintext invariant is PRESERVED (fetch does
  real TLS; createServer/Agent/globalAgent stay loud-throw).
- **esbuild.wasm + Node v24 strip-types are unverified preconditions (completeness,
  info).** Add a one-line CI/doc precondition check (owned by feature 02) to avoid a
  confusing whole-language-layer failure.

---

## Completeness gaps (features / unknowns / test-levels still missing)

1. **No feature inventories the incidental-shim / Effect-runtime-global surface**
   before boot — deferred to runtime trial-and-error (the classic late-P3 failure).
   *Owner: feature 06, as a P0 pre-flight task.*
2. **Parity is structurally unreachable for node:http/https** — no feature closes the
   blind spot where unknown #2 would diverge. *Owner: new feature-05 task (M1).*
3. **P4 durable storage owned by nobody** (in-memory in 04, consumed in 08). *Owner:
   feature 04 export-to-VFS task, or an explicit scope decision (M2).*
4. **Streaming-LLM-to-browser proven in no realistic deployment** (Worker path hangs
   until v3). *Owner: scope statement + Spike D (M3).*
5. **No shared opencode bootstrap helper** → ~7 harness forks drift. *Owner: feature
   01.*
6. **Subpath interception (drizzle migrator) and `Readable.fromWeb` have no designed
   owner.** *Owners: 03/04 and 05 respectively.*
7. **Default provider + MCP transport unverified.** *Owner: feature 01.*

---

## Go / no-go per phase

| Phase | Recommendation | Conditions |
|------|----------------|------------|
| **P0** | **GO** | Run Spike A (TS-strip round-trip) before designing ADR-0052/0053. Ratify ADR-0052/0053 (or take ADR-0054 option c) before coding. Single-owner the sqlite throw-stub at the harness-local layer (C4). RED-first the colon-key/`node:sqlite` round-trip (M5). Add the createRoutes global inventory + bonjour-service module-scope check (M7, minor). |
| **P1** | **GO (now, in parallel)** | Spike B / feature 05 T1–T5 have zero opencode dependency — pull forward. Ratify ADR-0057. Add the node:http parity mode (M1). Prefer deferring pipe-sink (M4). |
| **P2** | **CONDITIONAL GO** | BLOCKED on Spike C (C2): real createRoutes layer-build must pass against the throw-stub alone. If a Database is constructed at module eval, WASM-SQLite (ADR-0055/0056) becomes a P2 prerequisite and the ordering is re-cut. Resolve bonjour-service prune-vs-import. |
| **P3** | **CONDITIONAL GO** | Gated by P2/Spike C. Hit a verified no-storage route; ride the buffered `end(body)` path only. |
| **P4** | **NO-GO until C1 cleared** | Verify no `https.Agent` on the provider hot path (C1) BEFORE the live proof. Reconcile durable storage (M2). State streaming scope = non-stream + page-direct SSE only (M3). Ratify ADR-0055/0056/0061. Run Spike D. |
| **P5** | **GO** | Pure-JS marker + spawn-ceiling conformance + compat doc, no gate. Do NOT cross ADR-0062 (ripgrep-WASM/isomorphic-git) silently. |

**Bottom line:** proceed P0/P1 now (with the spikes and the four critical fixes
baked in); gate P2/P3 on Spike C; hold P4 until the `https.Agent` pre-flight (C1)
and the storage/streaming scope decisions are settled; P5 is free.
