# ADR 0377: No-COI resident tool and restart lifecycle

Status: Accepted
Date: 2026-09-04

> TL;DR: the generic no-COI Worker starts one caller-selected resident bin;
> the SDK owns its page preview bridge and explicit whole-realm restart.

## Context

ADR-0375 owns one generic Worker/VFS/runtime and completion-oriented
`install`/`runBin`; ADR-0376 owns their finite operation slot. Goal I4/I6/I10
adds a different lifetime: an installed bin listens after its launch returns,
agent writes drive its watcher, and a CPU-wedged realm can only be terminated
from the page. The existing cross-realm HTTP/WS and SW owner bindings already
carry preview traffic; no new transport is needed.

The restart must restore registry-attested runtime bindings without a hidden
network reinstall. It also reports whether a public `fs.writeFile` lacked its
flush acknowledgement when the old Worker ended. This is a signal, never a
workspace transaction or recovery claim.

Mechanism sweep:

- ADR-0376's Worker boolean remains the sole finite-frame admission slot;
  resident execution outlives its successful start result and does not hold
  that slot;
- runtime host maps correlate finite requests and settle peer death; the SDK
  lifecycle wrapper owns only generation replacement and public callbacks;
- net port registry, BroadcastChannel bridge and SW owner binding remain the
  existing preview authorities;
- package/stamp FIFOs, PTY/session gates and OPFS schedulers own other scopes;
  none can reboot this public sandbox or report its pending host write.

Candidates:

1. Keep one Worker; add `startBin`, page-owned preview wiring and explicit SDK
   restart with a host-held activation snapshot. Chosen: smallest interface,
   preserves one VFS/runtime and needs no network or durable journal.
2. Reuse the COI Workbench child-process fabric. Rejected: its SAB-backed
   process topology is unavailable on the target page.
3. Spawn a Worker per resident tool. Rejected: loses the one authoritative
   VFS/runtime and introduces unproven cross-Worker coherence.
4. Require callers to rebuild the sandbox, reinstall and mount preview pieces
   manually. Rejected: does not deliver the I6 restart/death/dirty surface and
   hides network retry in application code.

## Decision

1. `SandboxToolchain.startBin({cwd,binPath,args,port})` validates/copies exact
   caller fields, starts that installed launcher, waits for the requested port,
   mounts the existing page→SW→Worker HTTP/WS bridge, then resolves
   `{port,previewUrl}`. Package identity/version never selects this path. One
   resident bin per Worker; a second start fails loudly.
2. Successful install leaves an exact host-held activation snapshot. A new
   Worker receives and validates that snapshot before resident restart; no npm
   call, persistent manifest, retry, queue or replay is added.
3. `ToolchainSandbox.restart({preview,beforeStart?})` is the sole generation
   replacement owner: terminate, boot one Worker, restore activation, run the
   optional repair callback through the new `RuntimeFs`, restart the resident
   request, then assign a cache-busted preview URL to the supplied iframe-like
   `{src}` target. Concurrent restart rejects; wedge detection stays caller-
   owned.
4. `onLifecycle` emits `worker-death` only for an unexpected Worker exit, not
   explicit restart/dispose. The event and the next restart report carry
   `unflushedWrites`, set when a public `fs.writeFile` was pending at peer end;
   a settled write reports false. The marker promises no rollback or repair.
5. Existing cross-realm preview/SW protocols, OPFS backend, install/run
   admission and Worker terminal settlement remain unchanged. Resident late
   errors surface through the existing Worker death path.

## Consequences

- Shared-memory-free installed dev tools get one generic resident lifecycle;
  Vite 7 is only the end-to-end HMR fixture.
- Explicit restart recovers an alive-but-blocked realm and visibly reloads the
  preview; automatic detection/reconnect remains absent at tier `works`.
- Runtime activation state survives only this page-owned restart object. Full
  page reload promises the flushed tree, not automatic resident restoration.
- The dirty marker covers unacknowledged public writes only; no journal,
  exactly-once, crash consistency or hidden retry is claimed.
