# ADR 0324: Callable EventEmitter constructor over one listener state

Status: Accepted
Date: 2026-07-26

> TL;DR: `@riftydev/io` exports one callable/constructable EventEmitter whose
> legacy and modern construction forms initialize the same listener state.

## Context

Node's `events.EventEmitter` is both constructable and callable as a legacy
initializer. `nodemon@3.1.14` executes
`EventEmitter.call(this)` followed by `util.inherits`; rifty's ES class throws
before nodemon can start. A wrapper constructor or a second listener store
would make mixed legacy/modern methods observe different state.

## Decision

- The exported EventEmitter is one function object and one prototype. It
  supports `new EventEmitter()`, ES subclassing,
  `EventEmitter.call(receiver)`, and `util.inherits`.
- Calling it initializes the receiver in place and returns `undefined`, as Node
  24.16.0 does. Constructing it returns the instance normally.
- Every form uses the existing listener-state representation and method
  implementation. No wrapper-owned store, copied listener table, or parallel
  constructor exists.
- Prototype identity, `instanceof`, reflection, error-event behavior, listener
  mutation during emit, and existing static/helper ownership remain one
  contract.

## Consequences

- Real legacy packages such as nodemon construct without a compatibility shim.
- The public `@riftydev/io` constructor type changes from class-only to
  callable/constructable; runtime-js continues to re-export that same object.
- Differential coverage must pin call/new/subclass/`util.inherits`, return
  value, identity, and shared listener state against Node 24.16.0.
- Static helper/capture-rejection gaps remain owned by their existing backlog
  contracts; this ADR does not approximate them.

References: ADR-0012, ADR-0034,
`docs/backlog/playground/reference/nodemon-3.1.14-reachability.md`.
