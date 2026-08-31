# PICKUP — compile and gate the next slice

0. **Re-chart debt.** Read the ledger tail: a previously landed slice without
   its `re-chart after <slice>` line means the map may be stale — run
   [RECHART](RECHART.md) first; pickup on re-chart debt compounds a stale map.
1. **Choose.** The user-named child, else the first frontier child (open,
   unblocked by `blocked_by`, in `map.md` seed order).
2. **Compile** the draft to `ready` per `docs/process/decision-workflow.md`
   §Backlog readiness: exhaust code/ADR/real-Node/spike evidence; every
   Parity/Fault row carries a reproducible artifact (command + output +
   version); a remaining user-observable fork → stop and request manual
   `rifty-refine` — never self-run the interview. A fog line this slice depends
   on that is tagged `owner: user` IS such a fork: route it to refine, never
   settle it with a probe — a probe answers facts, not what the value requires.
3. **Declare the band.** Append a ledger row `<date> — <slice> band <lo>–<hi>`
   sized from the compiled contract's expected-RED batch. Far above any prior
   estimate → the unit is too big: split it now, not after review.
4. **Decide review membership** — `fault-classes.md` §Review convergence:
   parity, cache, persistence, network, or concurrency → `review: checkpoints`;
   docs/CI/process/tooling/harness → `review: ordinary`. Record the line in the
   unit doc. Judge the unit's own subject, not the branch it rides.
5. **Contract+RED** — only for `review: checkpoints` — via `rifty-review`
   §Checkpoint run (fresh isolated reviewer). Record `ready-verdict:` in the
   item and one ledger line; a blocker verdict is recorded too (`contract-red:
   <date> — blocker @ <sha>`) — the valves in `fault-classes.md` §Review
   convergence read that count. An `ordinary` unit skips both checkpoints and
   gets one review after implementation, blockers fixed in place.
6. **Hand off.** Implementation is outside this skill; this mode is done.

Done when the verdict and band are recorded and no implementation has started.
