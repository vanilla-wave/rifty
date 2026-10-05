# ADR-0495: Check dynamic global write keys at execution

- Status: accepted
- Date: 2026-10-01
- Extends ADR-0171's loader-owned routing; host Function mutations remain ceilings.

## Context

Vitest setup-common defines globals with a generic for-in loop. Default defines
is empty, but the static guard rejects the entire module. Real browser RED:
setup-common.DYx3LtFI.js esm-global-function-assignment; native Node loads it.

## Decision

Known Function writes stay static ceilings. Unknown computed global member writes
receive one private deferred key at the original key-evaluation position. Native
GetValue/PutValue controls ToPropertyKey timing; RHS precedes conversion for assignment.
Actual Function key throws before mutation.
ESM/CJS share the guard; each factory receives a collision-free private binding.
Unknown defineProperty/set/deleteProperty calls use the same key guard after
argument evaluation; only captured native intrinsics are accepted. defineProperties,
assign and legacy accessor mutation methods keep their finite ceilings.

## Alternatives

- Ignore dormant functions/empty loops: rejected; the same function can later mutate Function.
- Special-case Vitest/config.defines: rejected by I6/generic-runtime constraint.
- Check the actual computed key: chosen; executes safe branches without mutating host Function.

## Proof

Symbol/global-write suite: empty loop, safe defines, ToPropertyKey/RHS order,
unsafe Function and shadowed/mutable key cases; real Node differential + Vitest.
