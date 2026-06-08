---
area: perf
subsystem: runtime-js
status: active
title: Open verification gaps — unresolved correctness gates + missing parity coverage (parity-first)
created: 2026-06-08
why: §7 lists correctness gates not independently re-verified + parity cases that must exist (parity-first hard rule) BEFORE the dependent perf changes land
sources: [perf-audit §7 + §6, adr-plan G]
---
## Context
Audit §7 coverage-&-gaps: correctness assertions the perf changes depend on are not yet independently verified, and several Node-parity cases do not exist. Parity-first hard rule: these must land before the changes that depend on them.
## Options / Next
Verification gates to resolve before merging the dependent change:
- WASI fd_write mutation path — does readFileBytesSync (opfs-sync.ts:421) return by reference and does fd.ts:90-95 mutate it in place? Resolve before Q-319 OPFS shared-slice (cross-cutting #44 HIGH vs vfs-subsystem low).
- streams microtask-batching event-order (writable.ts/readable.ts) — gate for ADR-0083; cited stream suite must stay green.
- transformEsm purity assertion — gate for the #16 transform cache (Q-202).
Missing parity cases to ADD (parity-first, BEFORE the corresponding change):
- non-UTF-8 execSync stdout (Buffer.from([0xff,...]) echoed, byte-exact; only ASCII conformance exists) — gates ADR-0087 #23 binary frame.
- int-accessor OOB throws (none exist for int accessors today) — gates ADR-0082.
- ascii `& 0x7f` masking — gates the ascii-mask NONE fix.
- setImmediate/nextTick scheduling order (nested setImmediate + setImmediate-vs-setTimeout(0) interleaving; none exist) — gates ADR-0092.
Measurement recipes (§6) double as acceptance gates: codec-construction counter stays at 2 across require('express'); waitAsync fires on notify not a tick with timers faked; scope package.json parses once + re-read after invalidate; OPFS slice count = 1/write + aliasing test; npm fetch concurrency >1 + deterministic express-diamond layout + same-(name,version) dedupe against the REAL registry (not FakeRegistry).
## Reversibility
REVERSIBLE — test/coverage work (adding parity cases + verifying gates). Parity-first hard rule. No ADR/decision subagent; but each gate BLOCKS its dependent perf item until green.
