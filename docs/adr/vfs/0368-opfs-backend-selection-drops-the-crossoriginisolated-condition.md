# ADR 0368: OPFS backend selection drops the crossOriginIsolated condition

Status: Accepted
Date: 2026-08-29

> TL;DR: `detectVfsBackend()` selects OPFS on platform support alone — the `crossOriginIsolated &&` conjunct (ADR-0072 inherited clause) is policy, not platform, and falls; no-COI pages get durable OPFS.

## Context

ADR-0072 (inherited from 0013): `detectVfsBackend()` → `'opfs'` iff
`crossOriginIsolated && OpfsVfs.isSupported()` (`packages/vfs/src/boot.ts:23`).
OPFS itself (incl. `FileSystemSyncAccessHandle` in Workers) has NO platform COI
requirement — the conjunct dated from "browser == COI workbench" days. Epic
`no-coi-sandbox-tier` I5 requires reload durability on headerless pages; the
2026-08-28 HMR spike ran OPFS + reload durability green on a real no-COI page
(`docs/backlog/distribution/reference/no-coi-hmr-spike-record.md`). User
decision 2026-08-25/28 recorded in the goal; this ADR is the carrier — a
future draft cannot amend an active ADR retroactively (bare-sab-guard
Contract+RED checkpoint 4).

## Decision

- `detectVfsBackend()` → `'opfs'` iff `OpfsVfs.isSupported()` (realm/platform
  probe only); memory backend remains the fallback (Node tests, unsupported
  browsers). `crossOriginIsolated` is no longer an input to VFS backend
  selection.
- Supersedes ONLY that clause of ADR-0072 (dated correction note there +
  README Corrections row). Everything else in 0072 — sync content cache,
  write-through, realm split, A-005 directory-op scope — stands.
- Implementation + no-COI reload-durability proof land in slice
  `vfs/no-coi-opfs-policy-flip` (goal map item 3); existing COI OPFS behavior
  must stay byte-identical.

Rejected: keeping the gate and shipping memory-VFS no-COI (silent durability
downgrade — tree lost on reload, exactly the quiet subset the tier forbids);
a second no-COI-specific backend knob (no contract needs it — §Simplicity).

## Consequences

- No-COI pages gain durable project trees (goal I5 becomes implementable).
- Blast radius: any environment that is OPFS-capable but not COI now flips
  memory→OPFS at boot — intended; the flip slice carries the regression proof.
- ADR-0072 stays active minus one clause.
