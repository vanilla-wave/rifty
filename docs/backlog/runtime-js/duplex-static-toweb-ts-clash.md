---
area: runtime-js
status: ready
title: Duplex.toWeb static-side TS clash with inherited Readable.toWeb
created: 2026-07-01
why: The published @riftydev/io declaration fails consumer typecheck because Duplex.toWeb and Readable.toWeb have Node's incompatible return shapes on one TypeScript static inheritance side
user_story: As a Workbench package consumer, I want a strict TypeScript project to import the packed rifty graph, but today @riftydev/io/dist/index.d.ts fails TS2417 unless I hide dependency errors with skipLibCheck.
sources: [packages/io/src/streams/duplex.ts]
code: [packages/io/src/streams/duplex.ts, packages/io/src/streams/readable.ts]
---

## Context

`Duplex extends Readable`. Both expose static `toWeb`. Node's `Readable.toWeb(r)`
returns a `ReadableStream`; Node's `Duplex.toWeb(d)` returns `{ readable,
writable }`. TS's class-static-side check (TS2417) requires `typeof Duplex` to be
assignable to `typeof Readable`, which fails on the incompatible `toWeb` RETURN
types (a covariance violation, not fixable by widening params).

`fromWeb` (param divergence) and `from`/`compose` were reconciled at source level,
but the suppression survives as an invalid emitted class declaration. The real
packed Workbench consumer runs `tsc` with `skipLibCheck:false` and exposes that
published failure.

## User scenario

A Vite embedder installs the packed `@riftydev/workbench` tarball and its packed
rifty dependencies from the local acceptance registry, imports the public
Workbench API, then runs strict `tsc`. Typecheck succeeds without `skipLibCheck`;
at runtime `Duplex` still has Node's exact Readable constructor/prototype chain
and distinct WHATWG pair static.

## Acceptance

- `RIFTY_PACKED_CONSUMER_REGISTRY_PORT=54321 pnpm test:packed-consumer` passes,
  including its strict tarball-consumer typecheck.
- `pnpm --filter @riftydev/io typecheck` and the emitted declaration build pass
  with no `@ts-expect-error` for the Duplex class static side.
- `pnpm test:parity -- --filter stream/duplex-web-bridge` preserves the runtime
  reflection and bridge oracle against Node.

## Reference contract

- Oracle: Node.js v24.16.0 `node:stream`; declaration shape cross-checked with
  `@types/node` 22.19.19.
- Mechanism: runtime `Duplex` inherits the exact `Readable` constructor value;
  declaration inheritance omits only the three Duplex-owned bridge/source
  statics before declaring their Node-specific signatures.

## Parity cases

1. `new Duplex()` is an `instanceof Duplex` and `instanceof Readable`;
   `Object.getPrototypeOf(Duplex) === Readable`,
   `Object.getPrototypeOf(Duplex.prototype) === Readable.prototype`, and the
   constructor name remains `Duplex`.
2. `Readable.toWeb(readable)` returns one WHATWG `ReadableStream`, while
   `Duplex.toWeb(duplex)` returns the exact `{ readable, writable }` pair.
3. Duplex keeps its own `from`, `fromWeb`, and `toWeb` statics; unrelated
   Readable/EventEmitter statics remain inherited through the runtime
   constructor chain.

## Out of scope

No runtime stream input changes. Existing `stream.Duplex.fromWeb.signal` and
terminal-lifecycle gaps remain loud `NotImplementedError`/compat ❌ under their
existing backlog contracts.

## Decisions

- Introduce one private constructor carrier typed as
  `Omit<typeof Readable, 'from' | 'fromWeb' | 'toWeb'>` plus Readable's construct
  signature; its runtime value is exactly `Readable`.
- Keep a real class declaration and the runtime constructor/prototype chain; do
  not switch to factories, declaration post-processing, or a second runtime
  class.
- Do not widen either `toWeb` return to a union and do not enable
  `skipLibCheck`; both would hide the incompatible Node contracts instead of
  expressing them.

## Reversibility

REVERSIBLE — declaration representation only; runtime behavior and public
method signatures stay unchanged. No ADR.
