# ADR-0503: Reject shared-backed advanced IPC values before send

- Status: accepted
- Date: 2026-10-02
- Supersedes only ADR-0502's SAB-backed Buffer exemption/postclone copy.
- DEC-2: independent ipc_brand_decision, actual Node v24.16.0 probe.

## Decision

Reached SharedArrayBuffer or any shared-backed view, including Buffer, throws
child_process.serialization.advanced.SharedArrayBuffer before sending.
The weak side-reference reader excludes unrelated shared-backed views too.
Nonshared Buffer/native clone, transport and receiver authority stay unchanged.
Native V8 accepts shared-backed views; this is an explicit browser gap, compat ❌.
Exact Vitest I1–I7 does not use shared-backed fork payloads; thread clone is separate.

## Evidence / alternatives

Native visits Buffer byte1 before a later getter writes2; result1.
Original-graph browser clone shares storage; postclone copy gives2 (RED).
Copy before walking also fails when an earlier getter writes2 (Native result2).
Per-value observation needs another serializer; outside this exact scenario.
Finite named ceiling chosen; no wrong snapshot or implicit shared payload.
Probe/DEC-2 output: runtime-js/reference/vitest-ipc-sab-ceiling-decision.md.
The locally introduced SAB-positive test is withdrawn explicitly; negative native
oracle + named ceiling replaces it. Original goal is unchanged.
