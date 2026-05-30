# Open Questions

Living buffer for provisional design decisions made by AI agents during work, awaiting human review. See D-007 in `PROJECT_PLAN.md`.

## How to use

When you encounter a **reversible** design choice during implementation:

1. Make a provisional decision
2. Add an entry below using the template
3. Mark the code with `// TODO(ADR): Q-YYYY-MM-DD-NNN`
4. Continue working — do not stop

When a question is reviewed:
- **Confirmed:** promote to ADR via `pnpm adr:promote Q-...`. This removes `TODO(ADR)` markers and creates an ADR entry.
- **Rejected:** rework with a new approach; entry is moved to "Rejected" section below for historical record.
- **Deferred:** update `Needs human review by` and leave in place.

## Status

- 🟢 Active: provisional decision in code, awaiting review
- 🟡 Under review: human is currently evaluating
- ⚪ Promoted: moved to ADR (kept here briefly for traceability, then archived)
- 🔴 Rejected: see "Rejected" section

---

## Active

## Q-2026-05-30-101: `HttpServer.listen` options-object overload

**Status:** 🟢 Active  
**Encountered in:** F05-T1 (feature 05-effect-http-bridge), while widening `node:http` for `@effect/platform-node`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`@effect/platform-node`'s `NodeHttpServer.layer` always drives the server
through `server.listen({ port, host }, cb)` — the options-object overload.
Node's real `http.Server.listen` accepts that form, but rifty's
`HttpServer.listen` only accepted a bare number; the options object was
assigned verbatim as `this.port` and handed to `registerPort`, so the
registry keyed on a non-number. The port was unroutable (502) while
`'listening'` still fired — a silent-bind trap. This is a genuine
Node-parity gap, not an Effect-specific hack.

### Options considered

- **Option A — widen `HttpServer.listen` to accept Node's options form.**
  - Pro: Node-faithful, benefits all consumers, additive (bare-number path
    byte-for-byte unchanged), single file, no new export.
  - Con: evolves the shared `node:http` surface (vs isolating Effect concerns).
- **Option B — add a separate Effect-only adapter export in `packages/net`.**
  - Pro: isolates Effect concerns from the shared http module.
  - Con: NEW cross-package public API => IRREVERSIBLE (checklist rule 1); heavier.

### Decision taken (provisional)

**Chose:** A

**Why:** Node's real `listen` accepts an options object, so widening is the
most Node-faithful, lowest-regret fix; it is purely additive and avoids a new
cross-package public symbol.

### Code markers

- `packages/net/src/http/server.ts:51` (`listen` TSDoc `TODO(ADR)` marker)

### Reversibility justification

- Public APIs affected: none added — only an existing exported method's
  accepted input shapes are widened (every existing caller still compiles and
  behaves identically). A local `ListenOptions` interface is exported from the
  same module but is not re-exported cross-package.
