# ADR 0498: Builtin ESM names include direct prototype methods

Status: Proposed
Date: 2026-10

> TL;DR: ADR-0348's "enumerable keys" builtin-name source is extended: non-function builtins also contribute own names (minus `constructor`) of their direct prototype, matching Node's named-export surface for class-backed builtins like `node:process`.

## Context

ADR-0348 (§2) sources builtin ESM named exports from the enumerable own keys of
the materialized rifty runtime object. Real Node exposes class-backed builtin
methods as named exports (`import { cwd } from 'node:process'` links and calls);
rifty's `NodeProcess` keeps those methods on the prototype, so enumerable-keys
collection link-threw where Node links — the vitest-run-in-browser epic hit this
on `cwd`/`nextTick`/`hrtime`/`uptime`.

## Decision

The single cjs-interop authority collects, for every non-function builtin, the
own property names of its DIRECT prototype (excluding `constructor`) in addition
to `Object.keys` of the instance. One collected set feeds both link validation
and namespace construction, so a name that links is present and a name absent
link-throws.

Function-valued builtins (`events`/`assert`/`stream` constructors) are gated
out: their prototype chain is `Function.prototype` / a parent constructor, and
`call`/`apply`/`bind`/inherited statics are not Node named exports — Node
link-throws on each, and so does rifty.

Recorded divergence (unchanged by this ADR): rifty's `NodeProcess` prototype
carries emitter overrides (`addListener`/`prependListener`/`removeListener`/
`removeAllListeners`) and `pushStdin`, which Node's named-export set does not
have; they remain importable. Tracked in `docs/public/compat/modules.md`.

## Consequences

- `import { cwd, nextTick, hrtime, uptime } from 'node:process'` links and
  matches Node; require-side and ESM-side see the same names (one authority).
- Prototype methods are exported UNBOUND: a named import of a method that
  touches private fields (`exit`) loses the receiver — known gap, backlog
  `runtime-js/named-process-export-receiver-binding`.
- Follow-ups: none owned here; per-builtin surface growth rides its own unit.
