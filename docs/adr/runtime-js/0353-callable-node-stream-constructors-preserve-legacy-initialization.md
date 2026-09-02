# ADR 0353: Callable Node stream constructors preserve legacy initialization

Status: Accepted
Date: 2026-08

> TL;DR: publish all five core stream classes through one callable constructor boundary, preserving Node's legacy in-place initialization and modern class identity

## Context

`webpack-dev-middleware@7.4.2` serves compiler assets through memfs. Its current
`@jsonjoy.com/fs-node@4.68.1` `FsReadStream` inherits `node:stream.Readable`, then
calls `Readable.call(this, options)`. Real Node initializes that inherited
receiver. Rifty exported an ES class, so the call threw `TypeError: Class
constructor Readable cannot be invoked without 'new'`; Express converted the
throw into HTTP 500 after webpack had compiled successfully.

The same frozen assumption existed in `Writable`, `Duplex`, `Transform`, and
`PassThrough`. Node keeps all five callable, applies non-default options, and
leaves a usable stream. One-ctor repair would leave four reachable sibling
drifts at the same `node:stream` boundary.

## Decision

One package-private constructor publisher owns the five public values. Each
value supports direct `new`, ES subclass `super`, legacy `util.inherits` plus
`Constructor.call(this, options)`, and no-`new` construction. Both construction
forms follow the public constructor's current prototype. Legacy calls initialize
the inherited receiver in place and return `undefined`; calls whose receiver
does not inherit the constructor return a fresh instance.

Repeated initialization refreshes stream state and supplied options without
erasing omitted write/final/transform/flush hooks or duplicating Readable's
internal listener.

Readable and Writable move their complete per-instance setup into reusable
initializers. Duplex composes those initializers while retaining ADR-0034's
delegating `_writableState` getter. Transform preserves its ref-cell binding;
PassThrough preserves identity transformation. The publisher shares the
implementation prototype, copies static descriptors, preserves the derived
static chain, resets `prototype.constructor`, and exposes Node's constructor
name and arity. No memfs patch, output-FS fallback, or package-specific shim.

## Consequences

- Real memfs read streams can serve webpack assets; other legacy stream
  subclasses get the same Node behavior.
- One authority prevents constructor sibling drift while state machines remain
  owned by their existing modules.
- Public constructor values change from ES-class-only to Node-callable
  functions; parity pins name, arity, options, operations, prototypes, statics,
  and modern/legacy instance identity.
