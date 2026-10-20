# ADR 0541: Run Node Fetch classes over the browser I/O boundary

Status: Accepted
Date: 2026-10

> TL;DR: Node 24's undici classes own guest Fetch bodies; native fetch and Blob reads own real I/O. Browser transport ceilings reject explicitly.

## Context

Node 24.16.0 embeds undici 7.25.0. Chromium Request drops Cookie/Host at
construction; native cloned bodies settle on tasks invisible to the guest
loop. ADR-0158's separate public body stream does not share native consumer
locks. RED: `tests/browser-unit/node-fetch-guest.spec.ts`, real Hono 4.13.13,
same programs against live Node and the actual Chromium child.

User chose classes/bodies plus the existing browser transport, explicit
unsupported request errors, no server transport, measured bundle growth with
no new limit. Node sends explicit Cookie; Chromium cannot.

## Decision

1. Pin undici 7.25.0 as a build dependency. Generate the Request/Response/
   Headers/FormData graph, license and source hashes; no Agent/socket graph,
   runtime eval or guest package rewriting. The generator checks exact edit
   anchors; `check:fetch-classes-drift` checks committed output. Node 24.16.0 is
   the differential oracle. Portability edits bind private primitives below;
   record conversion, multipart encoding, Body methods and clone remain upstream.
   The lowercase PATCH warning routes to the active process; `emitWarning`
   implements Node's overloads, validation, nextTick event and default stderr
   sink. Warning-file output remains a named ceiling in the existing
   `runtime-js/process-module-loader-surface` draft.
   Socket-only helper imports resolve lazily when used, so class bootstrap
   does not require network builtin registration (ADR-0035 unchanged).
2. Private `isProxy` needs actual Proxy identity: Node's HeadersInit fast path
   even includes nonenumerable plain-object properties, but skips them on a
   Proxy. Track constructor/revocable products before guest entry; VM membrane
   wrappers carry the original guest kind; host implementation wrappers share
   `runtimeProxy` instead of masquerading as guest-created proxies. The same tracker bootstrap runs in
   each QuickJS context, from a checked generated expression (not runtime
   Function#toString, which host transpilers rewrite). Do not claim general public `util.types.isProxy`
   support for arbitrary pre-bootstrap host objects.
3. Private stream disturbance reads Chromium's real bit through a captured
   native Response witness over the same stream. Construction neither reads
   nor locks it. Observe bodies and every public reader/lock/disturb entry
   before mutation, including reader constructors: guest-overridden `tee()`
   can return already locked branches. No inferred `bodyUsed` ledger. An
   internal byte controller's `desiredSize === null` is its errored state;
   finalization may cancel an errored stream and ignore its rejection.
   WebIDL USVString uses the existing file-URL well-formed-string conversion,
   implemented with ES2022 primitives; no newer String builtin is required.
4. `fetch` constructs the JS Request, rejects unsupported request headers or
   dispatchers, sends its encoded bytes through captured native fetch, then
   constructs the upstream Response from native status/URL/exposed headers and
   one JS byte stream. Credentials are omitted (Node has no ambient browser
   cookie jar); opaque responses fail explicitly. Browser CORS/header exposure
   remains a transport ceiling. Explicit Cookie/User-Agent and per-request or
   global dispatchers reject; Host is replaced from the URL by both Node and
   Chromium. Disable native HTTP caching: Node 24 always reaches the server,
   even for force-cache/only-if-cached. Browser-generated wire headers remain
   transport-owned. Empty referrer and same-browser-origin referrer URLs pass
   through; cross-origin caller referrers reject `fetch.referrer` unless their
   no-referrer policy already removes the header. HTTP/1 uploads are materialized because
   Chromium cannot send a streaming HTTP/1 request: buffered bodies retain
   their bytes; streaming-source uploads reject `fetch.streamingUpload` rather
   than silently losing duplex semantics. Keepalive bodies over the browser's
   64 KiB limit reject `fetch.keepalive`.
   Read the upstream private request state and body reader, not overridable
   public getters/Body methods. Abort settles even during upload preparation.
5. One ref from network dispatch to that stream's EOF/cancel/error; no own
   consumer methods or second body view. Bounded eager pulling admits small
   unread completed bodies; a backpressured unread body retains ADR-0158's
   documented drain-cap ceiling. Blob reads keep ADR-0529's exact host-I/O
   holds; pure JS bodies do not acquire a network ref. WebAssembly streaming
   retains its existing loud ceiling.
6. Install through the existing Fetch/web-global bootstrap before guest code,
   including standalone runtime and no-COI workers. Explicitly activate the
   existing builtin registry: production tree shaking drops implicit registration
   imported only through the registry re-export (production boot RED). `@riftydev/io` exposes
   `HOST_FETCH`/`fetchHost` for infrastructure resources: WASM/lib.d.ts assets,
   npm/eddy and owner resource requests retain native relative-URL semantics.
   `fetchNodeNetwork` preserves ADR-0181 native-compatible HTTP egress inputs
   separately from guest Fetch admission; both share one response/ref owner.
   No relative-URL exception
   is added to the guest Request constructor.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| isProxy, stream disturbance/error state | platform-gap; this ADR, live Node I1/I2 carriers | exact source anchors + source/output hashes + Node/Chromium differential tests | equivalent host private primitives available; otherwise permanent versioned runtime port |
| network source and Blob reads | handle-mapping; ADR-0152/0529/0541 | HTTP abort/clone/lifetime and Blob carriers | native Node I/O owner available |
| lazy socket-helper imports | substitution-environment; ADR-0035/0541 | generator anchors; classes bootstrap without net registration | upstream separates class graph from socket helpers |
| USVString conversion | substitution-environment; ADR-0469/0541 | same Node Unicode carrier and ES-floor gate | floor includes the upstream String builtins |

## Bootstrap regression

- Importing the class registry exposed timers' idle native-Node MessagePort:
  the QuickJS preload child printed success but never exited. Scheduler port
  references now follow its existing pending-immediate queue; browser refs
  still use ADR-0152. `timers-host-lifetime.fault.test.ts`: real Node comparison
  plus native port states; idle/pending/completed/cancelled guards each killed
  by a scratch revert probe. `install-process-gate.test.ts` restored GREEN.

## Superseded decisions

- ADR-0158 §1/§3: Node guest Responses no longer get per-instance Body methods
  or a second public stream; counting moves to the sole network source. Infra
  timer backstop and WebAssembly streaming ceiling remain.
- ADR-0529 §2 Request/Response native constructor/consumer holds and §4 native
  body-gap mechanism: JS bodies replace them. Blob, WebAssembly, crypto,
  WebSocket/BroadcastChannel and navigator.locks decisions remain.

## Independent challenge

- 2026-10-20 — critic supported the class-owner move; rejected pending-pull-only
  network counting (Node unread delayed response holds to EOF), found custom
  tee's pre-locked branch and physical-vs-semantic VM Proxy counterexamples.
  Response: keep one transport ref, observe before public stream operations,
  preserve original Proxy kind through the membrane; differential carriers.

## Consequences

- Hono headers/File bodies, clone/direct readers and detached body lifetime use
  one Node implementation; actual I/O remains observable to the drain.
- Generated port is versioned runtime code, not a claim of arbitrary undici
  package/network support. Source upgrades require fresh differential proof.
- Browser-only network restrictions remain explicit; no server deployment.