- Rough cost to revert: <30 lines, 1 file (`packages/net/src/http/server.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-30-102: `ServerResponse` Node-style `'drain'` emission

**Status:** 🟢 Active  
**Encountered in:** F05-T3 (feature 05-effect-http-bridge), while widening `node:http` for `@effect/platform-node`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`@effect/platform-node`'s streaming write loop in `internal/httpServer.ts`
parks on `nodeResponse.on('drain', ...)` and IGNORES `write()`'s return value
to pace a streaming response. rifty's `ServerResponse` signalled backpressure
ONLY via `write()`'s `boolean | Promise<boolean>` return and never emitted a
Node `'drain'` event, so an Effect-driven streaming response would hang
forever. Emitting `'drain'` is also the standard Node `Writable` contract that
any generic Node http consumer expects.

### Options considered

- **Option A — emit a Node-style `'drain'` from `ServerResponse`, gated by a
  `_needDrain` flag.** Set `_needDrain` only when a `write()` actually returned
  the backpressure Promise (queue full); emit `'drain'` on the next
  `ReadableStream` `pull()` when gated, then clear the flag.
  - Pro: Node-faithful; additive (an extra event, `write()`'s return unchanged);
    single file; no new export; no new dep. Gating prevents spurious `'drain'`
    before any backpressure (Node only drains after `write()` returned `false`).
  - Con: a stray `'drain'` listener in some future consumer could now fire — but
    rifty's own callers do not listen for `'drain'` today, so additive-only.
- **Option B — patch `@effect/platform-node` via shadow-registry to await
  `write()`'s Promise instead of parking on `'drain'`.**
  - Pro: leaves `ServerResponse` untouched.
  - Con: couples to Effect internals, fragile across Effect beta versions;
    violates the bridge-agnostic principle (fix rifty's Node shape, not the
    consumer).
- **Option C — buffer the whole response, never stream.**
  - Con: defeats P4 LLM streaming; memory blows up on long generations.

### Decision taken (provisional)

**Chose:** A

**Why:** Emitting `'drain'` is the standard Node `Writable` contract and is what
every Node http consumer (not just Effect) expects, so it improves general
parity. Gating behind `_needDrain` keeps it from diverging from Node by firing
before any backpressure. It is purely additive and avoids coupling to Effect
internals or sacrificing streaming.

### Code markers

- `packages/net/src/http/response.ts` (`_needDrain` field TSDoc `TODO(ADR)`
  marker; `pull()` emission `TODO(ADR)` marker)

### Reversibility justification

- Public APIs affected: none added — a new `'drain'` event is emitted on the
  already-exported `ServerResponse`; `write()`'s `boolean | Promise<boolean>`
  return is unchanged. No new exported symbol.
- Rough cost to revert: <30 lines, 1 file (`packages/net/src/http/response.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-24-007: Prod proxy for npm registry (reopened 2026-05-27)

**Status:** 🟢 Active (reopened — see "Reopened" note below)  
**Encountered in:** 2026-05-24 (original); reopened 2026-05-27 architecture review (`docs/follow-ups-architecture-review-2026-05-27.md` item #3)  
**Milestone:** M9 (closure)  
**Author (agent session):** 2026-05-27

### Reopened note

Originally promoted to ADR-0028 (Vercel Edge Function). The 2026-05-27
audit surfaced that the ADR was ratified without the Edge Function
source ever landing in the repo: acceptance criterion #1 (a file at
`apps/playground/api/npm-registry/[...path].ts` or equivalent) is
unmet, there is no live URL, and the playground has never been deployed
to prod. The ADR has been downgraded to **Provisional** (see
`docs/adr/0028-prod-proxy-for-npm-registry.md` §Status update — 2026-05-27)
and the question is restored here as the live tracker.

### Context

A `crossOriginIsolated` playground (D-001) cannot fetch
`registry.npmjs.org` directly — CORP/CORS forbids it. Dev solves this
via the Vite proxy (D-004). Prod needs an equivalent surface so
`@rifty/npm-client.REGISTRY_BASE_URL = '/npm-registry'` resolves both
metadata and tarballs through a deployed proxy with
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`
on every response.

### Options considered

- **Option A — Vercel Edge Function (provisional leading candidate).**
  Single source file in the playground deploy proxying `registry.npmjs.org`.
  Co-located with the playground; reuses the same Vercel deploy that
  serves `vercel.json` headers.
  - Pro: Zero extra infra; one provider.
  - Con: Vercel Edge Function free-tier limits may bite at scale; vendor
    lock-in on the Edge runtime.
- **Option B — Cloudflare Worker.** Same shape, hosted on Cloudflare;
  splits the deploy across two providers.
  - Pro: Generous free tier; provider diversity.
  - Con: One more deploy target to manage.
- **Option C — Self-hosted nginx + Verdaccio mirror.** Over-engineered
  for a pet project; on-call burden.

### Decision taken (provisional)

**Chose:** A — Vercel Edge Function, *as candidate*. The decision is
not ratified until the Edge Function exists, deploys, and roundtrips a
live `@rifty/npm-client` install. Implementation TBD by the first
prod-deploy session.

**Why:** Same rationale as the original ADR-0028 promotion — co-located
with the playground deploy, < 50 lines, switching to Option B later is
a config-only change. Reopening the question keeps the gap honest.

### Code markers

(none — pre-implementation, by intent). The decision is "candidate only"
until the Edge Function lands. When the first deploy attempt opens a PR, that PR
either (a) ratifies the candidate with a fresh ADR that supersedes
ADR-0028 with concrete code references, or (b) switches to Option B/C
with a fresh ADR.

### Reversibility justification

- Public APIs affected: none — `@rifty/npm-client` already reads
  `REGISTRY_BASE_URL`, agnostic to what the URL routes to.
- Rough cost to revert (today): zero (no code change yet).
- External dependencies involved: none until the Edge Function is
  written.

### Needs human review by

First prod-deploy session (M9 deploy closure).

---

## Q-2026-05-27-001: `process.versions.node = '22.0.0'` vs ADR-0026 honesty

**Status:** 🟢 Active  
**Encountered in:** 2026-05-26 architecture audit follow-up (runtime-js P1-4), while landing audit cleanups  
**Milestone:** M10  
**Author (agent session):** 2026-05-27

### Context

ADR-0026 ratified `process.platform = 'rifty'` and `process.arch = 'wasm'`
as the honest values — they are the de-facto rifty ABI and per-package
shims are accepted as the migration cost. The same `RiftyProcess` class
nevertheless reports `version = 'v22.0.0'` and `versions = { node:
'22.0.0', v8: '12.0.0', rifty: '0.0.0' }`. This is plausibly intentional
(many ecosystem packages branch on `process.versions.node` to enable
Node-specific code paths), but it directly contradicts the ADR-0026
honesty principle. The audit flagged the inconsistency as P1-4 with no
TODO marker or open question on file.

### Options considered

- **Option A — Keep impersonation, amend ADR-0026 to carve out
  `versions.node`.**
  - Pro: Zero compat breakage. Existing packages that gate on
    `process.versions.node >= '14'` keep working.
  - Con: Splits the honesty principle into "platform/arch honest, version
    lies"; future ADR readers must hold both rules in mind.
- **Option B — Honest values everywhere.** Drop `versions.node`, expose
  `versions.rifty = '0.0.0'`, shim per-package as needed.
  - Pro: One consistent rule. Easy to explain.
  - Con: Doubles the per-package shim cost ADR-0026 already accepted,
    measured against the ~10-package budget that triggers a re-think.
    Many packages will silently take the "no Node" branch and exhibit
    confusing behaviour rather than failing loudly.
- **Option C — Keep impersonation, add a runtime warning when accessed
  via `process.version` direct (not `process.versions.node`).**
  - Pro: Surfaces the lie in noisy environments (REPL, tests) while
    keeping the compat shape for programmatic consumers.
  - Con: Noisy in legitimate paths (many packages read both). The
    warning channel risks crying wolf.

### Decision taken (provisional)

**Chose:** A — keep the current impersonation.

**Why:** Same trade-off ADR-0026 accepted for compat values; reverting
would amplify the shim cost beyond the ~10-package budget the ADR set,
and packages that branch on `versions.node` would mis-detect the runtime
without obvious failure. The honest carve-out belongs in an ADR
amendment rather than silent code drift.

### Code markers

- `packages/runtime-js/src/builtins/process.ts:90` (`version`)
- `packages/runtime-js/src/builtins/process.ts:91` (`versions`)

### Reversibility justification

- Public APIs affected: `process.version` / `process.versions` shape,
  which is read-only and already public — but the proposed reversal is a
  value change, not a structural one, so reverts are a two-line edit.
- Rough cost to revert: 2 lines, 1 file.
- External dependencies involved: None.

### Needs human review by

End of milestone M11.

---

## Q-2026-05-30-202: Loader-internal TS-strip cache — key and invalidation

**Status:** 🟢 Active  
**Encountered in:** F02-T5 (feature 02-ts-on-import-graph), while wiring the injected `transformSource` hook into `createModuleLoader`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`loader.ts` passed `opts.transformSource` straight through with NO cache, so
the WASI esbuild process is re-spawned for the same module across the large
opencode `.ts` graph and across repeated loads within one loader instance —
each strip is a full guest process spawn (ADR-0047/0049). ADR-0052 D4
(REVERSIBLE) calls for a loader-internal `Map<id,string>` populated lazily,
read before re-invoking the hook, and cleared by the existing `invalidate(id)`
-> `registry.invalidate` path. The open sub-question is the cache KEY and the
invalidation coupling.

### Options considered

- **Option A — key by absolute resolved id; drop via the existing
  `invalidate(id)` path (full `invalidate()` clears all).**
  - Pro: installed sources are immutable for a given package version in the VFS
    overlay, so id is a sufficient key; integrates with the invalidate
    semantics that already exist for the `load-fixture` / future-HMR hot path;
    `esm.ts` stays cache-unaware (the wrap is invisible to the execute path);
    single file, no new export, no new dep.
  - Con: a file edited in place under a future HMR layer needs an explicit
    `invalidate(id)` to drop the stale strip — acceptable because invalidate
    already exists for exactly that hot path.
- **Option B — content-hash key (hash the source before stripping).**
  - Pro: correct under live in-place edits without an explicit invalidate.
  - Con: unnecessary in P0 where installed sources do not mutate; adds a hash
    per load on the hot path; the id-keyed cache already invalidates via the
    registry hook.

### Decision taken (provisional)

**Chose:** A

**Why:** Id is a sufficient key for immutable installed sources and reuses the
existing `invalidate` semantics; content-hashing buys correctness only under a
not-yet-built HMR layer at a per-load cost.

### Code markers

- `packages/runtime-js/src/module-loader/loader.ts` (`transformCache` TSDoc
  `TODO(ADR)` marker on the cache declaration and on the `invalidate` coupling)

### Reversibility justification

- Public APIs affected: none — purely internal to `createModuleLoader`; no new
  export, no signature change. Callers and plain-JS loaders are unaffected.
- Rough cost to revert: <20 lines, 1 file (`loader.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Template

```markdown
## Q-YYYY-MM-DD-NNN: <Short title>

**Status:** 🟢 Active  
**Encountered in:** PR #X, while implementing <feature>  
**Milestone:** M<N>  
**Author (agent session):** <date or session marker>

### Context

<2-4 sentences about what came up and why it's unclear>

### Options considered

- **Option A:** <description>
  - Pro: ...
  - Con: ...
- **Option B:** <description>
  - Pro: ...
  - Con: ...

### Decision taken (provisional)

**Chose:** <A or B>

**Why:** <1-2 sentences>

### Code markers

- `src/path/to/file.ts:42`
- `src/another/file.ts:117`

### Reversibility justification

<Why is this reversible? Answer:
- What public APIs are affected? (should be none)
- What's the rough cost to revert? (should be <100 lines / <2 files)
- Are any external dependencies involved? (should be no)>

### Needs human review by

End of milestone M<N>.
```

---

## Promoted

- **Q-2026-05-23-001** — *Identifier rewriter strategy for ESM live bindings* —
  promoted to **ADR 0009** (`docs/adr/0009-ast-based-esm-transform.md`). The
  provisional regex/zone-scanner approach was replaced with an AST-based
  rewriter using `acorn` + scope tracking after the regex approach broke for
  real Vite's pre-bundled deps (parameter-shadowing of an imported name).
- **Q-2026-05-23-002** — *Realm where toolchain dev-servers run* — promoted to **ADR 0025** (`docs/adr/0025-toolchain-dev-server-realm.md`). Main-thread realm ratified for M10 Dev Mode and Real Vite; a future Worker + cross-realm bridge remains the right long-term answer (M10 follow-up).
- **Q-2026-05-23-003** — *`process.platform` / `process.arch` honest values vs compat lies* — promoted to **ADR 0026** (`docs/adr/0026-process-platform-honest-values.md`). `'rifty'` / `'wasm'` confirmed as the de-facto public ABI; per-package shim cost accepted; revisit at ~10 shimmed packages.
- **Q-2026-05-23-004** — *File-level shim overlay vs full-package shadow* — promoted to **ADR 0027** (`docs/adr/0027-file-level-shim-overlay.md`). Per-file overlay in the consuming adapter kept until a third shim site appears, at which point the pattern moves into `@rifty/npm-client/shims/`.
- **Q-2026-05-23-005** — *Expanded `@rifty/runtime-js` public surface via `./builtins/*` subpath exports* — promoted to **ADR 0018** (`docs/adr/0018-runtime-js-subpath-exports.md`). Retroactive accept; consolidation to a `./host` entry remains an option for the next public-API review.
- **Q-2026-05-24-007** — *Prod proxy for npm registry* — promoted to **ADR 0028** (`docs/adr/0028-prod-proxy-for-npm-registry.md`); **reopened 2026-05-27** when the audit found the Edge Function source had never landed (see Active section above and ADR-0028 §Status update — 2026-05-27). The Vercel Edge Function candidate is provisional pending implementation.
- **Q-2026-05-27-003** — *WASI preopens — explicit `cwd` and ordering semantics* — promoted to **ADR 0049** (`docs/adr/0049-wasi-cwd-and-atfdcwd-preopen-semantics.md`). esbuild (restored as the forcing consumer by ADR-0047, which reversed ADR-0044's swc substitution) ran through `runWasi` and pinned Option A — `WasiOptions.cwd?: string`. Running it also forced `AT_FDCWD` resolution, directory-open in `path_open`, and `fd_readdir` → `E_NOTDIR` on a file fd, plus wiring the `stdin` option. All in ADR-0049.
- **Q-2026-05-25-touch-utimes** — *Where should `utimes` live on the sync VFS surface?* — promoted to **ADR 0029** (`docs/adr/0029-utimes-on-fs-sync.md`). The trigger condition fired: a second caller (`node:fs.utimesSync` in `runtime-js`) appeared, so the provisional Option B (backend-sniffing in `shell`) was escalated to Option A — `FsSync.utimes` lives on the interface, `MemoryFsSync` mutates the shared backend, `OpfsFsSync` records into an in-memory side-table (`FileSystemSyncAccessHandle` has no mtime mutation). `shell/src/builtins.ts` drops its `@rifty/vfs/internal` import.
- **Q-2026-05-27-002** — *Coherent `OwnerResolver` + readiness-registry swap* — promoted to **ADR 0046** (`docs/adr/0046-preview-owner-binding.md`). The "defer until a second consumer" decision (Option B) paid off: A-023 (SW→Worker direct routing) arrived as the second consumer, so the `PreviewOwnerBinding` seam was designed from both the window and worker shapes at once — `FirstWindowOwnerBinding` (legacy path preserved byte-for-byte) and `WorkerOwnerBinding` (port-keyed routing + the `'gone'` outcome for the no-`pagehide` worker lifecycle trap). The worker readiness frame's `ports` field is additive optional, so no `SW_FRAME_VERSION` bump (ADR-0040/ADR-0031). **The cross-deferral streaming-wire-frame sibling is resolved by ADR-0048 (Q-2026-05-29-001, promoted).**
- **Q-2026-05-29-001** — *Streaming cross-realm preview wire-frame* — promoted to **ADR 0048** (`docs/adr/0048-streaming-cross-realm-preview-wire-frame.md`). Deliberated via a design panel + adversarial review (2026-05-29). Key correction: the bump is a **net-local `PREVIEW_PORT_FRAME_VERSION`** (`@rifty/net`), NOT `SW_FRAME_VERSION` — bumping the latter would be a sibling/reverse import and would invalidate the unrelated SW↔page hop. Four additive `reply-stream-*` frames, buffered `reply` kept as fallback, **per-request** (not per-channel) reply-mode selection, no-progress idle timeout with single-map cleanup. Implemented in `packages/net/src/cross-realm/preview-port.ts`.
- **Q-2026-05-29-002** — *No-symlink `fs.realpath`/`fs.lstat` semantics* — promoted to **ADR 0050** (`docs/adr/0050-no-symlink-realpath-lstat-semantics.md`). Resolved via a dedicated deliberation agent (adversarial M12-forward-compat check). Reverses the prior `NotImplementedError` loud-throw: for the symlink-free VFS, `lstat ≡ stat` and `realpath ≡ normalise-if-exists` are the CORRECT POSIX semantics (no-silent-stubs guards fake values, not the truthful canonical answer — a missing path still throws `ENOENT`). Forcing consumer: real Vite watcher (chokidar/readdirp). Contract test `packages/runtime-js/src/builtins/fs.test.ts` evolved to the stronger no-symlink contract; M12 symlink rewrite tracked by a `TODO(M12)` anchor in `fs.ts`.
- **Q-2026-05-30-001** — *Native-dependency install policy* — promoted to **ADR 0051** (`docs/adr/0051-native-dependency-install-policy.md`). Resolved via a deliberation agent (adversarial false-positive + optional-handling analysis). The installer now throws `ENATIVEUNSUPPORTED` for a package pinning `cpu` to a non-`wasm` set (a compiled artifact) with no shadow substitution; **required** natives abort, **optional** natives skip-with-warning (inherits `walkAndPin`'s existing optional catch — so esbuild's `@esbuild/*` platform optionals skip and Vite still installs). Forcing consumer: `opencode-ai` (native binary → can't run by design). New `docs/compat/incompatible-packages.md`. `cpu`-keyed (not `os`) to avoid false-positives.

---

## Rejected

- **Q-2026-05-23-006** — *`node:https` aliased to `node:http`* — **rejected** in favour of a loud `NotImplementedError`-throwing stub (ADR 0010). Silent stub violated the "no silent stubs" hard rule. Vite's defensive top-level import still works because import-time doesn't trigger the throw.
