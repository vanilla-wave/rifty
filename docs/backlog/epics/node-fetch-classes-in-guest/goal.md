---
kind: epic
status: draft
title: Node's own JS Fetch classes in the guest — Request/Response/Headers/FormData behave and live as in Node
created: 2026-10-16
value: A Node program in rifty gets Node's Fetch classes (undici, pure JS, as Node ships them) instead of Chromium's native ones, so headers, body reads, clones and process lifetime match Node, and the host boundary shrinks to real I/O (network, Blob reads).
user_story: As a developer running Node code that builds `Request`/`Response`/`FormData` (Hono/route-handler tests, HTTP clients, multipart uploads), I want the same headers, bodies and exit behavior as Node 24, but today the guest gets Chromium's native classes, which drop headers Node keeps and read bodies on host tasks rifty cannot see
---

## Outcome

Open — owner: user (FIT pending). Sketch: the guest-facing `Request`,
`Response`, `Headers`, `FormData` (and the `fetch` front) are Node's own JS
implementation; only real I/O crosses to the host — network dispatch over the
native `fetch` with the body delivered through a JS stream whose pull holds the
loop, and Blob reads (held promises, ADR-0529). Clone/tee/multipart encoding
become JS, so no hold has to emulate a native stream.

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

Sketch, unratified: a Hono app's `app.request('/x', {method: 'POST', body: form})`
test, a `fetch` with `cookie` header and a multipart upload print the same rows
and exit as Node 24; ADR-0529 §4's native-internal body gap rows pass held.

## Decisions

- 2026-10-16 — user: «ок» on the proposal «Завести отдельную цель „JS-классы
  fetch из Node в госте"» (session on PR #374); seeded `draft`, FIT pending.
