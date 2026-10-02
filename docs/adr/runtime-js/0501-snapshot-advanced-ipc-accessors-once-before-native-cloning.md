# ADR 0501: Snapshot advanced IPC accessors once before native cloning

Status: Accepted
Date: 2026-10-02
Extends ADR-0492; its native packet/Buffer side-reference decision remains.

## Context

Independent review actual Node fork: getter reads once, returns branded Buffer.
Browser RED: two reads, second Uint8Array loses Buffer branding. Native V8
serializes web objects (Blob/URL) as ordinary own-property records, unlike
browser structured clone. Native Node v24.16.0 Blob probe: 1 Object true 1.

## Decision

Snapshot ordinary enumerable string properties once, sharing one graph map.
Skip keys deleted by earlier getters; enumerable key set is captured initially.
Captured native Map/Set contents bypass guest iterator overrides. Native slot probes, not constructor/prototype text, recognize core values.
Ordinary web objects remain own-property records; native core values retain clone.
One structuredClone packet retains Buffer side references; no second serialization
walk of accessors, no new transport or receiver authority.

## Alternatives

- Original prewalk + native clone: killed by executed getter/Buffer RED.
- Complete tagged graph codec: unnecessary; native packet already preserves core types/cycles.
- One snapshot + existing native packet: chosen; unit sweep and physical fork parity.

## Proof

`packages/runtime-js/src/internal/advanced-ipc-values.test.ts` and physical
`tools/node-parity-runner/cases/child_process/advanced-ipc.case.ts`.
Native getter probe: `docs/backlog/runtime-js/reference/vitest-ipc-getter-probe.cjs`.
Captured RED: `docs/backlog/runtime-js/reference/vitest-run-red-proof.txt`.

## Proxy rejection

Snapshot RED: native Proxy becomes an ordinary record. JavaScript has no
Proxy-brand query. Guest constructors retain native Proxy semantics and record
created proxies in one private per-realm WeakSet (constructor + revocable).
Serialization rejects them through native structuredClone before observing traps.
Both Node bootstrap and the shared loader core install once; one readonly reader
bridges duplicate bundles. No reference handle, transport or terminal owner.
Mechanism sweep: Function guards own constructor policy; MessagePorts own refs;
none records native Proxy brand. Different constraint, no duplicate class owner.
Raw clone-only loses accessor Buffer brand; enumerating Proxy traps lies about
uncloneable input. This capability is required by I4's loud uncloneable send row.
