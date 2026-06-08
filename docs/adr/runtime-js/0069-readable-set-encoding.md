# ADR 0069: `Readable.setEncoding(encoding)` — emit decoded strings

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

The opencode PHASE-3 dry-run (POST creating a session) walled at `POST /session`
with `TypeError: stream.setEncoding is not a function`, thrown by
`@effect/platform-node-shared`'s `NodeStream.toString` (`dist/NodeStream.js:165`),
which reads any request body via `stream.setEncoding(encoding)` then
`stream.on("data", chunk => string += chunk)`.

rifty's `IncomingMessage` extends `@riftydev/io`'s `Readable`, which lacked
`setEncoding`. The `encoding` constructor option existed on `ReadableOptions` but
was ignored; no `decoder` state field. Without the method, every opencode
POST-with-body route 500s (the GET-only DB-READ gate never hit it). A no-op
`setEncoding` would NOT fix it: `'data'` would emit `Uint8Array`s and
`string += uint8array` coerces to `"226,130,172,…"` (corrupt) — the method must
actually decode.

Standard Node `Readable` method; the class explicitly replicates
`node:stream.Readable` (ADR-0012/0034), so this is faithful-builtin completion,
not a novel contract. Recorded as an ADR only because it widens a cross-package
public class (reversibility rule 1). Made under ADR-0063/0064 authority, need
verified by the live smoke wall.

## Decision

- **D1 — `setEncoding(encoding)` makes the stream emit decoded strings.** After
  calling, `'data'` events and `read()` returns are strings decoded with the
  given encoding (was raw bytes). Returns `this`. Unknown encodings throw
  `TypeError` with `code = 'ERR_UNKNOWN_ENCODING'`, like Node. New
  `readableEncoding` getter returns Node's canonical name (or `null`).

- **D2 — Decode at the emit/return boundary; byte buffer unchanged.** Internal
  `_readableState.buffer`/`length` still hold/account raw bytes; decode happens
  only when a chunk is handed to the consumer (in `flow()` and byte-mode `read()`
  returns). Strict **no-op for any consumer that never calls `setEncoding`** —
  byte-identical, and `_readableState`'s documented shape is untouched (decode
  state lives on a private instance field, not in `ReadableState`).

- **D3 — Streaming decode for text encodings; Buffer per-chunk otherwise.**
  `utf8`/`utf16le`/`latin1` (+ aliases) use one persistent `TextDecoder` in
  `{ stream: true }` mode, so a multi-byte character split across chunk
  boundaries decodes correctly (matches Node's `StringDecoder`). `ascii`/`hex`/
  `base64`/`base64url` decode per-chunk via `Buffer.toString(canonical)`
  (byte-group encodings; not on any current consumer's path). A trailing
  incomplete multi-byte sequence at true EOF is NOT flushed to a replacement char
  (documented minor deviation; complete UTF-8 bodies — the boot/LLM path — are
  unaffected). The `encoding` constructor option (and
  `Readable.from(_, { encoding })`) now routes through the same path.

## Consequences

- `packages/io/src/streams/readable.ts`: adds `setEncoding`, `readableEncoding`,
  private `applyEncoding` + `EncodingState`; `flow()` and the three byte-mode
  `read()` returns route through `applyEncoding` (guarded — no-op when no encoding
  set). `IncomingMessage` (and any rifty `Readable`) gains the method.
- Unblocks every opencode POST-with-body route (session create, prompt, …) — the
  PHASE-3 LLM round-trip gate's session-create step.
- Parity: `tools/node-parity-runner/cases/stream/readable-set-encoding.case.ts`
  (multi-byte char split across chunks, diffed head-to-head vs real Node).

## Reversibility

IRREVERSIBLE (rule 1 — widens a public class consumed across packages). One file
+ one parity case; no new external dependency; no deviation from Node semantics
on the supported path. Recorded per ADR-0063/0064, need verified by the live
smoke wall.

## References

- ADR-0012 / ADR-0034 (`@riftydev/io` owns a faithful `node:stream.Readable`).
- ADR-0054 (Effect consumes rifty `node:http` as-is) — the consumer whose body
  read calls `setEncoding`.
- ADR-0063/0064 (record-and-continue; verified need).
- `docs/opencode/HANDOFF.md` (the `POST /session` wall this clears).
