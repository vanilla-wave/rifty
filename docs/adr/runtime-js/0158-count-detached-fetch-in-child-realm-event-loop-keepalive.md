# ADR 0158: Count detached fetch in child-realm event-loop keepalive

Status: Accepted
Date: 2026-06

> TL;DR: Widen ADR-0152 §1's narrow keepalive handle set to also count the host worker `fetch` — ref on dispatch, hold until the response BODY is consumed — so a detached `fetch(u).then(r=>r.text()).then(write)` after top-level keeps a run-to-completion child realm alive until it settles (Node parity), instead of reaping early + dropping silently. Extends ADR-0152 §1; the dispatcher-backstop infra timer (gap-e) is moved off the counted globals.

**Corrected (2026-08-11):** Decision §1's public-Body hook list was not
exhaustive: Chromium `WebAssembly.compileStreaming` / `instantiateStreaming`
consume `Response` internal slots and accept arbitrary Responses/PromiseLikes.
Exact-fetch mediation is therefore partial: clones/untracked carriers escape
correlation; primordial Body calls escape instance hooks. Both streaming APIs
now reject a Promise with `NotImplementedError('WebAssembly.<api>')` for every
carrier. Non-streaming Body consumers retain Decision §1. Listed in README
"Corrections (active)".

This correction does not claim tracked `Response.clone()` lifecycle parity.
The public Body wrapper can retain the pre-clone stream; that separate observed
gap is explicit in compat and `backlog/runtime-js/fetch-keepalive-response-clone-lifecycle`.

Discarded RED lineage (2026-08-11): native parity reached success/error,
direct/Promise, lock, correlation, and Body-mixin rows before the escape proof
invalidated that contract. The replacement RED pins the whole-realm ceiling,
including untracked PromiseLikes and validation-error priority.

## Fault matrix (2026-08-11 correction)

| Fault | Boundary | Proof |
|---|---|---|
| `sibling-drift` | `compileStreaming` vs `instantiateStreaming` | shared Chromium ceiling suite; same error/Promise plus effective property, name/length, own descriptors |
| `observable-order` | ceiling vs native validation/body consumption | ceiling Promise rejects first; no sync/secondary throw; tracked ref unchanged until exact cancel |
| `provenance-lie` | exact direct/raw-Promise and untracked direct/PromiseLike/clone streaming carriers | unconditional namespace ceiling leaves no streaming-source correlation escape; tracked `Response.clone()` is a named residual |
| `corrupt-input` | malformed source; invalid instantiate imports | same feature-specific loud gap wins without consuming body |

## Context

ADR-0152 §1 counts a DELIBERATELY NARROW handle set — timers/immediates/pending dynamic imports — and explicitly leaves network OUT (its "Explicit gaps", gap-d). The host worker `fetch` is the child realm's ONLY real network-egress primitive: there is no rifty `fetch` in the worker (user code hits the host global — `npm-client/src/registry.ts`, `playground/src/glue/registry-fetch.ts`); `node:http.request` to an EXTERNAL host delegates to `fetch` (`packages/net/src/http/server.ts`); `node:https`/`node:net.connect` are loud `NotImplementedError`. So an in-flight `fetch` detached after top-level held no keepalive ref → the realm could drain to zero and reap BEFORE the response arrived → silent drop (same under-count class as the already-fixed detached-`import().then(run)`).

A second ADR-0152 explicit gap (gap-e): the sync-RPC dispatcher backstop `setInterval` (`kernel/src/ipc/sync-dispatch.ts`) read the realm's GLOBAL `setInterval`, which a worker realm replaces with the keepalive-counted wrapper (`installTimerGlobals`). At depth-1 it netted to zero via the wrapped handle's `.unref()`, but that coupled infra liveness to the keepalive count — a nested child (depth-2) would have its drain pinned.

## Decision

