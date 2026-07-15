# ADR 0265: Owner-correlated preview readiness by PTY run

Status: Accepted
Date: 2026-07

> TL;DR: owner preview snapshots carry the exact admitted PTY session/run;
> Workbench proves readiness only for that pair plus the routed HTTP proof.

## Context

`ownerToken` proves which owner advertised a port, not which foreground run
created it. One owner may host sibling terminals. `ptySid` separates siblings
but is reused by sequential runs, so a stale prior advertisement can still
satisfy a new `ProjectRun.ready`.

The PTY actor already owns exact admission and exit as `(sid, rid)`. Adding a
second readiness generation or page-side guess would split that authority.

## Decision

- `PreviewPortEntry` carries `ptySid` and `ptyRid` together for every
  PTY-launched listening source. Both are absent or both are present.
- The PTY actor mints an owner-local opaque admission carrying the pair. Preview
  producers capture that admission when their child starts; registry APIs never
  accept a raw run id.
- Trusted session identity reaches producers out-of-band through a per-session
  closure/capability. Guest-mutable command env is never correlation authority.
- A late callback keeps its captured admission after exit. It never re-resolves
  the session id, so run A cannot be mislabeled as later run B in the same PTY.
- `ProjectTerminalRun` exposes its admitted pair only to the internal runtime.
  Vite/server readiness captures it, then accepts only an owner advertisement
  with the exact pair.
- Service-worker control and routed HTTP proof remain required after identity
  match. Owner token, port, source-local sid, cwd, or URL alone never prove run
  ownership.
- Generic Playground preview UI may display an uncorrelated non-PTY source, but
  such an entry cannot resolve Workbench run readiness.

## Consequences

- Sibling terminals and stale sequential runs cannot steal readiness.
- No new lifecycle authority: preview correlation is minted by the PTY actor.
- The internal preview protocol grows two fields; producer and consumer sibling
  sweeps cover dev-server, installed-bin, and Node listening sources.
