# ADR 0337: TTY parity preserves native SIGWINCH trace multiplicity

Status: Accepted
Date: 2026-07

> TL;DR: TTY resize parity keeps both raw traces, admits Node's evidenced one-
> or two-signal tail, and still requires rifty's one-frame trace exactly.

## Context

PR #223's Ubuntu Node 24.18 oracle emitted two identical trailing `SIGWINCH`
callbacks for one live `stty` resize while rifty emitted one. The same native
case usually emitted one; moving setup resize before Node did not remove the
variance under stress. Exact stdout equality therefore froze one sampled host
trace. Changing the case to `process.once` made CI stable by hiding the second
observable event.

Node documents `SIGWINCH` delivery on console resize but does not promise a
callback count. Linux `TIOCSWINSZ` and standard-signal delivery sit outside the
runner's control. The supported evidence is one or two identical signals after
the two stream events; no third signal has been observed.

Rifty has a narrower owned boundary. ADR-0225 sends one validated
`ipc:tty-resize` frame over a MessagePort, then runtime-js updates stdout,
updates stderr, and emits one process signal. Duplicate transport delivery is
excluded; same-size frames are no-ops. Making rifty random or duplicative would
weaken that contract rather than improve Node fidelity.

## Decision

- Exact stdout equality remains the parity-runner default.
- `kind: 'tty-resize'` alone uses a fixed trace-admission relation. The case
  retains `process.on` and serializes every event.
- Rifty must equal the authored expected trace: stdout resize, stderr resize,
  then one `SIGWINCH`, all at the exact dimensions.
- Native Node may equal that trace or append one identical `SIGWINCH`. Zero,
  early, changed, or three signals; duplicate stream events; and any other
  field difference fail.
- Both raw outputs remain in `CaseRun`. An admitted unequal trace prints its
  native/rifty signal counts. This is comparison, never normalization.
- The relation is runner-owned, not a case callback or generic matcher. A
  second nondeterministic oracle needs its own evidence and decision.

## Consequences

- Native PTY variance no longer flakes CI or disappears behind `once`.
- Product exact-once remains pinned by runtime and browser tests.
- A new native trace shape fails loudly and forces evidence-backed review.
- ADR-0132 remains precedent for a case-specific Node-reference policy;
  ADR-0164, ADR-0225, and ADR-0255 remain unchanged.
