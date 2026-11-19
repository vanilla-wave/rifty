# Ledger — isolate-host-worker-pool

- 2026-11-18 — step 0 premise measured (warm p50 13 ms cached / 60 ms uncached vs A 137 ms; +11.5 / +25 MiB per extra isolate vs A ~140 MiB; 8 concurrent 296 / 494 MiB vs A 1118 MiB); ≥ 2× on both → build; full answer: `docs/backlog/distribution/reference/isolate-host-pool-step0.md`
- 2026-11-18 — premise challenge: 8 problems, dispositions in `goal.md` §Challenge; rival A + code cache probed (74.5 ms, 108 MiB)
- 2026-11-18 — forks F1 (rerun out of budget) and F2 (culprit-less loss) sent to manager; manager decided by delegation F1 (a) reject `ERR_ISOLATE_HOST_WORKER_LOST`, F2 (a) rerun once with quarantine; user answer pending, lands as `amend:`; full answer: `goal.md` §Decisions
- 2026-11-18 — FIT final written-result check: 11 findings fixed @ a403ff556, verify pass 1 concern + 3 nits fixed; goal `ready` on the manager's delegation
- 2026-11-18 — Contract+RED PASS (concerns, no blocker) @ 49e448a8a, JSON on PR #412; 11 concerns fixed in place, carrier now 27 cases, all RED on main for the pool reason
- 2026-11-19 — rebased on main 6d7640353 (export PR #411); manager adds timer-fire backpressure to scope; fixed in the export's `createHostBridge` (interval re-arms after delivery), parity rows RED→GREEN, backlog item closed
- 2026-11-19 — IMPLEMENT: pool landed on the export (ADR-0563); carrier 27→28 GREEN; 15/15 invariant mutants killed; 5/5 load runs green before the critic
- 2026-11-19 — DEC-2 critic on ADR-0563: 7 problems (2 blockers: idle-ended worker still placeable — RED first, fixed; overturned ADR-0557 clauses unnamed — named); verify pass: holds, 1 concern (retire must precede the terminal frame) + 1 nit fixed
- 2026-11-19 — RSS-kill-without-culprit re-probed on the landed pool: no vector crosses the ceiling without an isolate signal → recorded unreachable (step0 reference)
- 2026-11-19 — load runs (10× package suite, one busy process per core): on 80f99a0e7 3/10 red (harness ps-fork count, libuv timer epsilon, guest clock drift in a long-lived worker — the last a real defect, fixed in the export); on 6b496d318 10/10 green (351/351)
