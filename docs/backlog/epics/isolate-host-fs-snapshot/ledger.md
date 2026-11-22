# Ledger — isolate-host-fs-snapshot

- 2026-11-22 — FIT from the manager hand-off (thread 4056a9e7); probes: `distribution/reference/isolate-host-fs-snapshot-fit-probes.md`; format ADR-0567.
- 2026-11-22 — FIT: challenge 2 problems resolved (ino dropped from format; snapshot after guest code = guest-authored bytes); final-check PASS @ 2328d67ea; goal ready. Packaging (manager): standalone goal, lands first; sandbox embedding moves to the sandbox goal.
- 2026-11-22 — Contract+RED PASS @ 2328d67ea (codec unit + carrier; verdict JSON on PR #418). Open concern for the user-owned scenario: step 2 says "identical to step 1" while I1/Outcome renew `ino` — left as written, raised to the manager.
- 2026-11-22 — Final+GREEN round 1 BLOCK @ 6c4a29120 (decoder quadratic on equal-length >16 383-unit paths; packed-export pin) → fixed @ 62a73512e; verify BLOCK: the name cap weakened I1 → manager decision by delegation: I1 amended to names ≤ 16 383 (goal Decisions `amend:`), vfs NAME_MAX gap captured `vfs/file-names-over-name-max-accepted`.
- 2026-11-22 — re-chart after codec + carrier (final-green PASS @ 6c765ddbe; verdict JSON on PR #418): carrier green (7/7), I1–I6 carried; map empty; next CLOSE after the manager's external review. Captured: `vfs/file-names-over-name-max-accepted` (final-check PASS).
