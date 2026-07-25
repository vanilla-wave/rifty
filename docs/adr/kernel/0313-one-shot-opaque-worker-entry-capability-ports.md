# ADR 0313: One-shot opaque Worker entry capability ports

Status: Accepted
Date: 2026-07

> TL;DR: a URL Worker entry may carry one validated name-to-`MessagePort`
> record; kernel transfers it in the existing init transaction and privileged
> bootstrap consumes it once before importing guest code.

## Context

ADR-0308 confirms the #160 quarry's ADR-0300 capability carrier, but fresh
`main` contains neither its code nor a detailed active kernel ADR. The first
consumer transfers a verified esbuild runtime asset. It is too large for the
1 MiB sync-RPC ring and is neither stdio, Node IPC, environment data, nor
clone-only bootstrap metadata.

Publishing a non-enumerable global is not isolation: guest reflection can find
it. Kernel also cannot clear the value before the higher-runtime URL bootstrap
has adopted it. The handoff therefore needs an explicit one-shot consume before
the first less-privileged import. Adding the root API is irreversible and
requires this mainline decision.

## Decision

- Only the URL variant of `WorkerEntryDescriptor` accepts
  `capabilityPorts?: Readonly<Record<string, MessagePort>>`. Source entries do
  not. Before allocating spawn resources, kernel snapshots a plain or
  null-prototype record of own enumerable non-empty string data properties.
  Accessors, enumerable symbols, non-ports, and a port reused under two names
  throw a key-specific `TypeError`.
- Kernel owns the validated child endpoints. Caller mutation cannot change the
  normalized entry. Each port is transferred once in the existing init message
  after stdout, stderr, stdin, and fork IPC; there is no second post protocol.
- Spawn stays one resource transaction. Allocation, attach, init-post, or
  listener failure terminates the Worker, detaches the ring, closes every
  created/adopted port, publishes no process record, and rethrows the original
  error.
- Child bootstrap publishes a frozen null-prototype snapshot before pre-entry.
  Absence/empty means no own global. The package root exposes only
  `consumeKernelEntryCapabilityPorts()`: it validates, deletes the global, then
  returns a frozen snapshot; repeated consume returns canonical empty. The
  publication key, publisher, and non-consuming diagnostic read stay private.
- A guest-bearing higher-runtime bootstrap must consume before importing guest
  code, bind known ports in lexical scope, and close unknown ports. Kernel never
  interprets names or frames and never projects capabilities into process,
  env, stdio, IPC, or descendants.
- Failed setup and run-to-completion close capability ports with stdio. A clean
  `serve:true` entry keeps them live; the owning higher protocol handles normal
  disposal and the caller owns peer-session cleanup on spawn failure,
  exit, or kill.

## Consequences

- Kernel gains one generic public carrier without shadow-registry or esbuild
  knowledge.
- Privileged bootstrap can remove ambient authority before guest evaluation.
- Every finite guest-bearing URL bootstrap needs a consume-before-import
  contract; omission is a security/correctness defect.
- Protocol readiness, correlation, cancellation, deadlines, and peer-death
  settlement remain higher-layer concerns.
