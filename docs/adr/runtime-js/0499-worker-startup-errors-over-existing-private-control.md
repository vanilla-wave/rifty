# ADR 0499: Worker startup errors over existing private control

Status: Accepted
Date: 2026-10-01
Extends ADR-0326 / ADR-0491; no recorded decision overturned.

## Context

Native Node v24.16.0 reports missing/throwing require preloads asynchronously
through Worker error, then exit 1; entry never runs. Browser RED only prints
stderr and exit. Same real fixtures: tests/e2e/vitest-run-in-browser.spec.ts.

## Decision

One generic `control:entry-error` frame on existing private IPC. Kernel forwards
opaque payload as entryerror; public guest messages remain wrapped ipc:message.
Node bootstrap uses the runtime-owned process IPC capability to send the real thrown value plus enumerable error properties,
then its captured exit(1). Native structured clone retains Error data; parent
Worker restores custom properties (MODULE_NOT_FOUND) and emits error before exit.
Explicit process.exit remains an exit, never a fabricated error.
No new terminal authority, handshake, error inferred from exit code or stack parser.

## Alternatives

- Infer Error from stderr/exit: rejected; loses code/value and invents provenance.
- New transport/settlement owner: rejected; private IPC already orders controls.
- Existing private control + real clone: chosen; startup error precedes self-exit.

## Proof

Physical Native/browser flags-errors.cjs: invalid operands synchronous;
missing/throwing preloads asynchronous; entry suppressed. Public message payloads
cannot impersonate control frames. Later detached Worker error projection remains
outside this startup repair (existing worker-threads-kernel-error-event item).
