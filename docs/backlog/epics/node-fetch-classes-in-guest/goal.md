---
kind: epic
status: ready
title: Node's own JS Fetch classes in the guest — Request/Response/Headers/FormData behave and live as in Node
created: 2026-10-16
value: A Node program in rifty gets Node's Fetch classes (undici, pure JS, as Node ships them) instead of Chromium's native ones, so headers, body reads, clones and process lifetime match Node, and the host boundary shrinks to real I/O (network, Blob reads).
user_story: As a developer running Node code that builds `Request`/`Response`/`FormData` (Hono/route-handler tests, HTTP clients, multipart uploads), I want the same headers, bodies and exit behavior as Node 24, but today the guest gets Chromium's native classes, which drop headers Node keeps and read bodies on host tasks rifty cannot see
tier: works
---

## Outcome

Guest `Request`, `Response`, `Headers`, `FormData` use Node's JS Fetch classes.
Headers, body consumption, clone/tee and multipart behave as in Node 24;
pending real I/O holds the process, pending guest work alone does not.
`fetch` accepts these requests and returns these responses over the current
browser transport. Unsupported network semantics reject explicitly instead
of silently changing a request. No new server transport.

## Evidence (2026-10-16, branch `t3/honest-adaptations-location`)

- Node 24.16.0: `Request.toString()` → `class _Request …` (undici JS);
  `new Request(url, {headers: {cookie: 'a=1', host: 'h'}})` keeps both;
  Chromium 148 dedicated worker: `cookie`/`host` → `null` (forbidden request
  headers) — an undeclared divergence today.
- Host-task counts in Chromium (MessageChannel ping): every Body consumer ≥1,
  `Response.json({a:1}).clone().json()` 15, 16 MiB `clone().text()` ~2k,
  JS-sourced stream `tee()` 0. ADR-0529 §4 gaps (native-internal body reads)
  exist only because the classes are native.
- ADR-0158 fetch keepalive replaces the `body` getter and installs own-property
  consumers on fetch Responses — the lock-split class ADR-0529 review rounds
  rejected (`runtime-js/fetch-keepalive-response-clone-lifecycle`).

## User scenario

A real Hono app handles `app.request('/x', {method: 'POST', headers: {cookie:
'a=1'}, body: form})`, reads the File and returns JSON. The test prints the
same headers, body and exit result as Node 24. A multipart network upload and
fetched-response clones use the same classes. Explicit network Cookie fails
with a named unsupported error (user-approved browser boundary).
Run-to-completion programs read cloned string/Blob bodies, Request multipart
bodies and guest-stream bodies; completed reads print, a never-resolving guest
source does not hold the process. Direct stream readers and Body methods share
locking/disturbance state; consumed bodies cannot be consumed or cloned again.

## Invariants

<!-- Current-main failures: Chromium strips Cookie at Request construction;
ADR-0529 §4 lists native clone/multipart/guest-stream lifecycle gaps;
ADR-0158 fetch wrapper splits public and internal body locks. Carrier records RED. -->

- I1. Hono in-process requests preserve Node headers and multipart/File contents, with Node's four Fetch class identities and observable construction/conversion behavior.
- I2. Body methods, direct readers, clone/tee and Request copies share Node's locking/disturbance behavior and process lifetime, including ADR-0529 §4 body gaps.
- I3. Browser-backed fetch accepts the JS Request/FormData and returns the JS Response, preserving supported response metadata, upload bytes, abort/error behavior and one body state; unsupported request semantics fail explicitly.

## Challenge

challenge: 2026-10-20 — clear

Fresh critic: «1 scope fork; направление обосновано». Executed Node 24.16.0 /
Chromium 148 loopback probe: Node sends explicit Cookie, Chromium drops it.
User chose classes/bodies plus explicit browser-network ceilings; no proxy.
Native wrappers cannot preserve Request headers or own native body lifetime.

## Decisions

- 2026-10-16 — user: «ок» on the proposal «Завести отдельную цель „JS-классы
  fetch из Node в госте"» (session on PR #374); seeded `draft`, FIT pending.
- 2026-10-20 — user authorized implementation in one PR; parity prioritized, bundle growth measured without a new limit; WebSocket/EventSource excluded.
- 2026-10-20 — user: «Да, этот вариант» to Node classes/bodies, current browser transport, explicit unsupported errors where request semantics cannot be preserved.
- 2026-10-20 — tier works: accepted program parity; transport faults reject honestly, no server/crash-persistence obligation.
- 2026-10-20 — fresh FIT written-result check PASS; header-conversion trace corrected to I1. RED: `RIFTY_PLAYGROUND_PORT=5387 pnpm test:browser-unit node-fetch-guest.spec.ts` (Node 24.16.0): Hono loses Cookie, clone-direct-stream prints nothing, fetched reader lock bypassed; committed expected-failure carrier.
- rejected route: further wrappers around Chromium Request/Response — violates I1 header retention and I2 native-internal body lifetime.
