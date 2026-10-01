# ADR-0492: Advanced fork IPC over the structured-clone channel

- Status: accepted
- Date: 2026-10-01
- Extends the existing fork IPC/channel contract; no new transport or coordination.

## Context

Node v24.16.0 advanced serialization preserves Date, Map, Set, typed arrays and
cycles; JSON loses them. `advanced-ipc.case.ts` executes the same program against
native Node and a physical kernel Worker. Baseline RED: serialization.advanced.

## Decision

Program-launch IPC declares json/advanced; default remains json. Advanced uses
native structuredClone over the existing kernel channel. Buffer side references
identify branded Buffer nodes in the same clone graph; receiver reconstructs
Buffers while retaining references/cycles. Neither mode changes ordering/control.

## Alternatives

- JSON tags for the complete graph: rejected; native clone already preserves types/cycles.
- Raw clone only: rejects Node Buffer fidelity; native cloning strips Buffer branding.
- Native clone + Buffer side references: chosen; Buffer references reuse clone graph identity.

## Proof

Physical `advanced-ipc` differential suite + existing default-JSON cases;
real Vitest forks acceptance exercises the browser channel.
