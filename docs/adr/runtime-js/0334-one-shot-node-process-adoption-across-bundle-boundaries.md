# ADR 0334: One-shot Node process adoption across bundle boundaries

Status: Accepted
Date: 2026-07-27

> TL;DR: the Node-entry bundle adopts the kernel-installed `NodeProcess` once
> before guest entry; identity stays bundle-local and descendant control binds
> once to the Node-entry bundle's existing `ProcessManager`.

## Context

The production Worker build emits the kernel pre-entry hook and Node entry as
self-contained bundles. The first installs the ADR-0157 process, but the second
has separate runtime-js module state and its own nested `ProcessManager`.
Module-local bootstrap identity therefore vanished at that boundary:
recursive children skipped ADR-0326 federation, and the original process routed
descendant kill to the wrong manager. Development shared one module instance
and hid the failure.

A realm-global mutable authority would survive bundling, but guest code could
discover and rewrite it. Constructing a second process would restore the
split-brain rejected by ADR-0157; a second ledger would violate ADR-0326.

## Decision

Keep active process identity and overrides module-local. A spec-seeded
`NodeProcess` exposes non-enumerable, non-configurable `Symbol.for` receivers
for a frozen PID/PPID snapshot and a one-shot descendant-authority bind. The
receivers never expose the authority and reject rebinding.

`installNodeRuntime` binds its bundle-local `ProcessManager` before guest entry
for ordinary entries. A Node URL entry leaves that bind for
`node-entry-bootstrap`, which runs before guest import: it adopts the existing
process into its bundle-local identity map and binds the Node-entry bundle's
existing manager. A shared development bundle admits only the exact same active
federated process with its trusted identity; a different, untrusted, or already
bound process fails loudly.

The host-only `bindNodeProcessDescendantAuthority` and
`adoptNodeProcessBootstrap` adapters ship on the existing stable
`@riftydev/runtime-js/builtins/process` subpath. `node:process` resolution trusts
the module-local active binding rather than cross-bundle `instanceof`.

## Consequences

- Recursive production children retain one owner-root PID tree, and Ctrl-C
  reaches the manager that owns their physical Workers.
- No mutable realm-global authority, process swap, second process ledger,
  separate mutable handshake, or compatibility fallback ships.
- The versioned symbol names and two host adapters are stable cross-package
  protocol. An incompatible shape requires a new symbol version and atomic
  migration.
- Shared-module and duplicated-bundle tests are both required; production-built
  Chromium remains the acceptance proof.

Specifies ADR-0157's single seeded process across self-contained bundles and
ADR-0326's nested physical-manager ownership. Both otherwise stand.
