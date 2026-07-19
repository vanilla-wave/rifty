# ADR 0296: Bind child shadow-asset clients to immutable runtime adapters

Status: Accepted
Date: 2026-07

> TL;DR: an admitted child binds its shadow-asset port client to one immutable
> builtin runtime-adapter/version descriptor set; the parent keeps the exact
> install plan and the existing port frames stay unchanged.

## Context

ADR-0249 gives each admitted child one exact-plan-scoped MessagePort, but the
public `createShadowAssetPortClient` currently also requires that plan in the
child. The exact plan contains applied-substitution facts such as the requested
range. A child cannot reconstruct those facts from an executed Vite package,
and reading mutable project manifest/lockfile bytes after admission would race
the owner epoch and invent a second planner.

ADR-0266 deliberately transfers only opaque ports. ADR-0267 and the runtime-
asset cutover keep node-entry/v2 host bootstrap free of plans, receipts,
capability data, and guest environment keys. Sending a plan in either channel
would undo those decisions. Adding a plan handshake would change the already-
accepted MessagePort framing even though runtime consumption needs only the
descriptor bytes for its bundled adapter.

## Decision

Keep `startShadowAssetPortServer({port,plan,reader})` unchanged. The parent
session remains scoped to the exact immutable plan captured by package
admission and rejects every asset id outside it.

npm-client adds one public builtin-only client initializer. Its input is a
`MessagePort` plus exact value data
`{runtimeAdapterId,resolvedPublicVersion}`. Before adopting the port it resolves
that binding against the immutable builtin catalog, snapshots the resulting
descriptor set, and rejects an unknown binding loudly. It accepts no plan,
required-set digest, receipt, manifest, lockfile, storage, or callback.

The child client admits only ids in that descriptor set and verifies result id,
member hash, byte length, and bytes against those descriptors. The parent
server independently admits only ids in its exact plan, so effective authority
is the intersection of the admitted plan and the owner-bundled runtime adapter.
A different plan that does not contain the requested descriptor fails through
the existing typed `unknown-asset` path. A plan with different non-runtime
substitution facts but the same exact descriptor remains behaviorally
equivalent to the runtime consumer; the child is not a lockfile-provenance
observer.

The existing `rifty.shadow-assets/v1` read/progress/result/error/cancel/dispose
frames and plan-taking initializer remain unchanged. Binding-mode progress
validates exact frame shapes but treats plan-wide digest, count, ordering, and
unrelated asset ids as opaque; only the plan-taking client compares those facts
because only it possesses the full plan.

Workbench owns the executable adapter and its exact binding constant. It reads
the already-published capability before Vite import, constructs the bound
client only for the exact Vite 7 adapter, passes its least-authority reader into
runtime preparation, and disposes it after preparation or failure. Vite 8
constructs no client. Recursive children receive no capability automatically.
No external catalog, executable adapter registry, or callback interface is
introduced.

## Consequences

- Child bootstrap stays free of installer provenance while verified bytes keep
  two independent checks: parent plan authority and child adapter descriptors.
- npm-client remains the single MessagePort framing/catalog projection owner;
  Workbench neither copies frames nor parses package metadata into a plan.
- The public npm-client surface grows by one builtin-only initializer and value
  type. External runtime adapters remain unsupported and require a later ADR.
- Runtime consumers cannot compare the parent's full required-set digest by
  design; exposing that provenance would require a separately decided protocol.
