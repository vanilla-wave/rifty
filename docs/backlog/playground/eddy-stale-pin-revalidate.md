---
area: playground
status: ready
title: Learned pins serve-stale-while-revalidate inside a hard 24h bound
created: 2026-07-10
why: the learned pin hard-expires at 30 min, so a returning user re-pays a foreground POST (~1–2.7s) to usually rediscover the same closure — while the content-addressed pinned GET stays valid indefinitely (proven live, byte-stable)
user_story: As a developer returning to a project after >30 min, I want `npm install` to reuse the proven bundle instantly and refresh resolution in the background, but today the pin is dropped and install re-resolves in the foreground.
epic: install-tail-latency
blocked_by: []
sources: [docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md, docs/adr/npm-client/0195-eddy-wire-protocol-v1-1-get-by-hash-cors-simple-post-streaming-client-prefetch-seam.md]
code: [apps/playground/src/glue/eddy-learned-pins.ts, apps/playground/src/glue/install-prefetch.ts, packages/npm-client/src/eddy-bundle-stream.ts]
---

## Context

`eddy-learned-pins.ts` drops pins at `LEARNED_PIN_TTL_MS` = 1800s (hardcoded,
aligned to eddy's default mutable-tier TTL). Beyond it, install falls back to a
foreground POST even though the pinned GET is immutable, browser-HTTP-cached,
and content-address-verified. Precedent already accepted in-tree: env pins
(`VITE_RIFTY_EDDY_PINS`, ADR-0195 §5) serve a deploy-time resolution
indefinitely — a bounded stale window for learned pins is strictly more
conservative. No wire-protocol change: the revalidate is a plain POST whose
body is read only up to the manifest (first tar member) then cancelled —
`streamTarEntries` early-abort already exists and is tested.

## Acceptance

- Pin age ≤ 1800s: unchanged (pinned GET, no revalidate).
- 1800s < age ≤ 24h (`STALE_PIN_MAX_AGE_MS` constant beside
  `LEARNED_PIN_TTL_MS`): install AND boot prefetch use the pinned GET; the
  terminal prints one line `npm: eddy cached resolution (as-of <resolvedAt>),
  refreshing in background` where `resolvedAt` comes from the served bundle
  manifest `asOf` (not pin `savedAt`); after install completes, a background
  POST revalidate reads ONLY the manifest member (bounded, early-cancel — no
  full-bundle download), compares `closureHash`: identical → refresh `savedAt`;
  different → `writeLearnedPin` with the new hash. Test: two installs, the
  second observes the updated pin.
- Pin age > 24h: pin dropped, foreground POST exactly as today.
- `prefer: 'online'` still bypasses pin + prefetch entirely (assert preserved).
- RED-check: reverting stale-serve makes the 31-min-old-pin test observe a
  foreground POST.

## Parity cases

The one deliberate deviation from real npm is recorded here, bounded, and
loud: a fresh no-lockfile `npm install` on Node resolves against the registry
now; this item serves a ≤24h-stale resolution with an explicit `as-of` line, a
converging background refresh, and the `prefer:'online'` escape hatch. No
other Node-observable change: tarball integrity, coverage, and closure-hash
gates are untouched.

## Fault matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Stale pinned GET 404 / store miss (revoked, evicted) | existing fallback: foreground POST, pin replaced on learn | unit assert on 404 path |
| Revalidate POST network failure / stall | bounded by the ADR-0201 chokepoint; pin untouched; one async warning; retried on next install | unit with failing fetch |
| Revalidate returns a typed decline (422) | pin kept (bundle stays content-valid); warning; next install retries | unit |
| Tab closed mid-revalidate | pin file intact (existing atomic write path); no partial JSON | unit |
| Concurrent installs, same requestKey | last-writer-wins on the pin file; both installs correct | extend learned-pin two-project loop test |
| Revalidate finds a new hash while the old bundle sits in browser HTTP cache | old cached response simply never requested again (pin points elsewhere); no purge needed | recorded, no test |

## Out of scope

- Env knobs for the fresh/stale windows — policy constants only.
- Any eddy wire-protocol change (no headers-only resolve endpoint).
- Background prefetch of the NEW bundle after a revalidate mismatch — the next
  install fetches it.
- SWR for env pins (`VITE_RIFTY_EDDY_PINS`) — deploy-time refresh stays their
  mechanism.
- Client-side packument re-checks (would reintroduce the metadata waterfall).

## Decisions

- Stale window = 24h — user-approved 2026-07-10 (epic `install-tail-latency`);
  bounds the unpublish/security-pull exposure the window extends (safety net:
  `distribution/eddy-bundle-revocation-runbook`).
- Revalidate mechanism = background POST + manifest-member early-cancel; hash
  compare only, no extraction. REVERSIBLE policy + client glue → CHANGELOG at
  implementation, no ADR (ADR-0194 §8 learned-pin contract is extended, not
  contradicted).
- Honesty-line exact wording finalized at implementation (wording only, the
  `as-of` + background-refresh content is contractual).
