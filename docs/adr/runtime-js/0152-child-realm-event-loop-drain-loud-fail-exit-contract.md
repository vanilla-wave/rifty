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
`packages/runtime-js/src/internal/event-loop-keepalive.ts` implements a keepalive refcount. The model is COUNT-ALL-ACTIVE-HANDLES = the libuv/Node model: the loop stays alive while any refed handle exists; exits at zero. Counted handles: `setTimeout`/`setInterval` (including those created via `global` after the node-env wrap), `setImmediate`, and pending dynamic imports (each `import()` increments on start, decrements on settle). The count is exposed as an observable stream; `awaitDrain()` resolves when it hits zero.

**2. Kernel drain seam — opaque, Node-API-agnostic.**
`packages/kernel/src/worker-entry.ts` gains `setKernelDrainHook(fn)` — a single async hook called in `finalizeWorkerEntry` for run-to-completion workers only, before process teardown. The hook is opaque to the kernel (a `() => Promise<void>` — kernel stays Node-API-agnostic per ADR-0039). runtime-js installs keepalive's `awaitDrain` via this seam. The pattern mirrors `preEntryHook` already on that seam; a WASI guest could reuse the same drain seam with a different implementation.

**3. Loud-fail on `unhandledrejection`.**
`installUnhandledRejectionTrap()` (runtime-js) records the first unhandled rejection. It does NOT `preventDefault()` — the default browser/worker report still fires in every realm. The drain seam checks: if a rejection was recorded → write to stderr + exit 1 (never silent exit 0). This matches Node's behavior: `process.on('unhandledRejection', …)` emits a warning and exits non-zero by default.

**4. Drain cap — deliberate non-Node divergence.**
The `awaitDrain` poll resolves at refCount=0 OR at a generous timeout cap. Node has no cap; a refed `setInterval` runs forever. The cap is a browser-worker safety-net against genuine hangs/leaks. It is LOUD: cap expiry → stderr explaining the cap + exit 1 (never silent). Programs that legitimately run forever use `serve:true`; the cap never fires on those. Documented in the compat matrix as a deliberate divergence.

**5. Child realm de-contamination via indirect dynamic import.**
The Vite HMR client `setInterval` was injected by the bundler into the entry chunk. Fix: `runEntry` in `worker-entry.ts` uses an INDIRECT dynamic import (`(0, eval)('import(url)')` pattern / a `Function`-constructed import call) so bundlers cannot statically analyse and inject into the child's entry module. This is a generic bundler-agnostic workaround — not Vite-specific. rifty's own internal drain-poll timer uses a host-side `setTimeout` (uncounted — mirrors Node's internal unref'd timers).

**Explicit gaps (Fidelity — gaps are explicit, never hidden).**
- `.unref()`/`.ref()`/`.hasRef()` on public `Timeout`/`Immediate` objects not implemented → a user program calling `.unref()` on a timer cannot opt out of keepalive (would drain to cap). In the browser-worker environment `host setTimeout` returns a number, so `.unref()` already throws loudly on the host handle; the silent-ignore risk is node-env only. Tracked: `backlog/runtime-js/timer-unref-keepalive.md`.
- A nested child (depth≥2) arms its sync-RPC dispatcher backstop `setInterval` (keepalive-counted) → would pin the drain. Not reachable today (`execSync` of a node command is `EUNSUPPORTED`); fix when reachable = use an uncounted host timer for the dispatcher backstop. Tracked in the same backlog item.

## Consequences

- (+) run-to-completion child exits only on empty event loop — matches real Node (ADR-0150 P6a regression closed).
- (+) `unhandledrejection` → stderr + exit 1, never silent (fidelity + debuggability).
- (+) Child realm free of bundler-injected infra by construction — generic fix, not a Vite workaround.
- (+) Drain seam generalises: WASI guest can register its own drain hook without touching kernel Node-API knowledge.
- (−) Drain CAP is not Node-faithful (documented divergence). Legit-forever programs must use `serve:true`.
- (−) `.unref()` not implemented → over-eager drain prevention for programs that `.unref()` timers. Tracked, explicit.
- (−) Nested-child dispatcher backstop would pin drain if nested node spawn were reachable. Tracked, explicit.

## References

- `packages/runtime-js/src/internal/event-loop-keepalive.ts` — refcount + `awaitDrain()`
- `packages/kernel/src/worker-entry.ts` — `setKernelDrainHook`, `finalizeWorkerEntry`
- `backlog/runtime-js/timer-unref-keepalive.md` — `.unref()` + nested-child backstop gap
- `docs/public/compat/` — drain cap divergence entry
- ADR-0150, ADR-0144, ADR-0085, ADR-0039
