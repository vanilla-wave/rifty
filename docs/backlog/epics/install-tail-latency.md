---
kind: epic
status: ready
title: Install tail latency — background durability, stale-pin instant replay
created: 2026-07-10
value: Repeat installs feel instant and `npm install` exit stops paying the OPFS durability tax — the measured non-network tail of the install path goes away without changing dependency fidelity.
user_story: As a developer returning to a rifty project (same tab, >30 min later or next day), I want `npm install` to complete near-instantly from the already-proven bundle and the dev server to start without waiting on durability flushes, but today the learned pin is hard-dropped at 30 min (foreground POST re-resolve) and install exit blocks on the full OPFS drain.
items: [playground/install-stamp-background-flush, playground/eddy-stale-pin-revalidate, distribution/eddy-bundle-revocation-runbook]
---

## Outcome

Eddy's network path is structurally done (pinned GET + prefetch + CDN + browser
HTTP cache; production headline 1.88x, ADR-0182). What remains on the install
critical path is client-side tail, profiled 2026-07-01..05: client extraction
~77ms, POST round-trip ~1060ms (ADR-0195 context), OPFS durability drain ~490ms
awaited before install exit, and a hardcoded 30-min learned-pin TTL that
re-pays a foreground POST (~1–2.7s) to usually rediscover the same closure.

Two client levers plus one operator safety net:

- install exit stops awaiting the durability drain (order + stamp semantics of
  ADR-0187 Corrected intact, just backgrounded) — fidelity-aligned: real
  `npm install` exit does not fsync `node_modules` either;
- learned pins serve-stale-while-revalidate inside a hard 24h bound with a loud
  `as-of` line — content-addressed GETs stay valid indefinitely (proven live:
  byte-stable artifact re-served next day);
- a verified bundle revocation runbook bounds the ecosystem exposure the stale
  window extends (npm unpublish/malware pulls vs immutable store + CDN).

Deviations are explicit, bounded, converging — never silent.

## User scenario

A developer opens the Express preset (or writes `package.json` with
`express@^4` + `eslint@^9`), runs `npm install` → eddy pinned GET installs it.
They return after 30+ minutes (or reload next day) and run `npm install` again:
it completes at replay speed from the learned pin, prints
`eddy cached resolution (as-of <ISO>), refreshing in background`, and a
background revalidate updates the pin. `vite` (chained or run next) starts
without waiting for the OPFS drain. Closing the tab before the background drain
finishes only costs a re-install on next boot — never a torn stamped tree. If
the operator revokes a bundle, pinned clients fall back to POST and re-seed a
fresh resolve.

## Items

- `playground/install-stamp-background-flush` — take the drain→gate→stamp→drain
  sequence off the install exit path; sequence and stamp honesty unchanged.
- `playground/eddy-stale-pin-revalidate` — serve stale learned pins (≤24h) via
  pinned GET + background manifest-only POST revalidate; hard-expire beyond.
- `distribution/eddy-bundle-revocation-runbook` — documented + verified
  operator path: object delete + CDN purge + fallback proof.

## Out of scope

- Cold-origin resolve floor work — declined for now: post upstream-flip it hits
  only the first user per novel dep-set per TTL; S3 immutable tier + pins
  absorb the rest. Reopen only with fresh end-to-end profiling.
- h2/h3 transport matrix — stays owned by `perf/eddy-http3-cold-validation`
  (epic `fast-install-resolver`).
- Any eddy wire-protocol change (no headers-only resolve endpoint).
