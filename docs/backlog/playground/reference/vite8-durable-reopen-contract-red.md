# Durable Vite 8 reopen Contract+RED split

Baseline: `23948c3dd54989eaa5c01543fa92e8d717d94f19`.

Terminal predecessor: `playground/vite8-durable-reopen-invalidation`.

- Ready contract: `afd16a8ee9f5dd2bce115f4835c1182f4c03883e`
  (reachable replay `72410f0308f2613176e111003d322535dced24ce`).
- Attempt 1: `fbe9249181a4d6ed3c0126d4177f38dfe35b1f78` — blocker.
  The browser oracle did not compare the complete old/current lock and tree,
  and no RED injected restored-context App binding failure with causal cleanup.
  Reachable replay: `831434bcfa04753b8ea578c3437558dd745bdb52`.
- Attempt 2: `c043302541f639464d310fe1e9ab74a4c084f136` — blocker.
  Exact tree and App-binding coverage landed, but the activation-only decision
  lacked create/save post-mutation-open sibling guards and confirmation that
  reset/delete retain their existing owner semantics.
  Reachable replay: `e9a6248dadce6d179f269f769dd1d38ea2b97d7c`.
- `terminal-checkpoint: c043302541f639464d310fe1e9ab74a4c084f136`.

No third checkpoint runs for that unit. The reviewed attempt commits are
replayed in the terminal-split PR before their active RED/source diffs are
reverted, so the failed evidence remains in reachable history without landing
a failing default suite.

## Successor units

1. `playground/project-activation-open-compensation` — activate-specific
   catalog/session compensation, causal runtime/App binding errors, queued
   close, and the complete create/save/reset/delete sibling sweep.
2. `playground/vite8-durable-tree-replacement-proof` — after that substrate,
   the real same-origin old→current OPFS fixture, exact old/current tree
   replacement, Reset, zero-acquisition offline same-card reopen, and executed
   Vite/Rolldown proof.

The successors run serially. The activation unit owns its own Contract+RED then
Final+GREEN checkpoints. The durable carrier changes no production authority;
its review must prove that it closes only the allocated browser acceptance and
does not reopen the terminal compensation boundary.
