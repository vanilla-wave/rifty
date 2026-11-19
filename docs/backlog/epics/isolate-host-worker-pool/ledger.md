# Ledger — isolate-host-worker-pool

- 2026-11-18 — step 0 premise measured (warm p50 13 ms cached / 60 ms uncached vs A 137 ms; +11.5 / +25 MiB per extra isolate vs A ~140 MiB; 8 concurrent 296 / 494 MiB vs A 1118 MiB); ≥ 2× on both → build; full answer: `docs/backlog/distribution/reference/isolate-host-pool-step0.md`
- 2026-11-18 — premise challenge: 8 problems, dispositions in `goal.md` §Challenge; rival A + code cache probed (74.5 ms, 108 MiB)
- 2026-11-18 — forks F1 (rerun out of budget) and F2 (culprit-less loss) sent to manager; manager decided by delegation F1 (a) reject `ERR_ISOLATE_HOST_WORKER_LOST`, F2 (a) rerun once with quarantine; user answer pending, lands as `amend:`; full answer: `goal.md` §Decisions
- 2026-11-18 — FIT final written-result check: 11 findings fixed @ a403ff556, verify pass 1 concern + 3 nits fixed; goal `ready` on the manager's delegation
- 2026-11-18 — Contract+RED PASS (concerns, no blocker) @ 49e448a8a, JSON on PR #412; 11 concerns fixed in place, carrier now 27 cases, all RED on main for the pool reason
- 2026-11-19 — rebased on main 6d7640353 (export PR #411); manager adds timer-fire backpressure to scope; fixed in the export's `createHostBridge` (interval re-arms after delivery), parity rows RED→GREEN, backlog item closed
