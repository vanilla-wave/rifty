# Vite 8 WASI closure Contract+RED split

Baseline: `eccf8e1cc732882558fc964daa346336d9185ee5`.

Terminal predecessor: `vite8-wasi-runtime-closure-policy`.

- Attempt 1: `2a1995766969e63deb1d5e777ac82be9203d88c9` — blocker.
  Missing actual Workbench byte-chain proof, reproducible npm/Rifty oracle,
  complete non-8 ingress sweep, and Vite-8 lifecycle RED.
- Attempt 2: `140c0b3d3b98a1c684a51720a6acc8b4386fcb4d` — blocker.
  The proposed A→B→A test created a fresh final starter instead of reopening
  the same durable Vite 8 project, so it did not prove `poisoned-cache`.
- `terminal-checkpoint: 140c0b3d3b98a1c684a51720a6acc8b4386fcb4d`

No third checkpoint runs for that unit. ADR-0336 remains the immutable umbrella.

## Successor units

1. `vite8-wasi-manifest-cold-repair` — Decision 1–4 and upgrade proof from
   Decision 5; Proof bullets 1–3 plus cold from-scratch build/preview; fault
   rows `frozen-assumption` / `provenance-lie` and `sibling-drift`.
2. `playground/vite8-durable-reopen-invalidation` — instant durable restore
   half of Proof bullet 4 and the `poisoned-cache` row. It must reopen the same
   saved Vite 8 project/card after switching away and observe the current
   manifest, snapshot descriptor, definition identity, install trust, and
   runtime tree; a fresh starter does not satisfy it.

The successor units run serially. Each names this terminal predecessor and owns
its own Contract+RED then Final+GREEN checkpoints.
