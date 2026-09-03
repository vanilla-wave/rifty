---
area: distribution
status: draft
title: no-COI host document posture preservation across the sandbox loop
created: 2026-09-02
epic: no-coi-sandbox-tier
blocked_by: [distribution/no-coi-toolchain-operation-lifecycle, distribution/no-coi-sandbox-package-install, distribution/no-coi-sandbox-build-loop]
why: the headerless host controls stay green, but Final review found that the cross-origin image did not prove its request mode or response lacked CORS/CORP, so the test could not certify the existing app's unchanged subresource posture
user_story: As an existing app that cannot change its security posture, I want sandbox install and build to leave my same document, opener and ordinary cross-origin no-CORS/no-CORP subresources unchanged from entry through completion
sources: [docs/backlog/distribution/reference/sw-coi-shim-probe.md, distribution/no-coi-sandbox-build-loop]
code: [apps/playground/no-coi-harness.html, apps/playground/vite.no-coi.config.ts, playwright.no-coi.config.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop` at binding Final
stop `e5347179f`; the predecessor preserves its complete pre-demotion contract
and lineage. This child owns frozen goal I9 only. It consumes certified I1/I2/
I3 behavior to prove the host around the loop; it owns no sandbox operation or
build mechanism.

It owns one current HOLD: the image stayed visually loaded, but the carrier did
not assert browser request mode or server response provenance, so CORS/CORP
could silently make the test pass. Upstream: all build prerequisites through
`distribution/no-coi-sandbox-build-loop`. Downstream:
`distribution/no-coi-dev-hmr-restore`.

Vite 7 may drive the finished build only as the I3 proof fixture. The host
server, SDK and infrastructure contract cannot branch on Vite identity,
version, path, callback, type or lifecycle.

## Challenge

challenge: 2026-09-02 — 1 problems
- Acceptance 3’s added provenance does not prove the I9 behavior the cited rejected route changes: COEP `credentialless` still permits a cross-origin `mode:no-cors` image without ACAO/CORP to decode, while stripping request credentials. Without a credential sentinel and receipt assertion, the carrier can pass despite changed ordinary subresource behavior.

Disposition: answered. The second-origin fixture now requires a credential
sentinel whose receipt is proven in the entry baseline and every operation
phase. COEP `credentialless` would omit it and fail even if the image decodes.

## User scenario

An existing same-origin app opens its ordinary headerless child page and boots
the public no-COI sandbox. Before boot, while a real install waits, while an
installed-bin build waits and after completion, the exact same page remains
non-isolated. Its opener round-trip and a second-origin image requested in
ordinary no-CORS mode from a response with no CORS/CORP continue to work
with the same credential receipt, without bootstrap reload or policy mutation.

## Reference contract

- Goal I9 forbids any COOP/COEP on the host document and any bootstrap reload;
  `window.opener` and cross-origin subresource behavior remain unchanged.
- The SW-COI probe proves the rejected route works only by applying policy to
  and reloading the whole host; this child must distinguish that route.
- The shared lifecycle supplies held admitted install/run boundaries; I2/I3
  supply the real loop. This child observes around them only.
- Final review at `c2b13d0f3` found one provenance gap: image load alone does
  not prove `mode:no-cors` plus absence of response CORS/CORP.

## Acceptance

1. The real navigation response carries no
   `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`. One page token,
   `performance.timeOrigin`, navigation entry and navigation count remain
   exact before boot, during admitted install, during admitted installed-bin
   build and after completion; `crossOriginIsolated===false` and
   `typeof SharedArrayBuffer==='undefined'` at every sample.
2. A live same-origin `window.opener` message round-trip succeeds in every
   phase. No sandbox or proof harness bootstrap reload replaces the document.
3. A second loopback origin establishes an ordinary credential sentinel, then
   records the image request's Fetch metadata/mode discriminator and exact
   sentinel receipt. It returns the image without
   `Access-Control-Allow-Origin`, `Cross-Origin-Resource-Policy`, COOP or COEP.
   The test asserts raw request/response provenance, credential receipt and
   successful image decode before/during/after. COEP `credentialless`, a
   CORS/CORP-enabled substitute or a same-origin resource fails.
4. Opener and image checks complete while install and run-bin are genuinely
   admitted at held real network boundaries; release then completes the
   originals. Busy rejection is only the certified admission sentinel and is
   not this child's mechanism.
5. The committed no-COI Chromium lane and CI job run this public SDK proof on a
   real headerless server, never route-intercept simulated headers. The proof
   may consume Vite 7 build output from I3 only as fixture evidence.

## Parity cases

1. Entry→install→build→after timeline: exact page token/time origin/navigation
   and non-COI/SAB state remain unchanged around held admitted operations.
2. Opener preservation: same live opener identity and message round-trip in
   each phase, with no reload.
3. Cross-origin subresource provenance: observed request metadata, credential
   sentinel receipt and raw response headers prove ordinary credentialed
   no-CORS/no-CORP behavior, then image decode succeeds; credential stripping,
   injected ACAO/CORP or a same-origin resource fails the carrier.
4. Rejected-route discriminator: a SW-delivered COI/reloaded document would
   change isolation/time-origin/opener or response policy and fail exact state.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` × host response/subresource | raw navigation and second-origin request/response plus credential receipt prove no COOP/COEP/credentialless/CORS/CORP substitute | Acceptance/Parity 1,3/1,3; server-side observation + headers |
| `observable-order` × install/build lifecycle | host controls complete while each operation is admitted, then originals complete after release | Acceptance/Parity 1,4/1; held-boundary timeline |
| `sibling-drift` + `frozen-assumption` × host phases | one exact page identity/opener/subresource contract before, during and after | Acceptance/Parity 1-4/1-2; continuous sampling |

## Out of scope

- No SDK admission/report, Worker/VFS/runtime topology, install, operation
  lifecycle or build implementation; upstream children own them.
- No product/infrastructure dependency on Vite identity, version, path,
  callback, type or lifecycle. Vite 7 is only an already-certified proof
  fixture; Vite 8 is irrelevant here.
- No SW-delivered COI, host-header mutation, bootstrap reload or from-scratch
  site mode; that route is rejected by goal I9.
- No third-party iframe without own origin.
- No dev/HMR, restart/death or pending-write behavior.
- No heartbeat, journal, reconnect/retry, exactly-once recovery, hidden queue
  or crash durability.

## Decisions

review: checkpoints — browser/network host-posture proof for I9.

predecessor: `distribution/no-coi-sandbox-build-loop`

- Owns Final HOLD: no-CORS/no-CORP image request/response provenance.
- Dependency direction: admission → lifecycle → install → build → this host
  proof; dev-HMR remains blocked downstream.
- Fresh challenge strengthened provenance with a credential sentinel/receipt;
  image decode alone cannot exclude COEP `credentialless`.
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `ready-verdict: 2026-09-01 — Contract+RED @ ead27000f`
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Bounded-cause split successor certified Final+GREEN at `40ded4758`.
- `ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d`
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Descriptor split successor certified Final+GREEN at `dce86792d`.
- `contract-red: 2026-09-02 — blocker @ 41d63c086`
- `ready-verdict: 2026-09-02 — Contract+RED @ 15dbca164`
- `final-green: 2026-09-02 — blocker @ c2b13d0f3`
- Count lineage: `07d370651`/`bcff49986`/`541c4cd6c` counts are unavailable;
  counted Final rounds are `1@a909a38a9 → 1@6f86d2e7f` (stop, bounded child
  PASS), `1@01465c6ae` (carried stop, descriptor child PASS), then
  `15@c2b13d0f3`; latest `1→15` fired convergence. Contract continuation was
  `1@41d63c086 → PASS@15dbca164`.
- Binding stop is recorded at `e5347179f`. Its PR-body band HOLD was already
  fixed in draft PR 294 and is excluded from this child's one current HOLD.
