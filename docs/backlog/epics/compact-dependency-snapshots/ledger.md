# Ledger — compact-dependency-snapshots

- 2026-10-23 — pickup: one PR per user; BASE f37bfc517613d0e3618519ccbeeb3ed15fd5cc39. ADR-0547 selects public profile and v5; existing packed no-COI Vite journey carries acceptance. Unit RED executed: v5 unsupported; legacy-profile input wrongly admitted. No implementation yet.
- 2026-10-23 — Contract+RED PASS @ ec970a6df0f7c7ffa79bab718e99e9373ad9f3c1; verdict on PR #388. Packed RED: real Vite producer emits v4 instead of requested v5. Implementation shares existing validation/projection/overlay; no added owner. Focused GREEN: 69 tests.
- 2026-10-23 — full packed GREEN: ordinary/compact native no-COI lifecycle + existing Workbench/reference host; 9,770,979 → 6,025,362 gzip bytes. All 28 pr:check gates PASS; docs:check PASS. Evidence in distribution/reference/compact-dependency-snapshots-evidence.md; Final+GREEN/CLOSE next.
