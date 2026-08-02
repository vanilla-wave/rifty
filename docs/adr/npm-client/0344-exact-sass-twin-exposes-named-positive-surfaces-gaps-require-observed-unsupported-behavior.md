# ADR 0344: Exact Sass twin exposes named positive surfaces; gaps require observed unsupported behavior

Status: Accepted
Date: 2026-08

> TL;DR: exact `sass@1.100.0` backs a cleaned `sass-embedded@1.100.0`
> namespace; only named differential rows publish positive compatibility, and
> newly observed mismatches become RED-first parity defects or specific gaps.

Supersedes ADR-0310.

## Context

Sass is required scope of the shadow-substitution series. Exact Node v24.16.0
evidence compares public `sass@1.100.0` and `sass-embedded@1.100.0` with one
shared probe (`npm-client/reference/sass-1.100.0-node-differential.md`):

- module namespace, compile, source-map, initialized compiler lifecycle,
  importer, logger, error, `info`, and legacy rows record every observed value
  and identity;
- measured differences are the cleaned dart2js export namespace, `info`,
  exception message/toString prefix, null-to-undefined `span.url`, absolute
  exception/logger file frames, embedded's no-color default, compiler disposal
  outcomes (including async dispose resolution), initialized compiler
  constructor/prototype/method identity and lifecycle export accessors, and
  legacy logger/stderr routing;
- direct `Compiler` / `AsyncCompiler` construction starts a refed Dart child
  before exact embedded rejects and keeps Node alive, while pure Sass rejects
  and exits naturally; the exact CJS/ESM × sync/async process-group evidence is
  pinned in
  `npm-client/reference/sass-constructor-liveness-post-pickup-fork.md`;
- sync compile with an async importer is the one deliberate divergence: pure
  Sass throws synchronously while real embedded deadlocks permanently in two
  isolated process-group attempts;
- Vite 7.3.6 uses the matched async compiler path and the real Chromium carrier
  pins direct CJS/ESM plus dev, HMR, build, durable reopen, and offline replay.

The native embedded package carries a host plus platform Dart binaries. Pure
Sass has no platform package; its optional `@parcel/watcher` serves watch mode
only. Recipe v2 (ADR-0335) supplies exact admission, dependency projection,
materialized bin claims, provenance, and npm-owned collision settlement.

ADR-0310 also required every “unproven legacy/API surface” to throw a generic
named gap. That predicate is evidence metadata, not runtime state. CJS unknown
property reads, ESM static linking, exported class/instance identity, nested
methods, callbacks, Sass source, and option combinations cannot be wrapped by
one honest branch. A fixture whitelist would not support real programs; a
recursive throwing membrane would change reflection, identity, `instanceof`,
and working upstream behavior while still missing unenumerated inputs.

## Decision

- Pattern 1 remains: materialize an immutable synthesized
  `sass-embedded@1.100.0` facade over exact upstream `sass@1.100.0`. Acquire no
  embedded platform package or `@parcel/watcher`; create no runtime asset,
  binding, MessagePort server, Workbench adapter, or manager/store operation.
- Expose the exact cleaned CJS/ESM namespace and real upstream Sass behavior.
  Namespace presence is not a blanket compatibility claim: only the named Node
  differential and Chromium acceptance rows may publish positive compat.
- Adapt only measured differences: export namespace, `info`, exception
  message/toString and `span.url`, absolute file frames, the no-color default,
  initialized-compiler disposal and exported constructor/prototype identity,
  lifecycle export accessors, and legacy logger routing. Preserve public
  compiler method name, arity, descriptor placement, and stable identity.
  Preserve the async-importer synchronous throw as a documented warning instead
  of reproducing a permanent deadlock.
- Keep `Compiler` and `AsyncCompiler` as namespace, prototype, and `instanceof`
  anchors for instances returned by `initCompiler()` and `initAsyncCompiler()`.
  Their direct prototype and `constructor` identities match those anchors, and
  repeated public method reads remain stable.
  Direct construction in either module format synchronously throws
  `NotImplementedError('sass-embedded.compiler-construction-liveness')` before
  invoking the pure-Sass target or creating any active resource. It is compat
  failure, not a positive lifecycle claim or warning.
- Do not invent a generic “unproven API” branch. A newly observed mismatch with
  exact Node `sass-embedded@1.100.0` is a parity defect: add RED evidence, then
  adapt it faithfully or publish a specific compat failure and named
  `NotImplementedError` at its reachable boundary.
- Known unsupported surfaces stay exact: direct compiler construction throws
  `sass-embedded.compiler-construction-liveness`; every request other than
  literal `1.100.0` throws `sass-embedded.version`; CLI and watch execution
  throw `sass-embedded.cli` and `sass-embedded.watch`; TypeScript declarations
  are not published and remain compat failure without a fictitious runtime
  throw.

## Consequences

- The facade remains version-exact; widening requires new differential and
  integration evidence.
- The substitution avoids the embedded platform payload while retaining exact
  acquisition/materialization provenance and ordinary Sass dependency closure.
- Recipe v2's generic admission, projection, replay, and bin authorities remain
  the only generic source changes; generic code never recognizes Sass.
- Unknown nested behavior is neither silently advertised as parity nor rejected
  because a fixture omitted it. Findings follow the repository's RED-first
  fidelity process.
