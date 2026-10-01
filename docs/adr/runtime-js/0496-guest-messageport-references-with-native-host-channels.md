# ADR-0496: Guest MessagePort references with native host channels

- Status: accepted
- Date: 2026-10-01
- Extends ADR-0152; preserves ADR-0270's Worker/MessagePort distinction.

## Context

@emnapi/runtime's NodejsWaitingRequestCounter refs an unused MessageChannel port
while native work is pending. Browser ports lacked ref/unref, so Rolldown's async
config bundle lost its only keepalive. Real Node/browser port-ref.cjs RED: Node
receives unref Worker message (exit 0); browser throws (exit 1).

## Decision

Guest MessageChannel keeps native transport/brands and counts explicit port refs
plus DOM message listeners. Host/control channels use a captured native constructor
and host-marked ports, including transferred stdio at kernel admission; they never
hold a guest loop. Native constructor capture is realm-shared across bundle copies.
Close releases the ref. Missing Node listener methods/options remain named ceilings.

## Alternatives

- Ref every host port: rejected; persistent control channels keep empty guest processes alive.
- Patch emnapi's waiting counter/action promise: rejected; package-specific lifetime fiction.
- Guest port references + explicit host primitive: chosen; Node's real ref contract.

## Sweep and proof

Worker/IPC refs reuse one event-loop counter. All first-party host channel creation
uses the IO primitive; timers, kernel, service-worker/control/support do not create
guest handles. Real browser/Node lifecycle fixtures and Vitest's N-API config bundle.
