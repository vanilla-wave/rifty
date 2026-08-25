---
area: perf
subsystem: toolchain-build
status: draft
title: Child fs perf bounded two-lane orchestrator and committed baseline
created: 2026-08-26
epic: child-fs-rpc-hot-path
blocked_by: [perf/child-fs-perf-product-lane, perf/child-fs-perf-in-realm-lane]
why: I3 closes only when one command owns both real lanes, rejects lifecycle faults, and commits comparable baseline evidence
user_story: As the goal runner, I want one bounded command that produces an exact two-lane artifact or no artifact, but today no durable orchestrator exists.
sources: [perf/child-fs-perf-lane split @ fb02b2c2f]
code: [tools/perf/child-fs.mjs]
---

## Question

Compile after both physical lanes land: timeout/death matrix across registry,
dev server, page and Worker; launch order after args/port admission; exact N
samples; atomic publication; committed baseline and ledger summaries. Absorb and
delete `perf/child-fs-perf-lane` on completion.
