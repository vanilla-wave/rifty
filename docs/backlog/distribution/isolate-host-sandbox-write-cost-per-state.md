---
area: distribution
status: draft
title: A sandbox host write costs one encoding of the whole state, not of the bytes it writes
created: 2026-11-23
why: Every writing host op measures the state cap by encoding the whole state (ADR-0568 §6), so a 1-byte `writeFile` near the cap costs as much as a run's state intake.
sources: [ADR-0568, packages/isolate-host/README.md, PR-419-external-review]
code: [packages/isolate-host/src/sandbox.ts]
---

## Context

Measured 2026-11-23 (M3 Pro, load ~10, README §Sandbox): one `writeFile` on a
16 MB state 19 ms, on 56 MB 69 ms, on the densest state the default cap admits
114 ms; 100 one-byte writes near the cap ~6.6 s. The worst host op and the worst
intake are of one order (the goal's bound), but the cost follows the state, not
the op. An incremental budget (the codec's per-entry cost kept per sandbox and
adjusted per write) would make it O(write); it needs the codec to expose its
budget as a function, not only a refusal.

## Challenge

challenge: 2026-11-23 — none yet (factual capture at the live-sandbox goal's close, ADR-0568)
