# Ledger — per-call SharedArrayBuffer access

- 2026-11-19 — raw RED against 9b948d757 on Node 24.16.0 and isolated-vm 7.0.2: 8 failed, 2 baseline controls passed. Direct and exported memory returned the native brand, both pool paths allowed construction, invalid input ran, and the packed README embedder allowed all three calls. Expected failures marked for the contract commit.
