---
area: runtime-js
status: draft
title: Callable EventEmitter for legacy Node constructors
created: 2026-07-17
why: real nodemon dependencies use `EventEmitter.call(this)` plus `util.inherits`, but rifty exports an ES class that throws when called without `new`
epic: real-node-server-dev-loop
sources: [ADR-0012, ADR-0034]
code: [packages/io/src/event-emitter.ts, packages/io/src/event-emitter.test.ts, tools/node-parity-runner/cases/events]
---

## Context

Node's `events.EventEmitter` supports `new EventEmitter()`, subclassing, and the
legacy initializer `EventEmitter.call(target)`. Rifty's current class supports
the first two but throws on the third, which is still used by packages below
real nodemon. The contract must preserve one listener-state owner across all
three construction forms, reflection, static members, and `instanceof`; a
wrapper with a second event store would only move the divergence. This changes
the public `@riftydev/io` constructor contract and needs an ADR before `ready`.
The adjacent `runtime-js/events-static-surface` item retains ownership of
static helpers and capture-rejection options.
