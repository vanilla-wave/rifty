---
area: runtime-js
status: ready
title: A run-to-completion child stays alive while a host-task-async Node API request is pending (Blob, fs.openAsBlob, WebAssembly.compile, crypto.subtle), as Node's loop does
created: 2026-10-15
why: ADR-0152 §1 counts a named handle set; Node-surface APIs whose settlement is a host task (not a microtask) hold no ref, so a program whose last work is one of them is reaped at refCount 0 and its result is silently dropped — no stderr, exit 0 — where Node prints it
user_story: As a Node program whose last work after top-level is `await blob.arrayBuffer()`, `WebAssembly.compile(bytes)`, `fs.openAsBlob(p)` or `crypto.subtle.deriveBits(...)`, I want the process to live until it settles like Node 24, but today rifty's drain reaps the realm before the promise resolves and nothing is printed
epic: honest-guest-package-adaptations
blocked_by: []
sources: [ADR-0529, ADR-0152, ADR-0158, ADR-0446, ADR-0447, ADR-0378, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [packages/runtime-js/src/builtins/host-async-keepalive.ts, packages/workbench/src/workers/kernel-worker-entry.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts]
---

## Context

Finding (observed on `9645c62bf`, Chromium 148 via Playwright, oracle Node
v24.16.0; commands + verbatim output:
`reference/guest-package-patches-refine-evidence-2026-10-15.md` §Probe 2/3).
Terminal `node -e "<line>"`, one pending carrier after top-level:

| carrier | Node 24.16.0 | rifty |
|---|---|---|
| `buffer.Blob#arrayBuffer` 64 MiB | `BDONE 67108864` | silent exit |
| `WebAssembly.compile` 6 M-nop module | `WDONE 0` | silent exit |
| `fs.openAsBlob().arrayBuffer()` 32 MiB | `ODONE 33554432` | silent exit |
| `crypto.subtle.deriveBits` PBKDF2 3 M iter | `PDONE 32` | silent exit |
| control: Blob + `setTimeout(()=>{},8000)` | — | `BDONE_HELD 67108864` |

The control proves the promise settles when a counted handle holds the loop:
the four rows are drain reaps (`awaitDrain` two-sample idle, ADR-0445 rule 7),
not rejections. `zlib.gzip` (CompressionStream) and one `crypto.subtle.digest`
passed on timing only — neither `zlib.ts`, `buffer.ts` (host `g.Blob`) nor
crypto references `event-loop-keepalive` (consumer grep in the evidence file).

Mechanism: in rifty an async builtin settles either on a microtask over sync
RPC (`fs.promises`: `fs.ts` `promises` :1146 / callback twins :1239-1545,
`Promise.resolve().then(sync)` — needs no handle, the drain's first sample is
a macrotask) or on a host task
(Blob reads, WebAssembly compilation, WebCrypto, CompressionStream, Response
bodies). In libuv terms the second kind is a threadpool/platform request Node
counts as active. ADR-0152 §1 lists it under "other libuv handle classes NOT
counted" and requires an extending ADR; precedents add one handle class each:
ADR-0158 (global `fetch`, held to body consumption), ADR-0446 (Worker),
ADR-0447 (referenced MessagePort). ADR-0378's declined realm-wide async-source
census is not this: per-class refs through the existing `ref()/unref()`
chokepoint, no census.

Boundary (user 2026-10-15: «окей, давай как рекомендовал Node-поверхность»):
carriers that exist on Node's own surface — `buffer.Blob`/`File` body reads,
`fs.openAsBlob`, `WebAssembly.compile` / `instantiate(bytes)`,
`crypto.subtle.*`, `node:zlib` one-shot and stream operations over
CompressionStream/DecompressionStream, in-guest `Response` / `Request` body
consumers, and the Node ≥22 global `WebSocket` (a Node program with an open
socket lives; rifty's behavior to probe at pickup) — are in scope; ~8-10
wrappers on the one `ref()/unref()` seam. `EventSource` is NOT a default
Node 24 global (`node -e "console.log(typeof WebSocket, typeof EventSource)"`
→ `function undefined` on v24.16.0; a function only under
`--experimental-eventsource`) — outside the Node-surface boundary. Browser-only APIs a Node program
cannot call (`indexedDB`, `caches`, `navigator.locks`, `scheduler`) stay out.
A carrier whose release rifty cannot observe: refuse by name (ADR-0447
pattern) or hold to the loud ADR-0152 §4 cap — decided in the pickup ADR
(goal §Decisions). Full carrier sweep at pickup (class-kill
inventory: one keepalive chokepoint, every host-async builtin names its
ref/unref pair).

`docs/backlog/runtime-js/keepalive-residual-gaps.md` claimed "No behavioral
gap remains"; corrected 2026-10-15 to point here.

Dedup: `keepalive-residual-gaps` (same ADR-0152 §1 set, different residual);
`fetch-keepalive-response-clone-lifecycle` (fetch-tracked Response clone —
separate); no declined match.

## Challenge

challenge: 2026-10-15 — clear (goal premise, `epics/honest-guest-package-adaptations` §Challenge)

## Acceptance

Carrier: `tests/browser-unit/host-async-keepalive.spec.ts`, each case run
verbatim by live Node (`process.execPath`, v24.16.0 at pickup) and by rifty
`node <case>.cjs`; rows, exit code and no-timeout must match.

1. `buffer.Blob#arrayBuffer` 64 MiB, `Blob#text`, `Blob#bytes`, `Blob#stream`
   reads and `File#text` print their DONE row and exit 0 → I1, scenario 1
2. `fs.openAsBlob(p).then(b => b.arrayBuffer())` prints its row → I1, scenario 1
3. `WebAssembly.compile` and `WebAssembly.instantiate(bytes)` of a 6 M-nop
   module print their rows; a rejecting compile releases (exit 0) → I1, scenario 1
4. `require('node:crypto').subtle.deriveBits` PBKDF2 3 M iterations and a
   200-step `globalThis.crypto.subtle.digest` chain print their rows → I1, scenario 1
5. In-guest `new Response(blob).arrayBuffer()` and `new Request(url, {body: blob}).text()`
   print their rows; a guest-stream body with a pending read holds nothing
   (exit 0 at once, as Node) → I1
6. `zlib.gzip` 64 MiB and a `createGzip` stream print their rows → I1
7. A global `WebSocket` to a live server prints open/message/close rows → I1
8. `Response`/`Request`/`WebSocket` keep `X.prototype.constructor === X`,
   `instanceof`, and the wrapped functions keep Node's names → ADR-0529

## Out of scope

- Browser-only async APIs (`indexedDB`, `caches`, `navigator.locks`,
  `scheduler.postTask`) — not Node surface; no keepalive claim.
- `WebAssembly.compileStreaming` / `instantiateStreaming` — already a loud
  `NotImplementedError` ceiling (ADR-0158 correction).
- ADR-0152 §4 drain cap — unchanged.

## Decisions

- 2026-10-16 — pickup: RED on `aebdd7ddd` (Chromium 148): rows 1-5 and 7 fail
  (`HA|top` only, silent exit 0), rows 6 and the digest chain of row 4 pass
  unheld; ADR-0529 records the counted classes; zlib stays uncounted
  (microtask-settled, Chromium CompressionStream transforms synchronously).
- 2026-10-16 — refuse-by-name vs hold-to-cap: every counted class has an
  observable release (settle / `close`), so none is refused; a never-settling
  one holds to the loud ADR-0152 §4 cap (ADR-0529 §5).
- 2026-10-15 — route: observed defect with a real-Node baseline (RDY-8); the
  carrier set extends ADR-0152 §1 → ADR at pickup naming the added classes
  (DEC-1 p4), precedent ADR-0158/0446/0447.
- 2026-10-15 — minimal pattern first: one carrier class (`buffer.Blob` body
  reads) lands with the mechanism, then the remaining classes on the same seam.
- 2026-10-15 — user: «окей, давай как рекомендовал Node-поверхность» — boundary
  = Node-surface host-async carriers incl. global `WebSocket` (the
  recommendation also named `EventSource`; corrected by probe — not a default
  Node 24 global, excluded by the user's own criterion); rejected:
  minimum (4 probed + zlib) — leaves the class open; all host-async incl.
  browser-only APIs — no Node-program value, never-settling holds (ADR-0378).
