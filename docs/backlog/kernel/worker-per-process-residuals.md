---
area: kernel
status: active
title: Worker-per-process residuals — worker-side process.stdin Readable + un-run conformance
created: 2026-06-08
why: SAB-Worker stdin write path landed but worker-side process.stdin Readable + the SAB-only conformance suites stay unverified in Node
sources: [TASKS M6, ADR-0045, ADR-0011]
---
## Context
The page→child stdin write path is wired (`child_process.ts:220-224` → `handle.stdin()` → `bindPortAsWritable` in `process-manager.ts:328-331`); `child.stdin.write/end` post to the worker's stdin `MessagePort`. Two residuals remain on the worker-per-process model:
- **Worker-side `process.stdin` Readable** wiring is the explicitly-named follow-up after the SAB stdin slice — the child can be written to but cannot yet consume its own stdin as a Node Readable.
- **Conformance only proves it in the browser:** the SAB-only suites (`child_process-stdin`, `*-worker`, `exec-sync-worker`) gate on `crossOriginIsolated && getKernelWorkerUrl()` and are skipped under Node — so CI never exercises the worker-branch end-to-end; the contract is documented, not auto-verified in the parity/conformance default run.
## Options / Next
1. Add worker-side `process.stdin` as a Readable fed by the kernel stdin `MessagePort` (pairs with the binary-stdio-backpressure item). 2. Close the verification gap: either run the SAB suites in the browser e2e harness as a gated DoD step, or stand up a Node Worker harness that satisfies the SAB gate so the worker branch is exercised in CI. Couples to the binary-stdio-messageport-backpressure file.
## Reversibility
REVERSIBLE — additive Readable wiring + test harness; no public-API change beyond the already-shipped stdin surface. Verify the conformance-skip is intentional vs a coverage hole before deciding the harness shape.
