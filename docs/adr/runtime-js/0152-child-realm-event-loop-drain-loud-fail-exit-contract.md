# ADR 0152: Child realm event-loop drain + loud-fail exit contract

Status: Accepted
Date: 2026-06

> TL;DR: A run-to-completion child (`serve!==true`) exits on EVENT-LOOP DRAIN (libuv count-all-active-handles model, refCount→0), not at top-level resolve; `unhandledrejection` surfaces as stderr + exit 1 (loud-fail, never silent); kernel gains an opaque drain seam; runtime-js owns keepalive semantics (ADR-0039 boundary); child realm is de-contaminated from bundler-injected infra via indirect dynamic import.

## Context

ADR-0150 P6a regressed run-to-completion semantics: async work (timers, pending imports) spawned after top-level `await` could be silently dropped — the child resolved as soon as the top-level entry resolved, never waiting for its event loop to drain. Real Node exits when the event loop is EMPTY (no live refed handles); top-level resolve is not exit.

Parallel problem: `unhandledrejection` inside the child produced no observable output (no stderr, exit 0). Node emits a runtime warning + exits non-zero.

A third problem: the Vite dev-server HMR client — bundler infrastructure injected at build time — was running a `setInterval` ping loop inside the child realm. The child's event loop never drained because this bundler-injected handle was always live.

## Decision

**1. Exit on event-loop drain, not top-level resolve.**
`packages/runtime-js/src/internal/event-loop-keepalive.ts` implements a keepalive refcount in the SHAPE of the libuv/Node model — loop stays alive while a refed handle exists, exits at zero — but over a DELIBERATELY NARROW handle set, NOT all libuv handles. Counted: `setTimeout`/`setInterval` (including those created via `global` after the node-env wrap), `setImmediate`, and pending dynamic imports (each `import()` increments on start, decrements on settle — on BOTH the `loader.import` and routed user-code `__import` → `esm.ts dynamicImport` paths). Detached `fetch()`/network and other libuv handle classes are NOT counted (see Explicit gaps). The current count is a plain sync getter (`activeRefs()`); `awaitDrain()` polls it and resolves when it hits zero.

**2. Kernel drain seam — opaque, Node-API-agnostic.**
`packages/kernel/src/worker-entry.ts` gains `setKernelDrainHook(fn)` — a single async hook called in `finalizeWorkerEntry` for run-to-completion workers only, before process teardown. The hook is opaque to the kernel (a `() => Promise<void>` — kernel stays Node-API-agnostic per ADR-0039). runtime-js installs keepalive's `awaitDrain` via this seam. The pattern mirrors `preEntryHook` already on that seam; a WASI guest could reuse the same drain seam with a different implementation.

**3. Loud-fail on `unhandledrejection`.**
`installUnhandledRejectionTrap()` (runtime-js) records the first unhandled rejection. It does NOT `preventDefault()` — the default browser/worker report still fires in every realm. The drain seam checks: if a rejection was recorded → write to stderr + exit 1 (never silent exit 0). This matches Node's behavior: `process.on('unhandledRejection', …)` emits a warning and exits non-zero by default.

**4. Drain cap — deliberate non-Node divergence.**
The `awaitDrain` poll resolves at refCount=0 OR at a generous timeout cap. Node has no cap; a refed `setInterval` runs forever. The cap is a browser-worker safety-net against genuine hangs/leaks. It is LOUD: cap expiry → stderr explaining the cap + exit 1 (never silent). Programs that legitimately run forever use `serve:true`; the cap never fires on those. Documented as a deliberate divergence on the public compat surface (`docs/public/compat/process.md`).

**5. Child realm de-contamination via indirect dynamic import.**
The Vite HMR client `setInterval` was injected by the bundler into the entry chunk. Fix: `runEntry` in `worker-entry.ts` builds the importer through an INDIRECT eval — `(0, eval)('u => import(u)')` returns an importer arrow which is then called with the entry url — so no bundler's static lexer sees a literal `import(<var>)` to analyse and inject into the child's entry module. Generic + bundler-agnostic, not Vite-specific. (Cost: that import loses its source map — acceptable; the realm is infra, not user code.) rifty's own internal drain-poll timer uses a host-side `setTimeout` (uncounted — mirrors Node's internal unref'd timers).

