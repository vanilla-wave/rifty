# Ledger — honest-guest-package-adaptations

- 2026-10-15 — opened at refine (`rifty-refine`, handoff `/tmp/rifty-handoff-guest-package-patches-2026-10-15.md`); probes + decisions: `docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
- 2026-10-15 — decided: both Vite root policies are `upstream-edge` — real Node 24.22.0 + Vite 7.3.6 at `/` reproduces the phantom config restart/spurious change events (runs 2-3) and the split Refresh URL `/@id//@react-refresh` vs `/@react-refresh` (run 5); full answer: evidence file §Root
- 2026-10-15 — premise critic: 4 problems, all resolved (goal §Challenge; evidence §Review record)
- 2026-10-15 — user amendments (goal §Decisions `amend:`): root policies' kill condition = `project-location-independence`; principle confirmed; keepalive boundary = Node-surface incl. global WebSocket (EventSource dropped: not a default Node 24 global)
- 2026-10-16 — re-chart after vite-cli-action-keepalive-hook-removal (final-green PASS @ 27ef470e6): installed Vite `cli.js` is upstream bytes (7.3.6, 8.0.16), hook + `trackKeepalivePromise` export removed (ADR-0530); lanes red on main recorded as drafts `distribution/build-module-count-pins-over-live-transitives`, `npm-client/vite-7-3-7-from-scratch-esbuild-refusal`; verdict `docs/backlog/npm-client/reference/vite-cli-action-keepalive-hook-removal-final-green.json`
