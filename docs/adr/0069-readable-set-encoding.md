# ADR 0069: `Readable.setEncoding(encoding)` — emit decoded strings

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

The opencode PHASE-3 dry-run (a POST that creates a session) walled at
`POST /session` with `TypeError: stream.setEncoding is not a function`, thrown by
`@effect/platform-node-shared`'s `NodeStream.toString`
(`dist/NodeStream.js:165`), which reads ANY request body via:

```js
stream.setEncoding(encoding); // encoding = "utf8"
stream.on("data", chunk => { string += chunk; });
```

rifty's `IncomingMessage` extends `@riftydev/io`'s `Readable`, which had no
`setEncoding`. The `encoding` constructor option was declared on
`ReadableOptions` but ignored, and the file deliberately omitted the `decoder`
state field. Without the method, every opencode POST-with-body route 500s — the
GET-only DB-READ gate never exercised this. (Worse, a no-op `setEncoding` would
NOT fix it: `'data'` would emit `Uint8Array`s and `string += uint8array` coerces
to `"226,130,172,…"` — corrupt. The method must actually decode.)

This is a standard Node `Readable` method (the class explicitly replicates
`node:stream.Readable`, ADR-0012/0034), so this is faithful-builtin completion,
not a novel contract. It is recorded as an ADR only because it widens a
cross-package public class (reversibility rule 1). Made under ADR-0063/0064
standing authority with the need verified by the live smoke wall.

## Decision

- **D1 — `setEncoding(encoding)` makes the stream emit decoded strings.** After
  it is called, `'data'` events and `read()` returns are strings decoded with
  the given encoding (was raw bytes). Returns `this`. Unknown encodings throw
  `TypeError` with `code = 'ERR_UNKNOWN_ENCODING'`, like Node. The new
  `readableEncoding` getter returns Node's canonical name (or `null`).

- **D2 — Decode at the emit/return boundary; the byte buffer is unchanged.** The
  internal `_readableState.buffer`/`length` still hold/account raw bytes; decode
  happens only when a chunk is handed to the consumer (in `flow()` and the
  byte-mode `read()` returns). So this is a strict **no-op for any consumer that
  never calls `setEncoding`** — existing behaviour is byte-identical and
  `_readableState`'s documented shape is untouched (the decode state lives on a
  private instance field, not in `ReadableState`).

- **D3 — Streaming decode for the text encodings; Buffer per-chunk otherwise.**
  `utf8`/`utf16le`/`latin1` (+ aliases) use a single persistent `TextDecoder` in
  `{ stream: true }` mode, so a multi-byte character split across chunk
  boundaries decodes correctly (matching Node's `StringDecoder`). `ascii`/`hex`/
  `base64`/`base64url` decode per-chunk via `Buffer.toString(canonical)`
  (byte-group encodings; not on any current consumer's path). A trailing
  incomplete multi-byte sequence at true EOF is not flushed to a replacement
  char (documented minor deviation; complete UTF-8 bodies — the boot/LLM path —
  are unaffected). The `encoding` constructor option (and `Readable.from(_, {
  encoding })`) now routes through the same path.

## Consequences

- `packages/io/src/streams/readable.ts`: `setEncoding`, `readableEncoding`, a
  private `applyEncoding` + `EncodingState`; `flow()` and the three byte-mode
  `read()` returns route through `applyEncoding` (guarded — no-op when no
  encoding set). `IncomingMessage` (and any rifty `Readable`) gains the method.
- Unblocks every opencode POST-with-body route (session create, prompt, …) —
  the PHASE-3 LLM round-trip gate's session-create step.
- Parity: `tools/node-parity-runner/cases/stream/readable-set-encoding.case.ts`
  (a multi-byte char split across chunks, diffed head-to-head vs real Node).

## Reversibility

IRREVERSIBLE (reversibility rule 1 — widens a public class consumed across
packages). One file + one parity case; no new external dependency; no deviation
from Node semantics on the supported path. Recorded per ADR-0063/0064 with the
need verified by the live smoke wall.

## References

- ADR-0012 / ADR-0034 (`@riftydev/io` owns a faithful `node:stream.Readable`).
- ADR-0054 (Effect consumes rifty `node:http` as-is) — the consumer whose body
  read calls `setEncoding`.
- ADR-0063/0064 (record-and-continue; verified need).
- `docs/opencode/HANDOFF.md` (the `POST /session` wall this clears).
