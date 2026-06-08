# ADR 0094: Superseded ADRs are removed, not retained

Status: Accepted
Date: 2026-06

## Context

The repo kept superseded ADRs in `docs/adr/` for audit. But a dead ADR sitting next to live ones is a hazard: an agent grepping the ADR set can read a retired decision as current and draw the wrong conclusion. The audit value (what was decided, why, what overrode it) is already in git history.

The CLAUDE.md hard rule "decisions in `docs/adr/` are immutable after merge; supersede with a new ADR that references the old" — lineage ADR-0008 → ADR-0063/0064 — was read as *keep the old file too*. That retention is the failure mode.

## Decision

Superseded ADRs are **REMOVED** from `docs/adr/`.

- **git history is the audit trail** — the removed ADR's full text stays recoverable there.
- **the successor absorbs the superseded ADR's load-bearing context** (graft) — any rationale/gotcha still in force migrates into the successor so nothing live is lost with the file.
- **`docs/adr/README.md` keeps a removed→successor pointer table** so a reference to a gone number resolves.

This AMENDS the immutability hard rule for the **retention aspect only**: active ADRs remain immutable after merge, supersedence stays explicit (the successor cites and overrides the old number). Per ADR-0063 / ADR-0064, recording the supersession in a new ADR is the agent's standing-authority path; this ADR only changes that the old file is deleted rather than kept.

## Consequences

- Cleaner active set: every ADR in `docs/adr/` is live; none can be misread as current.
- One-time grafts performed: 0013→0072 (OPFS hot path), 0024→0033 (file budget; WASI-coverage note), 0025→0043 (dev-server realm; page-realm globals-guard). Earlier removals (0008→0063/0064, 0044→0047) already recorded in the README table.
- Reading a removed ADR's full text now needs git (`git log`/`git show`), not a file in the tree — accepted cost; the successor + pointer table cover the day-to-day need.
- The README removed→successor table is now load-bearing: a dropped number must always have a row.
