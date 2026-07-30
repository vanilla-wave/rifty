# ADR 0338: TTY parity composes exact one-axis native resize traces

Status: Accepted
Date: 2026-07

> TL;DR: Drive columns and rows as two signal-settled native resizes so every
> Node/rifty event stays byte-exact without a host-specific ioctl helper.

## Context

PR #223's Ubuntu Node 24.18 oracle sometimes emitted two trailing `SIGWINCH`
callbacks for one `__riftyTtyResize(132, 43)` call while rifty emitted one.
Moving initial setup outside Node did not remove the failure.

Exact Linux instrumentation found `sibling-drift`, not an atomic Node resize
variance. GNU coreutils 9.4 `stty cols 132 rows 43` parses each operand
separately; each performs `TIOCGWINSZ` then `TIOCSWINSZ`. The two standard
signals usually coalesce, but Node can receive both. Results on Ubuntu 24.04.4,
Node 24.18, util-linux 2.39.3:

- combined `stty` operands: 44 duplicate traces in 2,000;
- one effective column or row change: 2,000/2,000 exact for each axis;
- direct single `TIOCSWINSZ`: 4,000/4,000 exact;
- two signal-settled one-axis steps: 4,000/4,000 exact six-event traces.

ADR-0337 attributed the difference too broadly to native signal multiplicity
and admitted one/two-signal traces. That would preserve diagnostics but bless a
driver-created extra resize. This ADR supersedes removed ADR-0337.

## Decision

- Keep persistent `process.on` listeners and byte-exact stdout comparison.
- Start at `80x24`. Drive `132x24`; after its process signal, drive `132x43`.
  Each native call has one effective dimension change.
- Require both exact sequences: stdout `resize`, stderr `resize`, then
  `SIGWINCH`, first at `132x24`, then at `132x43`.
- Keep the combined `{ cols, rows }` one-frame product contract in runtime and
  browser tests. The parity case owns Node ordering and both dimension paths,
  not MessagePort transport cardinality.
- Do not add a generic matcher, retry, signal truncation, host-native addon, or
  Python/Perl/C ioctl prerequisite.

## Consequences

- Native/rifty traces remain externally checkable and byte-identical.
- Both dimension paths retain real-Node proof without GNU `stty` manufacturing
  two effective resizes for one rifty frame.
- Simultaneous two-axis frame behavior remains cross-realm product
  conformance, pinned by runtime and browser acceptance rather than a
  non-portable host helper.
