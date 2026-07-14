# ADR 0260: Host-injected VFS mutation intents

Status: Accepted
Date: 2026-07

> TL;DR: every owner writer publishes one shared path-intent batch, then a
> host guard may fence its real mutation behind package trust invalidation.

## Context

Supervised Node `fs.*` calls and Shell builtins/redirections mutate the owner's
authoritative VFS through different packages. A write to `package.json`,
`node_modules`, or an ancestor can race install acquisition and leave a trusted
stamp describing different state. Policy inside runtime-js, Shell, or VFS
would create another package-state owner; separate descriptor unions would
drift and multi-path commands could split across FIFO slots.

## Decision

`@riftydev/vfs` owns the closed `VfsMutationIntent` vocabulary: `write`,
`mkdir`, `rm`, `utimes`, directional `rename`, and directional `copy`.
`VfsMutationGuard` receives a non-empty readonly intent batch plus the real
result-preserving `apply()` continuation. `guardVfsMutations` enforces the
contract: a fulfilled guard calls `apply()` exactly once; double, late, empty,
or fulfilled-without-apply use throws. Rejection before apply is valid and
fences the mutation when a durable demotion/revocation fails.

Each mutation producer parses/plans once and invokes the shared helper. Runtime
sync-RPC handlers send singleton batches and may return a promise so the reply
waits for the guard. Shell sends every path affected by one command/redirect as
one batch and therefore one FIFO operation. The playground alone classifies a
batch and routes package-sensitive mutations through its package-acquisition
authority; unrelated paths apply directly. No ambient install-depth flag or
generic policy state lives in the shared seam. Future install-owned lifecycle
children require an explicit per-child capability before lifecycle support can
be enabled; current unsupported lifecycles remain loud.

## Consequences

- Runtime and Shell share one exhaustive mutation vocabulary and guard law.
- A logical multi-path mutation cannot interleave between trust transition and
  apply; acknowledgement/result settles only after both.
- Adding a VFS mutation producer requires extending the union, producer tests,
  and the single host classifier.
- Conservative path-only classification may revoke trust before a mutation
  later fails; it never preserves a stale trusted claim.
