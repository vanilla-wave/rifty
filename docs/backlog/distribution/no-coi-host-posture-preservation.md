---
area: distribution
status: ready
title: no-COI host document posture stays unchanged through install and build
created: 2026-09-02
epic: no-coi-sandbox-tier
why: the headerless host, opener and cross-origin image stay live, but the image carrier does not prove request credentials or absence of CORS/CORP substitution
user_story: As an existing app, I want sandbox install and build to preserve my exact host document, opener and ordinary credentialed cross-origin subresources
sources: [docs/backlog/distribution/reference/sw-coi-shim-probe.md, docs/backlog/distribution/reference/no-coi-sandbox-build-loop-evidence.md]
code: [apps/playground/no-coi-harness.html, apps/playground/vite.no-coi.config.ts, playwright.no-coi.config.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Goal I9 rejects the cheaper SW-delivered COI route because it changes policy
for and reloads the whole adopter document. Certified admission, lifecycle,
install and build now let one Chromium carrier observe that document before,
during and after real operations. This proof owns no sandbox mechanism.

The existing carrier proves header absence, page identity, opener round-trips
and image decode. Image decode alone cannot distinguish original behavior from
COEP `credentialless`: that policy may still load a no-CORS image while
stripping its credential. The carrier must prove the second-origin request and
response, including a credential sentinel receipt.

## Challenge

challenge: 2026-09-02 — 1 problem
- A decoded cross-origin image does not prove unchanged ordinary subresource
  behavior: COEP `credentialless` can permit the load while removing cookies.

Disposition: answered by a second-origin server receipt that records Fetch
metadata and the exact sentinel cookie for every phase. Its image response has
no ACAO, CORP, COOP or COEP.

## User scenario

An existing headerless app opens one same-origin child document and boots the
public no-COI sandbox. Before boot, while install waits, while an installed bin
waits and after both complete, the same page stays non-isolated; its live
opener and ordinary credentialed no-CORS image continue unchanged.

## Reference contract

- Goal I9 forbids COOP/COEP, bootstrap reload and changed opener/subresource
  behavior on the host document.
- The SW-COI probe proves the rejected route becomes isolated only after a
  reload and applies COEP to the whole host.
- The current Chromium harness already exposes held real install/run network
  boundaries and stable host snapshots.

## Acceptance

1. The navigation response has no COOP/COEP. One page token, time origin,
   navigation entry/count and document identity remain exact before boot,
   during admitted install, during admitted build and after completion;
   `crossOriginIsolated===false` and SharedArrayBuffer stays absent. → I9
2. The same live `window.opener` message round-trip succeeds in every phase;
   no bootstrap reload replaces the document. → I9
3. A second loopback origin seeds a cookie sentinel, then records each image
   request as credentialed `no-cors`. Its image response has no ACAO, CORP,
   COOP or COEP; the exact sentinel receipt and image decode pass in every
   phase. Credential stripping, policy headers or same-origin substitution
   fail. → I9
4. Host checks complete while install and run-bin are genuinely admitted at
   held network boundaries; release then completes the original operations.
   → I9, scenario
5. The committed no-COI Chromium lane runs this public SDK proof against real
   headerless servers; no route-intercepted policy simulation. → I8, I9

## Parity cases

1. Entry→install→build→after: exact page identity and non-COI/SAB state stay
   unchanged. Artifact: focused no-COI Chromium carrier. → I9
2. One live opener identity and round-trip survive every phase without reload.
   Artifact: focused no-COI Chromium carrier. → I9
3. Server receipt proves second-origin, credentialed `no-cors` requests and
   response-header absence before/during/after. Artifact: focused no-COI
   Chromium carrier. → I9
4. A SW-delivered COI/reloaded host would change isolation, time origin,
   opener or credential receipt and fail the carrier. Artifact: rejected-route
   record plus focused carrier. → I9

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` × host/subresource | raw navigation plus second-origin request/response and cookie receipt exclude policy substitution | header/Cookie/Sec-Fetch assertions in focused Chromium → I9 |
| `observable-order` × install/build | every host check finishes while its operation remains admitted, then release completes it | held-route timeline in focused Chromium → I9, scenario |
| `sibling-drift` × phases | one page/opener/subresource contract holds before, during and after | four-phase snapshot/receipt matrix → I9 |

## Out of scope

- No sandbox admission, install, build or lifecycle implementation; certified
  predecessors own them.
- No Vite-dependent infrastructure; the held bin is only a proof fixture.
- No dev/HMR, restart/death event or pending-write marker; the next child owns
  them.
- No SW-delivered COI, heartbeat, journal, retry/reconnect or crash durability.

## Decisions

review: ordinary — proof-only
re-cut: 2026-09-04 — compiled the I9-only carrier and removed predecessor checkpoint history — trace: none
- 2026-09-04 — expected RED band 3–4: credential stripping, injected policy headers, same-origin substitution and checks outside admitted boundaries.
