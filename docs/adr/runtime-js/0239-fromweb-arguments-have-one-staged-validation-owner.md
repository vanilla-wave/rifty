# ADR 0239: fromWeb arguments have one staged validation owner

Status: Accepted
Date: 2026-07

> TL;DR: One owner snapshots `fromWeb` arguments, validates in Node stages,
> preserves acquisition side effects, and keeps valid signals a safe loud gap.

## Context

Node v24 reads every supported option before validation, but validates some
values before reader/writer acquisition and HWM/signal after it. Duplex first
snapshots `readable,writable`, then acquires writer before reader. ADR-0237's
"non-undefined signal" clause is wrong: falsy signals are absent. A flat
preflight or per-adapter checks reorder getters, errors, and stream locks.

## Decision

- One private owner exposes typed Readable/Writable/Duplex stages; adapters do
  not spread caller options or inspect hook getters.
- Validate source brand before options. Duplex snapshots pair getters once in
  `readable,writable` order before validating either.
- Validate options object, then snapshot config getters once in ADR-0237 order.
  Later raw getter throws win over invalid earlier values.
- Early validation: Readable `encoding→objectMode`; Writable
  `objectMode→decodeStrings`; Duplex `objectMode→encoding`.
  Duplex leaves non-boolean `decodeStrings` to core coercion, matching Node.
- Classify HWM without throwing. If HWM is valid and signal is a real or
  event-target-shaped supported value, loud-throw the adapter signal feature
  before acquisition. Already-aborted signals use the same gap.
- Otherwise acquire Readable reader, Writable writer, or Duplex writer→reader.
  Then throw classified HWM errors; next apply Node signal behavior: falsy is
  absent, invalid truthy values get Node-coded `TypeError`, and `{ aborted }`
  without callable `addEventListener` preserves Node's raw `TypeError`.
- Post-acquisition validation intentionally leaves WHATWG locks as Node does.
  Public option types still exclude hooks and `signal`.

## Consequences

- Getter/error/lock order is one contract across all adapters.
- Valid unsupported signals fail before an unowned lock; invalid inputs retain
  Node-observable acquisition side effects.
- Full signal lifecycle remains
  `runtime-js/web-stream-adapter-terminal-lifecycle`; no partial attachment.

## Rejected

- Validate everything before acquisition: hides Node lock/error ordering.
- Treat every non-undefined signal as the gap: rejects Node-absent falsy values.
- Accept `{ aborted }` as a valid signal: masks Node's raw method failure.
