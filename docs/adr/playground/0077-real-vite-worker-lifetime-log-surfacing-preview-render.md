# ADR 0077: Real Vite preview renders — worker lifetime, log surfacing, and SW frame routing

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0043 (Vite-in-Worker realm), ADR-0039 (kernel pre-entry process hook), ADR-0011 (worker IPC / stdio ports), ADR-0074 (SW routes preview-iframe requests to controlling window — ported here), ADR-0076 (read-only worker project mirror), ADR-0073 (PreviewPanel honest-status).

> TL;DR: Real-Vite preview lives: bootstrap restores kernel stdio/`env` over `installProcessGlobals`, parks on a never-resolving `await` to dodge `self.close()`, ports ADR-0074 frame routing

## Context

Report: "real vite won't load" — selecting **Real Vite** looked frozen (no terminal feedback), preview never rendered. The m10 e2e covering this path is `skip`ped by default, so the render path was never CI-verified on this branch; live browser diagnosis found **three stacked breaks**, each hiding the next:

1. **Worker logs went to the void.** `real-vite-bootstrap` calls `installProcessGlobals()` for the richer Node `process` shim Vite needs. But the kernel pre-entry hook (ADR-0039, `install-process.ts`) had *already* installed a `process` whose `stdout`/`stderr` are wired to the stdio MessagePorts (→ playground terminal); `installProcessGlobals()` overwrote it with a shim whose `stdout.write` is `console.log` and whose `env` is empty. So all worker logs — install progress, `vite is listening`, **and error stacks** — vanished. Zero feedback, and the real failure below stayed invisible.

2. **Worker killed the instant bootstrap resolved.** Kernel `installWorkerEntry` (`worker-entry.ts`), right after `await runEntry(spec.entry)`, does `postMessage({type:'exit'})` → `closePorts()` → **`self.close()`**. Correct for run-to-completion (REPL/CLI), wrong for a long-running **dev server**: its top-level `await bootstrap()` resolves *after* Vite starts listening, so the realm was torn down a beat later. Vite died; every subsequent cross-realm preview request hit a dead worker → page-side bridge timed out → `502 preview-port bridge timeout after 30000ms`. (The bootstrap comment wrongly assumed the kernel only terminates on page `.kill()`.) Confirmed via a fixed-name `BroadcastChannel` ping: both directions silent after boot — worker gone, not blocked.

3. **In-frame navigation didn't commit.** Even with the route alive, the preview `<iframe>` stayed on `about:blank`: the SW resolved the owner from `resultingClientId`/`clientId` (ADR-0031), which for a sub-frame navigation is the iframe's own client (no `setupPreviewBridge`), not the controlling window that owns the port. Exactly **ADR-0074**, whose fix lived on another branch and was absent here.

Plus UX consequence (4): `PreviewPanel` warm-up (25 s budget, but each probe blocked up to the 30 s bridge-timeout while the worker wasn't serving) gave up before a ~20–30 s npm install finished, showing a false `unavailable`.

Multi-file bugfix; only behaviour-contract change is porting already-ratified ADR-0074 SW routing. No new dependency, no cross-package API change. Ratified inline (ADR-0063).

## Decision

1. **Preserve kernel stdio + env across `installProcessGlobals()`** (`real-vite-bootstrap.ts`, `installRuntimeGlobals`). Capture `process.stdout`/`stderr`/`env` before the swap, restore after — worker keeps writing to the page terminal and keeps the spawn-spec env while still getting the richer shim. Failure stacks surface again.

2. **Keep the worker realm alive** (`real-vite-bootstrap.ts`): after wiring dev server + HMR + preview bridges, `await new Promise<never>(() => {})`. The entry's top-level `await` never resolves, so `installWorkerEntry` never reaches `self.close()`; the realm stays live until the page handle `.kill()`s it (`worker.terminate()`, independent of this promise). Fixes the 502.

3. **Port ADR-0074 to this branch** (`preview-bridge.ts`): route requests originating inside the preview frame — `request.mode === 'navigate'` OR non-empty `request.destination` — to the controlling window (`clientId = null` → resolver's first-controlled-window fallback), keeping `resultingClientId || clientId` only for the page's own bare `fetch` warm-up. SW-local, off-wire, `SW_ROUTING_VERSION` stays `'1'`. Dev-fixture companion (`devMode.ts` relative `src="src/main.js"`) comes with it.

4. **Make warm-up span an install** (`PreviewPanel.tsx`): each probe uses a short per-fetch `AbortController` (so a 30 s bridge-timeout can't eat the budget); overall deadline 90 s. Real Vite auto-loads to `live` without manual Reload; a genuinely-down server still resolves to `unavailable`, just later.

Verified live end-to-end: terminal streams `installing vite … → vite is listening → preview bridge ready`; `/preview/5174/` returns `200`; iframe commits `http://localhost:5273/preview/5174/` and renders "Hello from rifty" with the HMR-bridge script injected; panel reaches `live` ~22 s after click, no manual step.

## Alternatives considered

- **Fix worker lifetime in the kernel** (no `self.close()` for server processes; explicit shutdown signal). The correct long-term fix, but changes `@riftydev/kernel` public behaviour for all workers (IRREVERSIBLE, broad blast radius) and isn't needed to unblock real-vite. Kept playground-local; tracked as kernel follow-up.
- **Skip `installProcessGlobals()` in the bootstrap** (rely on the kernel process). Rejected: the kernel process lacks the nextTick-patch + full Node surface Vite reaches for; preserving stdio across the richer install is smaller/safer than auditing what Vite needs.
- **Leave warm-up at 25 s, rely on manual Reload.** Rejected: a 20–30 s install making the headline demo show "unavailable" until a manual click is a bad first impression; abort + longer budget is honest and self-correcting.

## Consequences

- (+) Real Vite works end-to-end: visible install/boot progress, server stays up, preview renders + auto-loads in-frame.
- (+) Worker stderr stacks reach the terminal — future real-vite failures are diagnosable, not silent.
- (+) No new dependency; SW change is a port of ratified ADR-0074 (no wire/version bump).
- (−) **Kernel limitation surfaced:** a long-running worker entry must *never let its top-level `await` resolve*, or the kernel tears it down (`self.close()` on entry-return). The keep-alive is a workaround; the kernel should natively support server-shaped processes (stay alive until explicit exit/shutdown). Follow-up.
- (−) The dev `vite preview` (production build) path still isn't CI-covered, m10 stays gated; a real-`<iframe>` render smoke would have caught all of the above. Tracked.
