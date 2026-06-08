# ADR 0054: Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening (no dedicated cross-package Effect HTTP adapter)

Status: Accepted (ratifies decisions.md draft ADR-0057; opencode facade M12)
Date: 2026-05-30

> TL;DR: Effect's `@effect/platform-node` consumes rifty `node:http` as-is via additive Node-parity widening; no Effect-coupled export added to `packages/net`

## Context

The opencode facade serves HTTP via Effect's `@effect/platform-node` `NodeHttpServer.layer`. The fork: HOW Effect reaches rifty's HTTP surface — consume `node:http` AS-IS (widening additively), OR ship a new Effect-coupled public symbol in `packages/net`.

**Spike B (gate) passed** — a throwaway `packages/net` test exercised Effect-style consumption over rifty's port registry with NO opencode/Effect dependency:
- RESPONSE side works AS-IS (buffered): no-handler `createServer()` + `server.on('request', ...)` + `res.writeHead(200, {...})` + `res.end(JSON…)` via `dispatchToPort` returns correct status, content-type, exact JSON bytes.
- REQUEST side works AS-IS: method/url(pathname+search)/lowercased headers + genuinely-drained Readable body over `@riftydev/io` Readable (`packages/net/src/http/request.ts:46-83`).
- ONLY gap on the P3 buffered first-light path: `listen({port,host}, cb)`. The current `listen(port: number, ...)` signature (`server.ts:27`) keys the registry by the options OBJECT → port unroutable (502 `no_listener`) while `'listening'` still fires (silent-bind trap). REVERSIBLE (Q-2026-05-30-107).

Spike B retires the net-side half of unknown #2: Effect needs nothing beyond standard Node http shapes plus the listen widen.

## Decision

- **D1 — Effect consumes `node:http` AS-IS (option A).** No new exported Effect adapter symbol in `packages/net`. `node:http` is already a registered builtin (`register-builtins.ts:15`) and exported via `packages/net/src/index.ts`; no symbol added. All bridge work is ADDITIVE WIDENING of the shared http surface, each widening independently Node-parity-justified.
- **D2 — Commit to the NEGATIVE.** Options B (`createEffectHttpServer()` export) and C (adapter from a higher layer) REJECTED: they add a cross-package Effect-coupled public API (reversibility rule 1) and invert the net→Effect dependency direction — a permanent surface that can't be quietly removed. "Do not add an Effect adapter export" is cheapest to live with.
- **D3 — Concrete widenings reversible, tracked separately.** The `listen(options)` overload (Q-2026-05-30-107) and Node-style `'drain'` emission (Q-2026-05-30-108) are additive, single-file, REVERSIBLE. They land now for buffered first-light + the streaming write loop.
- **D4 — Pipe-sink DEFERRED (review M4).** Making `ServerResponse` a `.pipe()` target (Q-2026-05-30-109) NOT taken now: it would widen `@riftydev/io`'s `PipeableWritable.write` return type — a second package change governed by ADR-0034 (which restores Node's boolean-only write contract). Facade serves JSON/SSE, not FormData; the Effect web-stream-response path (`Readable.fromWeb(...).pipe(res)`) stays UNSUPPORTED, registered as a compat gap. If ever taken, MUST re-classify as a cross-package change citing ADR-0034 as deliberate divergence, with `write()` kept returning raw boolean (drain carries backpressure).

## Consequences

- The shared `node:http` surface evolves via documented Node-parity gap closures, not Effect hacks. No new cross-package public symbol; the bridge protocol (ADR-0040 SW frame/routing, ADR-0048 preview-port frame) is handler-shape-agnostic and UNCHANGED — no version bump.
- Feature-05 T1-T5 are pure `packages/net` unit work, verifiable now without opencode. The integration harness (T6) stays gated on features 02+04 landing and on pinning the `@effect/platform-node` beta version (fixture concern, not unit blocker).
- ADR-0017 (net buffered scope, streaming deferred to M12) and ADR-0034 (boolean-only write) NOT touched. The deferred pipe-sink is the only path that would touch ADR-0034, explicitly out of scope here.
- **Parity verification vehicle (review M1):** parity is structurally unreachable for `node:http` today (the runner imports only `@riftydev/runtime-js/loader` + `@riftydev/vfs`, never registers `@riftydev/net`). The "additive Node-parity widening" claim must be verified via an opt-in net-registering parity mode (a tools/ harness, layer-legal) with real Node-vs-rifty cases for `createServer+request+res.end(body)` and the `'drain'` streaming loop — NOT hand-asserts alone, else unknown #2 would silently diverge. (Landed this session as parity-runner `kind:'http'` opt-in mode + two cases, commit 8fe16b8.)

## Reversibility

IRREVERSIBLE (reversibility rule 1 — alternative B/C adds cross-package public API). Option A itself is reversible; the CHOICE between A and B/C is the load-bearing fork. Ratified because: Spike B shows Effect needs nothing beyond standard Node shapes plus the listen widen; A commits to the cheapest-to-live-with negative; all concrete widenings are additive/reversible. ADRs immutable after merge; if a future consumer genuinely requires an Effect-coupled adapter export, a superseding ADR is written.

## Risks / follow-ups

- `@effect/platform-node` beta drift: `internal/httpServer.ts` behaviour (parks on `'drain'`, ignores `write()` return) is beta-version-sensitive; pin the version in the integration fixture (T6).
- Pipe-sink/`Readable.fromWeb` gap is the documented compat ceiling; register with an owning ticket (review minor).
- WS/SSE upgrade (`assignSocket`/`server.on('upgrade')`) is HARD-blocker-adjacent, owned by feature 07; T5 negative-locks that this feature does not silently swallow an upgrade into the buffered path (commit faaaf8f).

## References

- ADR-0017 (`@riftydev/net` scope + streaming deferral); ADR-0034 (io boolean-only write — contract the deferred pipe-sink would diverge from); ADR-0040 (SW frame/routing versions); ADR-0048 (preview-port frame).
- decisions.md draft ADR-0057; feature-05-effect-http-bridge.md (Q-101..Q-104, T1-T6).
- Spike B result (Effect-shaped node:http consumption over the port registry, 2026-05-30).
- Q-2026-05-30-107 (listen overload), -108 (drain), -109 (pipe-sink DEFERRED).
