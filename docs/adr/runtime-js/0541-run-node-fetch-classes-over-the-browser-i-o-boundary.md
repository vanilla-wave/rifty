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
   internal byte controller's `desiredSize === null` is its errored state.
   For arbitrary unlocked streams, captured native reader `closed` Promise
   identity before/after `releaseLock()` distinguishes readable from terminal
   synchronously, without reading or disturbing. Terminal fulfillment means
   closed; rejection means errored. This follows the
   [Streams release algorithm](https://streams.spec.whatwg.org/#readable-stream-reader-generic-release).
   Finalization keeps Node's locked/disturbed guards, cancels readable/closed
   streams and skips errored streams; no inferred state ledger.
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
   A pre-aborted request rejects before transport admission and synchronously
   cancels a readable unstarted body, preserving Node's reason and user-cancel
   failures. Already locked bodies with native cancel stay untouched; a locked
   body with custom cancel rejects `fetch.abortBodyState` because its hidden
   state cannot be inspected without stealing the caller's reader. Aborting
   an active buffered upload leaves its reader running, as Node 24 does.
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

## Review correction (2026-10-20)

- Pre-aborted requests previously checked transport first and never cancelled
  the body. Live Node/Chromium RED: Cookie hid the abort reason; one pull instead
  of zero, no cancel. `node-fetch-guest.spec.ts` now compares readable, closed,
  errored, locked and throwing/rejecting custom-cancel states against Node.
- Cancelling an errored stream DOES set disturbed. Real fetched Responses plus
  GC (`node-fetch-finalization.spec.ts`) exposed retained `bodyUsed=true`
  against Node's false. One native-state probe serves abort and finalization.
- Active upload abort is not a defect: Node and Chromium guest both read all
  30 chunks with zero cancel callbacks. The permanent differential aborts on
  the fourth pull; adding reader cancellation would break this baseline.

- CI follow-up: `project-opening-progress.spec.ts` injects a real native-write
  barrier into the owner Worker. Its relative resource URL must use `fetchHost`
  after Node globals install; guest fetch correctly rejects that URL. Isolated
  RED on 9adc4a9a3; only the harness transport changes, all saving/UI assertions
  remain. That first sweep covered e2e/browser-unit, omitting no-COI.

- No-COI follow-up: console-eval native-flush barrier and admitted-run CLI also
  used relative URLs. Both reproduce RED on df58483c7; real Node 24 rejects
  both inputs before dispatch. Resolve URLs in the host page before embedding
  guest code; retain Node fetch, real network gates and all Stop/interactive
  assertions. Full `tests/` + product/tool source sweep: remaining relative
  fetch calls run in browser pages or standalone VFS workers; production
  browser resource I/O already uses `fetchHost`. No runtime exception added.

- Full CI audit also exposed early Fetch preload caching the fallback
  `node:process` before child bootstrap. Request classes need version/platform
  facts, not a cached builtin namespace: use existing `publicNodeProcess()`.
  Real IPC/Worker RED→GREEN plus a bootstrap identity regression guard; no new
  registry mechanism. Headers' old native-object IPC ceiling is superseded:
  all four JS Fetch classes round-trip own enumerable fields as live Node.
- WebAssembly ceiling carrier now uses real loopback HTTP headers plus an open
  body until reader cancellation. The old synthetic transport Response had no
  URL. All ten Response/PromiseLike ceiling and four priority/reflection
  assertions remain; production response metadata never gets a fake fallback.

## Consequences

- Hono headers/File bodies, clone/direct readers and detached body lifetime use
  one Node implementation; actual I/O remains observable to the drain.
- Generated port is versioned runtime code, not a claim of arbitrary undici
  package/network support. Source upgrades require fresh differential proof.
- Browser-only network restrictions remain explicit; no server deployment.

## Bundle measurement (2026-10-20)

Production `pnpm build:playground`, baseline carrier 2a6a30728 (no product
edits) versus the corrected implementation in this PR. Individual emitted JS assets, not
transitive download totals. Byte lengths; gzip uses Python `gzip.compress`
(level 9, mtime 0) on both builds. No new size limit. Kernel growth includes
explicit activation of the existing builtin registry, required by production
bootstrap; generated undici class output is 107 KB.

| Asset prefix | Before bytes | After bytes | Delta bytes | Before gzip | After gzip | Delta gzip |
|---|---:|---:|---:|---:|---:|---:|
| node-entry-bootstrap | 874375 | 878897 | +4522 | 263274 | 264818 | +1544 |
| quickjs-kernel-worker-host | 198549 | 664990 | +466441 | 56745 | 197660 | +140915 |
| workbench-owner-bootstrap | 1206219 | 1212112 | +5893 | 354672 | 356729 | +2057 |
| dev-server-child-bootstrap | 759804 | 764193 | +4389 | 230274 | 231704 | +1430 |
| ts-lsp-worker-entry | 3842025 | 3848134 | +6109 | 1095809 | 1097923 | +2114 |

Reproduce: match each prefix in `apps/playground/dist/assets/*.js`, read
its bytes and `len(gzip.compress(bytes, mtime=0))` on each revision.
