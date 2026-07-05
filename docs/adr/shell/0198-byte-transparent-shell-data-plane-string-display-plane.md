# ADR 0198: Byte-transparent shell data plane; string display plane

Status: Accepted
Date: 2026-07

> TL;DR: pipes, redirects and stdout capture carry `Uint8Array` end-to-end (`Writer.write` accepts `string | Uint8Array`); only the display plane (`RunResult.stdout`, `onChunk`) decodes to string. `cat` emits raw bytes — `cat img.png > copy.png` is byte-identical.

## Context

Review 2026-07-05: the whole shell I/O was string-typed (`Writer.write(chunk:
string)`), so `cat` decoded file bytes as UTF-8 and pipes/redirects re-encoded
the string. Every invalid-UTF-8 byte became U+FFFD (`EF BF BD`) — `cat bin >
out`, `cat bin | wc -c`, `>>` appends all permanently corrupted binary
payloads. Unix pipelines are byte streams; a Node-faithful runtime cannot ship
a text-only shell plumbing.

## Decision

- `Writer.write` accepts `string | Uint8Array`. Strings encode ONCE at the
  write site; the capture, pipe hand-off (`stdout → next stage stdin`) and
  `>`/`>>` redirect flush all operate on the captured BYTES.
- The display plane stays string: `RunResult.stdout/stderr` decode the full
  captured buffer once; `onChunk` decodes byte chunks through a per-stream
  streaming `TextDecoder` (multibyte sequences split across chunks stay
  intact). Public `RunResult` shape is unchanged.
- `cat` writes raw bytes on its plain path (no `-n`/`-b`/`-E`/`-A`); the
  transform flags stay text-typed — GNU cat's numbering is line/text semantics.
- stderr stays string-typed end-to-end: this shell never pipes or redirects
  stderr (bash parity), so it has no byte data plane.

## Consequences

- Binary files survive `cat`/pipe/redirect chains byte-identically
  (packages/shell/tests/binary-transparency.test.ts).
- Text FILTERS (`grep`/`head`/`tail`/…) still decode stdin to strings — binary
  through a text filter is text semantics, not byte-exact
  (docs/backlog/shell/byte-exact-command-output.md).
- Terminal display of binary output shows replacement chars — display-plane
  decode is lossy BY DESIGN; the data plane is not.
