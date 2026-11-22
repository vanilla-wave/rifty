# Ledger — isolate-host-fs-snapshot

- 2026-11-22 — FIT from the manager hand-off (thread 4056a9e7); probes: `distribution/reference/isolate-host-fs-snapshot-fit-probes.md`; format ADR-0567.
- 2026-11-22 — FIT: challenge 2 problems resolved (ino dropped from format; snapshot after guest code = guest-authored bytes); final-check PASS @ 2328d67ea; goal ready. Packaging (manager): standalone goal, lands first; sandbox embedding moves to the sandbox goal.
- 2026-11-22 — Contract+RED PASS @ 2328d67ea (codec unit + carrier; verdict JSON on PR #418). Open concern for the user-owned scenario: step 2 says "identical to step 1" while I1/Outcome renew `ino` — left as written, raised to the manager.
