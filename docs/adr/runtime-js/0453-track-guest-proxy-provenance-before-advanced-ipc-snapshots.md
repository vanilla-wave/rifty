# ADR 0453: Track guest Proxy provenance before advanced IPC snapshots

Status: Accepted
Date: 2026-09-23

> TL;DR: Track guest Proxy creation before entry; reject before the advanced snapshot touches it, retaining Buffer/getter fidelity.

## Context

ADR-0446 requires Buffer identity, one getter evaluation and native clone
failures. The custom graph snapshot erased Proxy provenance, invoking traps
and admitting values Node rejects. Raw native structured clone rejects Proxy
but loses Buffer versus Uint8Array, including getter-returned Buffer; a second
walk repeats getters. Native/physical RED and alternatives:
[evidence](../../backlog/runtime-js/reference/advanced-ipc-proxy-provenance-evidence.md).

## Decision

Supplement ADR-0446; its full graph/getter promise remains.

- One realm owner captures native Proxy/clone/reflection primordials before
  guest entry. Global Proxy/revocable facades record guest creations privately;
  delegated Function.prototype.toString preserves native reflective source.
  Native clone of a recorded Proxy supplies rejection without executing traps;
  strip Chromium's WebIDL operation prefix from the native clone error.
- Trusted runtime Proxy construction uses the captured native constructor.
  The 14-site sweep separates semantic guest Proxies from implementation
  wrappers; ordinary wrappers must not become uncloneable merely because their
  carrier uses a Proxy.
- Duplicate production bundles acquire the same private authority during
  bootstrap. Acquisition seals before guest entry; no raw constructor or
  provenance-marking capability can then be obtained through the shared owner.
  Weak collection/Reflect operations are captured, not read from mutable guest
  prototypes. This synchronous phase boundary exists for the actual separate
  pre-entry/node-entry bundles, not general metaprogramming isolation.
- QuickJS semantic provenance belongs to trusted pre-eval bootstrap and a
  host-retained metadata handle, never a guest-visible checker/marker. Membrane
  host-origin identity wins before guest classification; guest wrapper marking
  retains its existing reverse-handle/GC owners. Native slot dispatch preserves
  actual exotic backings independently of their realm or prototype.
- `module.builtinModules` uses a real frozen dense snapshot shared by both
  module export surfaces, refreshed when registered names change. Empty-target
  virtual arrays are a builtin-owner defect, not a codec exception.

Rejected: native-clone plus a binary ceiling would weaken the accepted Buffer
promise; snapshot then native validation duplicates getter effects and already
erases Proxy provenance. Full engine replacement is much broader than the
observed ingress. No public `util.types.isProxy` expansion.

## Consequences

- (+) Host guest Proxy/revocable/revoked failures precede traps and preserve channel health.
- (+) Buffer/getter controls retain the unchanged codec, including global Buffer.
- (-) New realm bootstrap owner and constructor facades require Node/Chromium proof.
- VM Proxy ingress and Map/Set carriers share the existing membrane owner.
  Older retained-mirror mutation and missing exotic-mirror gaps remain explicit
  in compat and their backlog drafts; the codec snapshots its actual host input.
