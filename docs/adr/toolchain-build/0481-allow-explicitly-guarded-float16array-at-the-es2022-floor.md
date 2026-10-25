# ADR 0481: Allow explicitly guarded Float16Array at the ES2022 floor

Status: Accepted
Date: 2026-09

## Context

ADR-0469 refuses unconditional post-ES2022 builtins; feature-detected exceptions
are named. PR #353's advanced IPC codec already captures Float16Array only if
available, via a filtered constructor table. Integrating PR #362's floor gate
reports that safe lookup in eight emitted bundles; it also rejects `typeof globalThis.Float16Array === 'function'` itself. Removing the global before
importing the real codec still round-trips Uint8Array (independent probe).

## Decision

Add exactly `Float16Array` to ADR-0469's named feature-detected exceptions;
ES2022 remains the floor. Reuse the existing Atomics.waitAsync guard analysis,
parameterized by feature identity. A read/construction is allowed only at a
positive local `typeof … === 'function'` guard. Safe global-property extraction
may be immutable with every use guarded; bare identifier extraction requires
a preceding guard because an absent global otherwise throws ReferenceError. Opposite/unrelated/shadowed guards and deferred
closures remain refused; bare constructor extraction cannot bypass the check.
Readonly constructor-table capture also accepts a non-undefined typeof guard,
including esbuild's equivalent `typeof C > "u"` false branch. Direct invocation
still requires the callable guard; read permission is not constructor permission.
A discarded global-property lookup left by minifying an unused typeof probe
is safe without the constructor; it cannot invoke or retain it. Static/prototype
post-floor methods retain their existing refusals.

Make the codec's availability check explicit before its constructor enters the
table. Preserve Float16 messages on capable hosts and absence-safe ordinary
views elsewhere. No bundle/file waiver, computed-property escape, or polyfill.

## Alternatives and proof

- Drop Float16 support: loses ADR-0448's existing Node value table.
- Accept any constructor-table filter: requires new general data-flow analysis.
- Runtime guard alone: executed checker still reports both guarded lookups.
- One named feature plus the existing local-guard analyzer: selected.

RED: `pnpm test:run tools/checks/es-floor-float16.test.ts`, 7 failures before
changes (safe guards refused; bare extraction missed; emitted codec refused).
Positive/negative cases run through the real scanner, including minification;
the actual emitted codec's guard-removal mutant must fail.
