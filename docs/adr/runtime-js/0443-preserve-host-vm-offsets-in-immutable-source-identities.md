# ADR 0443: Preserve host vm offsets in immutable source identities

Status: Accepted
Date: 2026-09

Host vm offsets travel in evaluator source identity; the existing stack
remapping owner projects positions when a stack is consumed. Extends the
host-realm `runInThisContext` seam of ADR-0142; sandbox engines stay unchanged.

## Evidence and alternatives

Native Node v24.16.0 + commands/output:
`docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md`.

- Source padding (minimal interface): rejected by negative line/column REDs.
- Scoped stack wrapper / filename-keyed registry: rejected by returned-function,
  lazy Error.stack and repeated-filename REDs; cannot own escaped lifetime.
- Immutable sourceURL carrying filename/offsets: selected. No retained per-script
  map; every native frame carries its own provenance. JSON+URI encoding preserves
  punctuation and lone surrogate filenames.

Mechanism sweep: `module-loader/source-maps.ts` already owns prepareStackTrace;
`esm-job-evaluation.ts` uses its scoped loader map. No second stack dispatcher.

## Decision

Direct host evaluation and Script constructor offsets share validation and
source identity. Script run options cannot replace constructor positions.
Line offsets affect all lines; column offset only physical line one. Signed
positions remain signed; native CallSite getters return null for nonpositive
positions. Sandbox and compileFunction offsets retain their loud ceilings.

The existing stack dispatcher remains installed after an offset evaluation:
functions and Errors may outlive its call. Select vm or loader position mapping
per native CallSite, so a loader's same public filename cannot rewrite an
independent script. Project filenames/positions before an installed renderer:
Vite 8.0.16 resolves source maps from those getters. Preserve non-string custom
renderer results; capture prior hooks immutably so a guest wrapper cannot form
an accidental recursive chain.

## Limits

A subsequent user assignment/deletion of Error.prepareStackTrace replaces the
hook until the next vm offset evaluation. Late stacks during that interval
expose encoded evaluator coordinates. Exact executable probe and Vitest
relevance are recorded in the evidence; this is an unresolved fidelity gap,
not a claim of arbitrary stack-hook lifecycle parity. No accessor that changes
property identity is introduced to hide it.
