---
area: perf
subsystem: npm-client
status: draft
title: ADR-0088 — bounded-concurrency tarball fetch in npm install (placement walk stays serial + deterministic)
created: 2026-06-08
why: npm install fully serial — Σ of every packument+tarball RTT; biggest structural throughput lever; write-before-code
user_story: As a dev running a cold `npm install`, I want tarball fetches to overlap so wall-time isn't Σ of every packument+tarball RTT — but today `installer.ts` awaits each `visit` serially with no `Promise.all`, so I wait for one round-trip at a time.
sources: [perf-audit #24, adr-plan A/ADR-0088, ADR-0028, ADR-0042/0023 (downgraded), installer.test.ts:225/269-274]
---
## Context
installer.ts:296,309-345: serial `await visit`, no Promise.all. Governs internal concurrency of npm-client installer.ts. Public `install` signature unchanged. rule4 (semaphore util + walkAndPin restructure + tests; determinism-vs-throughput invariant). Cold live-resolve only; re-installs hit lockfile fast path; extractTarGz inflate/tar-parse serializes on main thread; prod ADR-0028 proxy not live-smoked → ceiling production-unverifiable.
## Options / Next
Zero-dep hand-rolled counting semaphore (new util file); parallelize ONLY fetchAndUnpackToCache; keep walkAndPin/choosePlacement serial + request-ordered (express-diamond first-wins, pinned by installer.test.ts:269-274/225 — NEVER edit the test). Reject "claim-flat-slot synchronous-before-await" — pin.version known only AFTER `await source.resolve`; must NOT hoist flat-slot decision before the await. Await all before link(). Measure against real registry path, not FakeRegistry; assert dedupe of concurrent same-(name,version) fetches.
## Reversibility
IRREVERSIBLE — rule4 (semaphore + restructure + tests). No new dep. Does not contradict ADR-0042/0023 (placement/cache, not fetch seriality). No decision subagent.