**1. Count the global `fetch` boundary, body-inclusive (extends ADR-0152 §1).**
`installFetchKeepalive()` (`packages/runtime-js/src/builtins/fetch-keepalive.ts`) wraps the realm's `fetch`: `keepaliveRef()` on dispatch; release once the response BODY is consumed (any Body-mixin consumer — `text`/`json`/`arrayBuffer`/`blob`/`formData`/`bytes` — or the `body` stream closes/cancels/errors), OR the request rejects, OR there is no body (204/304/HEAD). Held until BODY (not headers) because Node keeps the socket refed until the body is read — releasing at fetch-resolve would let the realm reap mid-`.text()` (race-dependent). Symmetric with `loader.import` ref-on-start/unref-on-settle, extended across the body read. Installed in the child-realm bootstrap next to `installTimerGlobals`/`installEventLoopKeepalive` (`apps/playground/src/workers/kernel-worker-entry.ts`); no-op when the realm has no `fetch` (honest — nothing to count, never a silent stub).

`WebAssembly.compileStreaming` and `instantiateStreaming` are excluded from this
counted subset. Installation replaces both realm methods with Promise-rejected
`NotImplementedError` ceilings for every carrier and argument shape; native
internal-slot consumption is never partially exposed. Effective
property descriptors plus function name/length/own descriptors stay native.

**2. Dispatcher backstop is uncounted infra (closes gap-e).**
`sync-dispatch.ts` captures the HOST `setInterval`/`clearInterval` at module load (before `installTimerGlobals` can wrap the globals) and arms the backstop on them — so rifty's own infra timer never enters the keepalive count, by construction (same principle as ADR-0152 §5's host-`setTimeout` drain poll). Removes the depth-1 count-then-`.unref()` coupling and the depth-2 drain-pin.

**3. Honest coverage boundary (Fidelity).**
The counted unit is the global `fetch` through public Body consumption, not
native WebAssembly streaming. `http.request`-to-external is covered (it routes
through `fetch`); loopback `http.request` is in-process port-registry dispatch
(microtask-settled, no socket — not a real divergence); `https`/`net.connect`
and both WebAssembly streaming APIs are loud-throws/rejections (nothing hidden
in flight). An exotic Response whose body is NEVER consumed holds the realm to
the ADR-0152 §4 drain cap (loud) — matching Node keeping an undrained socket alive.

## Consequences

- (+) Detached `fetch().then(...).then(write)` after top-level completes before reap — closes the network under-count, the last big detached-async drop class. compat `process.md` "Detached fetch()" ❌→✅.
- (+) Infra timers fully decoupled from keepalive (gap-e) — nested-child drain can never be pinned by the dispatcher backstop.
- (−) Widens ADR-0152 §1's counted set beyond timers/immediates/imports (recorded here, not a silent change). The honest claim is now "timers/immediates/imports + global fetch", still NOT the full libuv handle set.
- (−) A never-consumed response body holds the realm to the drain cap (loud, documented) — Node-ish (undrained socket), not Node-exact.
- (−) WebAssembly streaming compilation is unavailable in the child realm;
  callers receive a feature-specific rejected Promise instead of partial native
  behavior. Byte-buffer `WebAssembly.compile`/`instantiate` remain available.
  `Function.prototype.toString` exposes the anonymous native Proxy instead of
  Chromium's named native function source; explicit reflection drift inside
  this already-unsupported surface, not a false fidelity claim.
- Guard: `packages/runtime-js/src/builtins/fetch-keepalive.test.ts` (real loopback `http.createServer` + real host fetch + real `awaitDrain`), `tests/e2e/fetch-keepalive-webassembly-streaming.spec.ts` (whole-realm ceiling/carrier/error-priority/effective descriptors), `packages/kernel/src/ipc/sync-dispatch.test.ts` (backstop uses the host timer, not the wrapped global).

## References

- ADR-0152 §1 (narrow handle set — extended here), §4 (drain cap), §5 (host-timer infra precedent)
- `packages/runtime-js/src/builtins/fetch-keepalive.ts` — the wrapper
- `packages/kernel/src/ipc/sync-dispatch.ts` — host-timer backstop (gap-e)
- `docs/public/compat/process.md` — Detached fetch row
- `docs/backlog/runtime-js/keepalive-residual-gaps.md` — gap-d/gap-e (closed by this ADR)
