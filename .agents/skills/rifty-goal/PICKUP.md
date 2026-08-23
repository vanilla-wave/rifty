# PICKUP — compile and gate the next slice

1. **Choose.** The user-named child, else the first frontier child (open,
   unblocked by `blocked_by`, in `map.md` seed order).
2. **Compile** the draft to `ready` per `docs/process/decision-workflow.md`
   §Backlog readiness: exhaust code/ADR/real-Node/spike evidence; every
   Parity/Fault row carries a reproducible artifact (command + output +
   version); a remaining user-observable fork → stop and request manual
   `rifty-refine` — never self-run the interview.
3. **Declare the band.** Append a ledger row `<date> — <slice> band <lo>–<hi>`
   sized from the compiled contract's expected-RED batch. Far above any prior
   estimate → the unit is too big: split it now, not after review.
4. **Contract+RED** via `rifty-review` §Checkpoint run (fresh isolated
   reviewer). Record `ready-verdict:` in the item and one ledger line.
5. **Hand off.** Implementation is outside this skill; this mode is done.

Done when the verdict and band are recorded and no implementation has started.
