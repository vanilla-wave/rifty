# ADR 0077: Real Vite preview renders — worker lifetime, log surfacing, and SW frame routing

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0043 (Vite-in-Worker — the real-vite worker realm), ADR-0039 (kernel pre-entry process hook), ADR-0011 (worker IPC / stdio ports), ADR-0074 (SW routes preview-iframe requests to the controlling window — ported to this branch here), ADR-0076 (the read-only worker project mirror, which surfaced alongside this), ADR-0073 (PreviewPanel honest-status design).

## Context

Reported: "real vite не грузится" — selecting **Real Vite** appeared frozen (no terminal feedback) and the preview never rendered. Live diagnosis in a real browser (the only way to see it — the m10 e2e that covers this path is `skip`ped by default, so the whole real-vite render path was never CI-verified on this branch) found **three independent breaks**, stacked so each hid the next:

1. **Worker logs went to the void.** `real-vite-bootstrap` calls `installProcessGlobals()` for the richer Node `process` shim Vite needs. But the kernel's pre-entry hook (ADR-0039, `install-process.ts`) had *already* installed a `process` whose `stdout`/`stderr` are wired to the stdio MessagePorts (→ the playground terminal); `installProcessGlobals()` overwrote it with a shim whose `stdout.write` is `console.log` and whose `env` is empty. So every worker log — install progress, `vite is listening`, **and any error stack** — vanished. The mode looked frozen with zero feedback, and the real failure below was invisible.

2. **The worker was killed the instant bootstrap resolved.** The kernel's `installWorkerEntry` (`worker-entry.ts`) does, right after `await runEntry(spec.entry)`: `postMessage({type:'exit'})` → `closePorts()` → **`self.close()`**. That is correct for a run-to-completion program (REPL/CLI), but this entry is a long-running **dev server**: its top-level `await bootstrap()` resolves *after* Vite starts listening, so the realm was torn down a beat later. Vite died, and every subsequent cross-realm preview request hit a dead worker → the page-side bridge timed out → `502 preview-port bridge timeout after 30000ms`. (The bootstrap's own comment wrongly assumed "the kernel terminates the realm when the page `.kill()`s".) Confirmed with a fixed-name `BroadcastChannel` ping: both directions went silent *after* boot — the worker was gone, not blocked.

3. **The in-frame navigation didn't commit.** Even with the route alive, the preview `<iframe>` stayed on `about:blank`: the SW resolved the owner from `resultingClientId`/`clientId` (ADR-0031), which for a sub-frame navigation is the iframe's own client (runs no `setupPreviewBridge`), not the controlling window that owns the port. This is exactly **ADR-0074**, whose fix lived on another branch and was absent here.

Plus a UX consequence (4): `PreviewPanel`'s warm-up (25 s budget, but each probe blocked up to the 30 s bridge-timeout while the worker wasn't serving) gave up before a ~20–30 s npm install finished, showing a false `unavailable`.

This is a multi-file bugfix bringing a long-broken path to working; the only behaviour-contract change is porting the already-ratified ADR-0074 SW routing. No new dependency, no cross-package API change. Ratified inline (ADR-0063).

## Decision

1. **Preserve the kernel stdio + env across `installProcessGlobals()`** (`real-vite-bootstrap.ts`, `installRuntimeGlobals`). Capture `process.stdout`/`stderr`/`env` before the swap and restore them after, so the worker keeps writing to the page terminal (and keeps the spawn-spec env) while still getting the richer shim. Worker logs — including failure stacks — surface again.

2. **Keep the worker realm alive** (`real-vite-bootstrap.ts`): after wiring the dev server + HMR + preview bridges, `await new Promise<never>(() => {})`. The entry module's top-level `await` never resolves, so `installWorkerEntry` never reaches `self.close()`; the realm stays live (event loop, Vite, bridges) until the page-side handle `.kill()`s it (`worker.terminate()`, independent of this promise). This is the fix for the 502.

3. **Port ADR-0074 to this branch** (`preview-bridge.ts`): route requests that originate inside the preview frame — `request.mode === 'navigate'` OR a non-empty `request.destination` — to the controlling window (`clientId = null` → resolver's first-controlled-window fallback), keeping `resultingClientId || clientId` only for the page's own bare `fetch` warm-up. SW-local, off-wire, `SW_ROUTING_VERSION` stays `'1'`. The dev-fixture companion (`devMode.ts` relative `src="src/main.js"`) comes with it.

4. **Make the warm-up span an install** (`PreviewPanel.tsx`): each probe uses a short per-fetch `AbortController` (so a 30 s bridge-timeout can't eat the budget) and the overall deadline is 90 s. Real Vite now auto-loads to `live` without a manual Reload; a genuinely-down server still resolves to `unavailable`, just later.

Verified live end-to-end: the terminal streams `installing vite … → vite is listening → preview bridge ready`; `/preview/5174/` returns `200`; the iframe commits `http://localhost:5273/preview/5174/` and renders "Hello from rifty" with the HMR-bridge script injected; the panel reaches `live` ~22 s after clicking Real Vite, no manual step.

## Alternatives considered

- **Fix the worker lifetime in the kernel** (don't `self.close()` for long-running/server processes; add an explicit shutdown signal). The *correct* long-term fix — the kernel shouldn't assume every entry runs to completion — but it changes `@riftydev/kernel` public behaviour for all workers (IRREVERSIBLE, broad blast radius) and isn't needed to unblock real-vite. Kept playground-local for now; tracked as a kernel follow-up.
- **Don't call `installProcessGlobals()` in the bootstrap** (rely on the kernel process). Rejected: the kernel process lacks the nextTick-patch + full Node surface Vite reaches for; preserving stdio across the richer install is smaller and safer than auditing what Vite needs from the shim.
- **Leave the warm-up at 25 s and rely on manual Reload.** Rejected: a 20–30 s npm install making the headline demo show "unavailable" until a manual click is a bad first impression; the abort + longer budget is honest and self-correcting.

## Consequences

- (+) Real Vite works end-to-end: visible install/boot progress, the dev server stays up, and the preview renders + auto-loads in-frame.
- (+) Worker stderr stacks now reach the terminal — future real-vite failures are diagnosable instead of silent.
- (+) No new dependency; the SW change is a port of ratified ADR-0074 (no wire/version bump).
- (−) **Kernel limitation surfaced:** a long-running worker entry must *never let its top-level `await` resolve*, or the kernel tears it down (`self.close()` on entry-return). The keep-alive is a workaround; the kernel should natively support server-shaped processes (a `worker-entry` that stays alive until an explicit exit/shutdown). Follow-up.
- (−) The dev `vite preview` (production build) path still isn't CI-covered, and m10 stays gated; a real-`<iframe>` render smoke would have caught all of the above. Tracked.
