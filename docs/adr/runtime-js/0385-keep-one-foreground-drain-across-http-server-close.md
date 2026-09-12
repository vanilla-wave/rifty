# ADR 0385: Keep one foreground drain across HTTP server close

Status: Accepted
Date: 2026-09-08

## Context

ADR-0155 §2 permanently hands a listened foreground command to serve mode.
After Express consumes its self-response and closes, preview disappears but
command exit remains pending. Node v24.16.0 exits 0 with the same Express 4.21.2
program. Executed oracle and RED: `docs/backlog/runtime-js/reference/express-http-close-command-drain-evidence.md`.

## Decision

- One foreground lifecycle remains active after listen. Preview observation
  continues until terminal; returning entry starts the existing drain once.
- `awaitDrain` accepts optional `hasRef(): boolean`, a synchronous caller-owned
  handle query. Workbench supplies the current net registry. Zero runtime refs
  finish only when that query is false; errors/explicit exit still win first.
- No mirrored port refcount or cancel/restart drains. Registry events continue
  driving preview; existing host macrotask checks drive natural exit/one eval
  flush. Other timers/fetches retain ADR-0152/0158 semantics.
- Partially supersedes ADR-0155 §2 permanent serve handoff and ADR-0342's
  Workbench release-on-port requirement. The latter's runtime lease validation,
  first-terminal-wins and direct-terminal-before-drain guarantees remain.
  Template dev-server stop handles (ADR-0155 §1) remain separate.

## Alternatives and evidence

| Candidate | Disposition |
|---|---|
| Query current registry inside the existing drain | Selected: registry already owns truth; new RED proves checking after eval flush is too late |
| Subscribe ports into a mirrored runtime refcount | Rejected: duplicate owner/initial synchronization; net cannot import runtime-js; current registry already answers the query |
| Last close starts a new drain; listen cancels it | Rejected: releaseNodeEvalDrainOwnership only cancels eval leases; ordinary drains retain authority, requiring new cancellation/stale-result machinery |

Independent decision review: `/root/lifecycle_decision`, raw code/ADRs/finding.

## Consequences

Foreground file/eval commands naturally exit after final close and referenced
work. Preview remains available while listening. Public drain options gain one
query; no new counter, lease or state owner. This does not claim complete socket
or libuv handle accounting beyond the existing supported subset.
