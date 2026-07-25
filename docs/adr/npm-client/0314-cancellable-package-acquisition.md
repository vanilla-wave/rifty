# ADR 0314: Cancellable package acquisition

Status: Accepted
Date: 2026-07

> TL;DR: caller-owned cancellation enters through `InstallOptions.signal` or a
> direct `RegistryRequestOptions.signal`; npm-client carries it through every
> owned acquisition wait and never converts abort into Eddy fallback,
> optional-dependency skip, or retry.

## Context

Workbench project close aborts the active terminal command. The npm shell
observed that signal only immediately before and after `install()`, while
registry header/body waits, retry backoff, tarball fetches, and Eddy attempts
could remain live. Close therefore could wait for the network stall ceiling
instead of settling from its causal project death.

Cancellation belongs at npm-client's existing acquisition chokepoints. A
Workbench-only race would release its package FIFO while registry work still
ran and could later mutate caches/tree state.

## Decision

- Add optional public `InstallOptions.signal`.
- Add public `RegistryRequestOptions`; `RegistryClient.getPackument()` and
  `getTarball()` accept an optional request-options argument. Its `signal`
  cancels direct registry use; tarball-only `maxBytes` retains an explicit
  per-request body bound.
- Forward it to registry packument/tarball requests, bounded Eddy header/body
  reads, streamed bundle reads, and prefetched-response waits. Check it between
  resolve, link, shim, and lockfile phases.
- Preserve the caller's abort reason. Once aborted, do not retry, fall back
  from Eddy, or classify the failure as an optional dependency.
- Cancellation is cooperative for synchronous/local work already executing.
  The install claim remains untrusted on failure; a later explicit install
  reconciles the tree.
- Omitting `signal` preserves the existing API behavior and bounds.

## Consequences

- Project close can terminate a hung package acquisition promptly without
  releasing package admission ahead of the install's settlement.
- Standalone installer and direct `RegistryClient` consumers gain the same
  cancellation contract; omitted request options preserve prior calls.
- An abort after linking starts may leave an untrusted partial tree; this is
  loud and repaired by the next install, never stamped as ready.