**Explicit gaps (Fidelity — gaps are explicit, never hidden).** The narrow handle set (Decision 1) has two-sided divergence — under-counts some live work, over-counts other:
- Detached `fetch()`/network after top-level is NOT counted → an in-flight request can be reaped before it settles (silent drop). The honest claim is "counts timers/immediates/imports", not "all handles". Tracked: `docs/backlog/runtime-js/keepalive-residual-gaps.md`. → **SHIPPED (ADR-0158):** the global `fetch` is now counted (ref on dispatch, held until the body is consumed); §1's set is "timers/immediates/imports + global fetch".
- `fs.watch`/`fs.watchFile` poll `setInterval` IS counted (and their `FSWatcher.ref()`/`.unref()` are no-op stubs) → an active watcher force-exits at the drain cap, where Node runs forever. Same backlog item.
- `.unref()`/`.ref()`/`.hasRef()` on public `Timeout`/`Immediate` objects not implemented → a user program calling `.unref()` on a timer cannot opt out of keepalive (would drain to cap). In the browser-worker environment `host setTimeout` returns a number, so `.unref()` already throws loudly on the host handle; the silent-ignore risk is node-env only. Same backlog item.
- A nested child (depth≥2) arms its sync-RPC dispatcher backstop `setInterval` (keepalive-counted) → would pin the drain. Not reachable today (`execSync` of a node command is `EUNSUPPORTED`); fix when reachable = use an uncounted host timer for the dispatcher backstop. Same backlog item. → **SHIPPED (ADR-0158):** the backstop now captures the host `setInterval` at module load (uncounted by construction — §5 precedent).

**Corrected (2026-06-20):** the tracking backlog `timer-unref-keepalive.md` was closed + replaced by `docs/backlog/runtime-js/keepalive-residual-gaps.md` (repointed above). Three of the four gaps above are now SHIPPED, superseding their present-tense wording: timer `.unref()`/`.ref()`/`.hasRef()` + `node:timers` namespace symmetry + `clearTimeout/clearInterval(Number(handle))` by primitive id (bullets 2-3), and `FSWatcher.ref()`/`.unref()` now delegate to the keepalive poll handle (bullet 1's no-op-stub clause) — all compat ✅. RESIDUAL = detached `fetch()`/network uncounted + the nested-spawn dispatcher backstop only. The narrow-handle-set Decision (1) is unchanged; widening it to network is a future superseding ADR, not a silent change.

**Extended (2026-06-20):** both RESIDUAL gaps are now CLOSED by **ADR-0158** — Decision §1's counted set is extended to the global `fetch` (ref on dispatch, held until the body is consumed; gap-d), and the dispatcher backstop moved off the counted globals to a module-load host timer (gap-e). §1's shape (narrow, libuv-style refcount over a named set — NOT all handles) is unchanged; only the named set grew. Listed in README "Corrections (active)".

## Consequences

- (+) run-to-completion child exits on event-loop drain (over the counted handle set), much closer to real Node than the prior top-level-resolve reap — addresses the detached-async drop we attribute to the ADR-0150 P6a path.
- (+) `unhandledrejection` → stderr + exit 1, never silent (fidelity + debuggability).
- (+) Child realm free of bundler-injected infra by construction — generic fix, not a Vite workaround.
- (+) Drain seam generalises: WASI guest can register its own drain hook without touching kernel Node-API knowledge.
- (−) Drain CAP is not Node-faithful (documented divergence). Legit-forever programs must use `serve:true`.
- (−) Keepalive counts a NARROW handle set (timers/immediates/imports), not all libuv handles → detached network can reap early; `fs.watch` over-counts (force-exit at cap). Tracked, explicit.
- (−) `.unref()` not implemented → over-eager drain prevention for programs that `.unref()` timers. Tracked, explicit.
- (−) Nested-child dispatcher backstop would pin drain if nested node spawn were reachable. Tracked, explicit.

## References

- `packages/runtime-js/src/internal/event-loop-keepalive.ts` — refcount + `awaitDrain()`
- `packages/kernel/src/worker-entry.ts` — `setKernelDrainHook`, `finalizeWorkerEntry`
- `docs/backlog/runtime-js/keepalive-residual-gaps.md` — residual keepalive gaps (detached fetch + nested-child backstop); supersedes the closed `timer-unref-keepalive.md`
- `docs/public/compat/process.md` — drain-cap divergence row + keepalive scope
- ADR-0150, ADR-0144, ADR-0085, ADR-0039
