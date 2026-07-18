# ADR 0285: Expose one Workbench health and recovery authority

Status: Active
Date: 2026-07

> TL;DR: expose one replaying Workbench health/recovery authority; operational
> SCM, preview, and persistence failures degrade visibly, while only invariant
> corruption is fatal.

## Context

Workbench currently has several incompatible failure policies. A transient SCM
refresh or preview control proof can terminate the owner, persistence may lose
durability proof without changing the UI, and an idle owner exit has no durable
page signal. App-local toasts cannot replay, deduplicate, heal, or preserve the
distinction between unavailable capability and corrupted protocol state.

Adding `scm.error`, `preview.error`, and `storageDegraded` would create three
state owners and three recovery policies. Boot failure is earlier than a
Workbench value and therefore remains a persistent host lifecycle state.

## Decision

Add one public view to `Workbench` and `PlaygroundSessionTools`:

```ts
interface WorkbenchHealth {
  snapshot(): WorkbenchHealthSnapshot;
  subscribe(listener: (snapshot: WorkbenchHealthSnapshot) => void): () => void;
  recover(scope: WorkbenchRecoveryScope): Promise<void>;
}
```

Both properties view one page-side authority. The session view is scoped to its
project generation and closes with the session; it is not a second store.

Issues are typed as `degraded`, `unavailable`, or `fatal`. Degraded scopes are
`scm`, `preview`, and `persistence` and carry a retry recovery scope. Unexpected
owner exit is unavailable and recommends reload. Fatal is reserved for malformed
frames, impossible correlation, journal gaps, and other invariant corruption.
Snapshots are immutable, replayed, deterministically ordered, and aggregate by
`fatal > unavailable > degraded > healthy`. Public summaries redact owner paths,
tokens, and protocol identifiers.

The authority owns exact scope replacement, recovery coalescing, listener
isolation, generation fencing, first-fatal-wins, and cleanup. Reporters cannot
request fatal unless their type is the invariant adapter. A successful full
SCM read, preview proof, or clean durability flush removes that scope's issue.
Automatic SCM retry waits for a newer revision or explicit recovery; it cannot
spin on the same failed revision.

Persistence degradation requires structured owner provenance from a completed
flush. A timeout, closed handle, owner exit, or transport failure is never
relabelled as storage loss merely because it interrupted `awaitDurability()`;
its own owner/transport disposition remains authoritative.

The app renders health persistently. Boot uses the same presentation vocabulary
but stays `opening | boot-failed | open`, because no public Workbench exists yet.
This refines ADR-0278 preview failure blast radius, ADR-0165 storage fallback,
ADR-0281 durability proof, and ADR-0271 control-proof revocation without changing
their ownership decisions.

## Consequences

- Operational faults no longer brick unrelated Workbench capabilities.
- One public seam owns visibility, replay, healing, and recovery ordering.
- Protocol corruption remains loud and owner-fatal.
- The API is an intentional public addition; every worker/page observation needs
  generation and correlation validation before it reaches the authority.
- Boot retry remains host-owned; augmenting the opening Promise with partial
  health state is rejected.
