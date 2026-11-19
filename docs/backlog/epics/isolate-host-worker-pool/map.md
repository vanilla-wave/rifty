# Map — isolate-host-worker-pool

## Items

(none — the carrier landed GREEN; CLOSE verifies the destination.)

## Open questions

- Linux retention for carrier row 11 (I10): the 8e6-object vector stays resident on macOS (651 MiB);
  on Linux it is unmeasured, so the row may pass there without discriminating — owner: agent —
  measure the vector's idle RSS on the CI runner at CLOSE; returned memory → pick a vector resident
  on Linux too.

## Out of scope

- Export of an embeddable rifty guest for custom integrations (separate goal).
- Queue, priorities, prewarming, metrics, tenant affinity, a concurrency
  limit, an `AbortSignal` option, a process-per-call mode.
- Hard containment of an isolate escape; side-channel mitigation inside a
  shared worker (declared, I8).
- Platforms beyond isolated-vm prebuilds (linux-x64/arm64, darwin-arm64,
  win32-x64); Windows is not tested.
