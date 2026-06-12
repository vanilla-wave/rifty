# ADR 0132: TS ESM parity uses full-transform Node reference

Status: Accepted
Date: 2026-06

> TL;DR: `kind: 'ts-esm'` parity runs the Node side through vendored `tsx`,
> not Node native strip-only TypeScript, so both sides compare full TS
> transforms.

## Context

The parity runner's `ts-esm` mode compares rifty's esbuild-backed TypeScript
transform with real Node output. Node v24's native TypeScript support is
strip-only: it rejects runtime-codegen syntax such as `enum`, parameter
properties, and runtime `namespace`.

The gold `modules/ts-graph-cross-file.case.ts` case intentionally uses `enum`.
That is load-bearing coverage for rifty's full transform path: esbuild and `tsx`
lower it, while Node strip-only rejects it. Using strip-only as the Node oracle
would make the case fail because of a Node limitation, not a rifty behavior
difference.

## Decision

Always run `ts-esm` parity entries through the workspace-vendored `tsx` CLI on
the Node side. Do not branch on Node major version for native strip-only
execution.

The contract under test is full transform vs full transform. Native strip-only
coverage can be added later as a separate case kind if that becomes useful.

## Consequences

- Codegen TypeScript parity cases can stay in the gold runner.
- The runner no longer exercises Node native strip-only behavior.
- The Node reference now depends on the existing dev dependency `tsx`; no new
  dependency is added.
