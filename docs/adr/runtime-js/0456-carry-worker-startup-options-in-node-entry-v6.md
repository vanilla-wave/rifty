# ADR 0456: Carry Node child startup options in node-entry v6

Status: Accepted
Date: 2026-09-23

> TL;DR: one immutable child execArgv vector crosses the typed startup envelope; one runtime owner applies its supported semantics before entry.

## Context

Both accepted Vitest pools pass --require, --conditions and
--experimental-import-meta-resolve. Native probes prove preload order/cache,
package condition selection, resolver parentURL behavior and recursive trusted
inheritance; echoing argv or ignoring flags is insufficient.
[Contract/evidence](../../backlog/runtime-js/worker-threads-startup-options.md).

Current rifty.node-entry/v5 accepts exact program/worker-thread fields without
execArgv. Worker rejects this; fork accepts then loses every effect.
NodeProcess initializes Worker argv to []; resolver conditions are
fixed; import.meta.resolve ignores a second argument. Kernel already carries
the Node envelope atomically and opaquely. ADR-0267 forbids permissive schema
growth; ADR-0339 separates trusted launch identity from public process state.

## Decision

Supplement ADR-0267/0339's launch boundary; retain their owners and exclusions.

- Atomically migrate all producers/readers to rifty.node-entry/v6. Add required
  readonly execArgv to exact program and worker-thread variants; eval retains
  its current fields and meaning. Empty vectors are explicit. No v5 fallback.
- At construction, snapshot an explicit override. For an omitted override,
  Worker uses the trusted parent's vector; fork reads current public
  process.execArgv, matching its native JS producer. Both copy the selected
  vector before asynchronous work. Unsupported families remain named gaps.
- One runtime-js startup-options owner parses supported --require operands,
  repeated --conditions operands and --experimental-import-meta-resolve.
  Preserve the original ordered vector. Derived conditions/preloads/flag are
  local policy, not separately transported or guest-global configuration.
- Worker validates supported syntax before physical allocation. Fork has a
  different operand boundary: native appends modulePath after execArgv. This
  unit accepts its well-formed supported vectors; malformed fork vectors keep
  a named ceiling rather than a fabricated Worker usage error. Unsupported
  families remain loud; no option is silently dropped.
- After the child's process/loader installation and before user entry, run CJS
  preloads through that loader in argv order. Native module cache and failure
  propagation remain authoritative. No package-specific bootstrap or preload
  source replacement.
- The loader uses the same immutable startup policy for require/import/export
  conditions and import.meta.resolve's optional parentURL. Recursive Workers
  inherit it; explicit [] returns to default policy.
- Existing ordered init, Worker/fork error/exit, keepalive and teardown owners stay
  unchanged. No acknowledgement, retry, polling or second lifecycle owner.

## Consequences

- (+) Both exact pool forcing paths gain real startup semantics; producer-specific
  inheritance and guest env remain faithful.
- (-) Atomic v6 migration touches every typed entry producer and decoder.
- (-) This supported child subset does not implement CLI preload contexts,
  Worker eval/data entries, other argv spellings or arbitrary Node flags.
- Independent Contract+RED must pass before implementation; this ADR remains
  proposed until that review resolves the new typed boundary.
