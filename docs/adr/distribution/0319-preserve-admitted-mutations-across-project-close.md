# ADR 0319: Preserve admitted mutations across project close

Status: Accepted
Date: 2026-07
Refines: ADR-0273, ADR-0292

> TL;DR: A conditional ProjectFiles mutation handed to the owner before
> `ProjectSession.close()` keeps its exact terminal outcome; close waits for
> settlement instead of rewriting it as a closed-handle failure.

## Context

[ADR-0273](0273-workbench-files-and-documents-handle-contract.md) defines
conditional file mutations: success requires owner ACK, reflected revision,
then applicable durability. It does not decide what happens when
`ProjectSession.close()` starts while that chain is pending.

Two observable contracts are plausible. Close could cancel the pending public
promise even after the owner accepted the mutation, or it could fence later
work while preserving the admitted mutation's exact result. The former can
report failure for bytes that were durably written. It also contradicts the
existing coordinator, Files, and transport contracts. A browser golden retained
that timing-dependent rejection until the one-shot owner transport let the
terminal arrive before teardown; changing only that golden exposed the missing
decision record.

The boundary is one live page↔owner MessagePort: messages are exactly-once and
ordered while both peers live; peer death loses all inflight work. A local
close or timeout cannot prove that an earlier owner mutation was not applied.

## Decision

**Admission.** A conditional `writeFile`, `mkdir`, `rename`, or `remove`
mutation is admitted when validation has passed and
`VfsCommitCoordinator.commit()` has synchronously handed its request to the
captured owner. A public mutation call reaches that handoff before returning
its pending Promise.

**Close ordering.** A mutation admitted before `ProjectSession.close()` keeps
the exact outcome from its owner-bound ACK/reflection/durability chain.
Coordinator close rejects future commits and cancels pending work not yet
handed off; it does not cancel or reclassify handed-off work. Content transport
close waits until every admitted commit settles. The mutation Promise owns its
success or failure; session close waits for settlement but neither duplicates
nor rewrites that result.

`ProjectSession.close()` first performs clean-document preflight, marks the
session closing, and drains private companion-tool hooks. Only then does
content close fence Files/Documents and start core teardown. This decision does
not claim that `session.files` is fenced at the instant `session.close()`
returns. It guarantees the reviewed direction—work admitted before close keeps
its outcome—and creates no admission promise for calls started after close.

An alive owner observes the earlier mutation frame before the later project
close frame and drains the mutation before its project VFS closes. Owner death,
port loss, a missing terminal, invalid owner evidence, reflection timeout, and
durability failure remain exact mutation failures. Applied evidence still maps
to `mutationOutcome: 'applied'`; otherwise the outcome stays `unknown`.
`ProjectSession.close()` may still fulfill after that separately observed
mutation rejects.

Reads are not conditional commits and gain no drain guarantee here. Document
saves retain the separate admitted-save rule in ADR-0273. Runtime, terminal,
catalog, SCM, archive, and TypeScript teardown keep their existing owners.

## Contract and RED/GREEN evidence

These executable contracts are the RED guards: restoring close-wins
cancellation makes them fail. They are GREEN for this decision:

- [coordinator close preserves an admitted owner outcome and rejects a later commit](../../../packages/workbench/src/glue/vfs-commit-coordinator.fault.test.ts);
- [Files close fences every sibling operation without rewriting an admitted write](../../../packages/workbench/src/workbench/project-files.contract.test.ts);
- [content close drains an admitted commit through reflection and durability](../../../packages/workbench/src/workbench/project-content-transport.test.ts);
- [browser owner loss rejects an admitted write promptly without making project close fail](../../../packages/workbench/src/workbench/workbench-browser-owner.test.ts);
- [browser companion close/reopen proves the fulfilled write's exact bytes](../../../tests/browser-unit/workbench-playground-companion.spec.ts).

Sibling sweep: every conditional Files mutation uses the same coordinator
chokepoint; the guards exercise write and mkdir plus the common post-fence
surface. The owner-loss proof covers the only MessagePort terminal-loss branch.

## Fault matrix

| fault × operation | exact outcome / proof |
|---|---|
| `observable-order` × admitted mutation then close | earlier owner frame retains ACK/reflection/durability outcome; close waits |
| MessagePort peer death × admitted mutation | exact mutation failure; no timeout wait or fabricated success |

## Consequences

- Applied mutations cannot be reported as canceled merely because close raced
  their terminal delivery.
- Close may wait for an admitted mutation's reflection, durability, or honest
  failure.
- Mutation and close remain separate promises with separate failures; neither
  substitutes for the other.
