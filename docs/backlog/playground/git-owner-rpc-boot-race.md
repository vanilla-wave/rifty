# git owner RPC: boot race silently drops early request frames

Status: draft
Area: playground

## Symptom

The page-side git bridge (`glue/git-owner-port.ts`) posts request frames on a
BroadcastChannel as soon as the SCM panel mounts. The owner attaches its
listener only after `bootShellOwner` reaches "pty server ready". A frame sent
in that window is DROPPED (BroadcastChannel has no replay) — the page request
parks until its 15s timeout and logs `[scm] read failed git owner RPC request
git<N>-… timeout after 15000ms`.

Pre-existing on main (not PR-125-caused): passing runs finish before the 15s
timeout fires, so the warning never surfaces; slow boots show it in traces
(observed while diagnosing the PR-125 scm e2e blocker — git1/git2 never arrive
at the owner, git3+ are served instantly).

## Why it matters

The SCM panel's first status/branch read waits 15s for nothing on any boot
where the panel mounts before the owner serves — dead SCM UI window + a
misleading "read failed" console warning.

## Acceptance

- A git RPC issued BEFORE the owner bridge is live is answered as soon as the
  bridge attaches (ready-handshake or replay-on-attach) — no 15s dead window;
  RED first: a test that issues a request pre-attach and asserts it resolves
  promptly after attach.
- No silent drop path remains: a frame that can never be served rejects loudly.

## Decisions

- Reuse the correlated-bridge scaffold consolidation tracked in
  `TODO(backlog: playground/correlated-broadcast-bridge-helper)`
  (git-owner-port.ts:131) — the ready-handshake belongs in that ONE helper,
  not as a 5th per-bridge copy.
