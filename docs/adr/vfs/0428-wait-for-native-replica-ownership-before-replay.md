# ADR-0428: Wait for native replica ownership before replay

- Status: Accepted
- Date: 2026-09-12
- Area: vfs

## Context

ADR-0425's native guard correctly excludes an old writer. Chromium 148's
busy Worker continues executing for ~2 s after `terminate()`; its guard is
released only then. Immediate admission refusal prevents SDK hard-stop
replacement. Independent DEC-2 probes: sync handle 2000.5 ms, Web Lock
2000.8 ms, exclusive writable 2001.9 ms; changing primitive or dropping
references/GC does not help. Live competitor stays refused.

## Decision

Retain ADR-0425's exclusive SyncAccessHandle and all real-settlement fences.
Guard acquisition has a separate deadline using the already captured
`ioReportTimeoutMs` (default 30 s). First attempt immediate; retry only
NoModificationAllowedError, every 25 ms. Other errors reject immediately.
Expiry rejects as OpfsPreloadError, including preferred; a late acquired
handle closes before it can publish anything. No memory fallback, steal,
lease transfer, extra owner or new public knob.

The existing ACTIVE drain watchdog still starts at admission and retains its
reporting/settlement semantics. Guard acquisition never enters the mutation
ledger. An outer SDK startup timeout remains authoritative when shorter.
Calling terminate or reaching a reporting timeout never proves release.

## Proof

Existing public no-COI agent hard-stop RED; native busy-Worker replay RED;
held native acquire deadline/late-close RED. Native held-I/O contention,
late successful drain, idle/fresh restore and permission refusal remain.
