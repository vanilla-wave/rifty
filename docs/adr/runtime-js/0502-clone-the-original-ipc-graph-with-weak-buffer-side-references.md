# ADR-0502: Clone the original IPC graph with weak Buffer side references

- Status: accepted
- Date: 2026-10-02
- Supersedes ADR-0501 entirely; retains ADR-0492's transport/receiver ownership.
- DEC-2: independent ipc_brand_decision; scope verified by vitest_final_review.

## Context

Snapshot loses opaque internal brands: Promise with null prototype, WeakRef,
FinalizationRegistry, MessagePort become records. Native V8 and structuredClone
reject before getters. No standard side-effect-free Promise-brand query exists.

## Decision

One native structuredClone of the original graph. Its later buffers getter
lists live branded byte views from one per-realm weak allocation registry;
original data accessors execute once, including fresh/hidden Buffer values.
Native graph identity joins data and side references. Decode rebrands only
Buffer references actually reached from data; unrelated side refs allocate none.
WeakRef + FinalizationRegistry avoid persistent strong ownership. Duplicate io
bundles share one registry. Buffer constructors, native byte-view construction
and prototype/Reflect.construct admission record views; current intrinsic slots
and data-only brand descriptors select Buffer views without invoking guest getters.
Detached unrelated views are excluded by captured native values validation.
No new transport, handle, terminal owner, Promise reaction, or Proxy wrapper.

Browser-only cloned brands (Blob/File/DOMException etc) and SharedArrayBuffer
outside Buffer payloads fail named advanced.WebObject / advanced.SharedArrayBuffer
ceilings before sending. This explicitly withdraws ADR-0501's extra Blob-positive
claim; exact Vitest I1–I7 and Node-core IPC claims remain unchanged. Runtime-private
brand spoofing is not a Node API or an admitted Buffer construction path.
Registry scans live byte views; packet copies live Buffer views. Production perf
is outside this goal; this correctness cost is explicit.

## Alternatives

- Snapshot + prototype/constructor heuristics: killed by erased Promise RED.
- Promise.then probe: changes reactions/unhandled-rejection state; rejected.
- Prototype-mutation guard: Reflect.construct custom newTarget bypasses it; rejected.
- Native clone + weak side references: chosen; old/fresh/repeated Buffer aliases
  retained, opaque rejection stays native.

## Proof

advanced-ipc-values tests: native V8 rejection-before-getter, Buffer getters,
prototype/core slots, detached views, adopted views, cycles; physical fork parity.
Captured RED: reference/vitest-run-red-proof.txt in runtime-js backlog evidence.
