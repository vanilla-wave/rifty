# ADR 0054: Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening (no dedicated cross-package Effect HTTP adapter)

Status: Accepted (ratifies decisions.md draft ADR-0057; opencode facade M12)
Date: 2026-05-30

## Context

The opencode facade serves HTTP via Effect's `@effect/platform-node`
`NodeHttpServer.layer`. The architecturally load-bearing fork is HOW Effect reaches
rifty's HTTP surface: consume the existing `node:http` builtin AS-IS (widening it
additively), OR ship a new Effect-coupled public symbol in `packages/net`.

**Spike B (gate) passed.** A throwaway `packages/net` test exercised the Effect-style
consumption shape over rifty's port registry, with NO opencode/Effect dependency:
- The RESPONSE side works AS-IS at the buffered level: a no-handler `createServer()`
  + `server.on('request', ...)` + `res.writeHead(200, {...})` + `res.end(JSON…)`
  dispatched via `dispatchToPort` returns the correct status, content-type, and
  exact JSON bytes.
- The REQUEST side works AS-IS: method/url(pathname+search)/lowercased headers and
  a genuinely-drained Readable body over `@rifty/io` Readable
  (`packages/net/src/http/request.ts:46-83`) — the body actually flowed.
- The ONLY gap on the P3 buffered first-light path is `listen({port,host}, cb)`:
  the current `listen(port: number, ...)` signature (`server.ts:27`) keys the port
  registry by the options OBJECT, so the port is unroutable (502 `no_listener`)
  while `'listening'` still fires — a silent-bind trap. That gap is REVERSIBLE
  (Q-2026-05-30-107).

Spike B retires the net-side half of unknown #2: Effect needs nothing beyond
standard Node http shapes plus the listen widen.

## Decision

- **D1 — Effect consumes the existing `node:http` AS-IS (option A).** NO new
  exported Effect adapter symbol in `packages/net`. `node:http` is already a
  registered builtin (`register-builtins.ts:15`) and exported via
  `packages/net/src/index.ts`; this decision adds no symbol there. All bridge work
  is ADDITIVE WIDENING of the shared http surface, each widening independently
  Node-parity-justified.
- **D2 — This ADR commits to the NEGATIVE.** Options B (`createEffectHttpServer()`
  export) and C (adapter from a higher layer) are REJECTED: B/C add a cross-package
  Effect-coupled public API (reversibility rule 1) and invert the net→Effect
  dependency direction (net knowing Effect) — a permanent surface that cannot be
  quietly removed. Committing to "do not add an Effect adapter export" is the
  cheapest outcome to live with.
- **D3 — Concrete widenings are reversible and tracked separately.** The
  `listen(options)` overload (Q-2026-05-30-107) and the Node-style `'drain'`
  emission (Q-2026-05-30-108) are additive, single-file, REVERSIBLE. They land now
  for the buffered first-light + the streaming write loop.
- **D4 — Pipe-sink is DEFERRED (review M4).** Making `ServerResponse` a `.pipe()`
  target (Q-2026-05-30-109) is NOT taken now: it would widen `@rifty/io`'s
  `PipeableWritable.write` return type — a SECOND package change governed by
  ADR-0034 (whose purpose is to restore Node's boolean-only write contract). The
  facade serves JSON/SSE, not FormData; the Effect web-stream-response path
  (`Readable.fromWeb(...).pipe(res)`) stays UNSUPPORTED and is registered as a
  compat gap. If ever taken, it MUST re-classify as a cross-package change citing
  ADR-0034 as a deliberate divergence, with `write()` kept returning raw boolean
  (drain carries backpressure).

## Consequences

- The shared `node:http` surface evolves via documented Node-parity gap closures,
  not Effect hacks. No new cross-package public symbol; the bridge protocol
  (ADR-0040 SW frame/routing, ADR-0048 preview-port frame) is handler-shape-agnostic
  and UNCHANGED — no version bump.
- Feature-05 T1-T5 are pure `packages/net` unit work, verifiable now without
  opencode. The integration harness (T6) stays gated on features 02+04 landing and
  on pinning the `@effect/platform-node` beta version (a fixture concern, not a
  unit-level blocker).
- ADR-0017 (net buffered scope, streaming deferred to M12) and ADR-0034 (boolean-only
  write) are NOT touched by this decision. The deferred pipe-sink is the only path
  that would touch ADR-0034, and it is explicitly out of scope here.
- **Parity verification vehicle (review M1):** parity is structurally unreachable
  for `node:http` today (the runner imports only `@rifty/runtime-js/loader` +
  `@rifty/vfs` and never registers `@rifty/net`). The "additive Node-parity
  widening" claim must be verified by an opt-in net-registering parity mode (a
  tools/ harness, layer-legal) with real Node-vs-rifty cases for
  `createServer+request+res.end(body)` and the `'drain'` streaming loop — NOT by
  hand-asserts alone, since unknown #2 would otherwise silently diverge here.
  (Landed this session as the parity-runner `kind:'http'` opt-in mode + two cases,
  commit 8fe16b8.)

## Reversibility

IRREVERSIBLE (reversibility rule 1 — the alternative B/C adds cross-package public
API). Option A itself is reversible; the CHOICE between A and B/C is the load-bearing
fork. Ratified because: Spike B shows Effect needs nothing beyond standard Node
shapes plus the listen widen; A commits to the cheapest-to-live-with negative; all
concrete widenings are additive/reversible. ADRs are immutable after merge; if a
future consumer genuinely requires an Effect-coupled adapter export, a superseding
ADR is written.

## Risks / follow-ups

- `@effect/platform-node` beta drift: the `internal/httpServer.ts` behaviour (parks
  on `'drain'`, ignores `write()` return) is beta-version-sensitive; pin the version
  in the integration fixture (T6).
- The pipe-sink/`Readable.fromWeb` gap is the documented compat ceiling; register it
  with an owning ticket (review minor).
- WS/SSE upgrade (`assignSocket`/`server.on('upgrade')`) is HARD-blocker-adjacent and
  owned by feature 07; T5 negative-locks that this feature does not silently swallow
  an upgrade into the buffered path (commit faaaf8f).

## References

- ADR-0017 (`@rifty/net` scope + streaming deferral); ADR-0034 (io boolean-only
  write — the contract the deferred pipe-sink would diverge from); ADR-0040 (SW
  frame/routing versions); ADR-0048 (preview-port frame).
- decisions.md draft ADR-0057; feature-05-effect-http-bridge.md (Q-101..Q-104,
  T1-T6).
- Spike B result (Effect-shaped node:http consumption over the port registry,
  2026-05-30).
- Q-2026-05-30-107 (listen overload), -108 (drain), -109 (pipe-sink DEFERRED).
