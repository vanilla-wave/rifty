# Ledger — fault-honest-sw-preview (append-only)

- 2026-08-23 — migrated from single-file epic (goal_baseline 742dce2ba retired; content identical, see git history of `fault-honest-sw-preview.md`).

## Budget

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0 — the chokepoint reuses the existing broker
  correlation; a second timer family per hop is the named anti-pattern
- generated globs: `docs/public/compat/**`, `**/generated/**`

| slice | band |
|---|---|
| blocked-host-diagnosis | 300–800 |
| termination-chokepoint | 800–2000 |
| ws-termination | 400–1000 |

