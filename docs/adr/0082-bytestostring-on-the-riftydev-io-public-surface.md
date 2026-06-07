# ADR 0082: `bytesToString` on the `@riftydev/io` public surface

Status: Accepted (2026-06-06)
Date: 2026-06-06

Relates to:
- **ADR-0012** — `@riftydev/io` owns the shared Node-compatible primitives (`Buffer`, codec) consumed by `runtime-js`/`kernel`/`net`. This adds one decode helper to that surface.
- **ADR-0030** — `Buffer` subclasses `Uint8Array`; `Buffer.prototype.toString` delegates to the same `decode` (via `subarray`). `bytesToString === decode`, so semantics are shared, not duplicated.
- `docs/perf/js-runtime-perf-audit-2026-06-05.md` (text-read full-buffer copy) + `docs/perf/js-runtime-perf-adr-plan-2026-06-06.md` (item #12) — rationale.

## Context

`runtime-js` `fs.decodeResult` (the sole text-read decode site; sync + async `readFile` both funnel through it) decodes via `Buffer.from(bytes).toString(enc)` — a throwaway full-buffer **copy** per encoded read, only to call `toString`, which itself delegates to io's zero-copy `decode(view, enc)`. The intermediate Buffer is pure waste on the read hot path.

`io`'s `decode(view, enc)` already IS the zero-copy decoder (utf8 via shared `TextDecoder`, others iterate the view directly). It is internal — not exported from `packages/io/src/index.ts`. Using it from `runtime-js` to drop the copy = a **new cross-package public-API surface** → reversibility rule 1 IRREVERSIBLE → ADR (ratified inline, ADR-0063).

## Decision

Export `decode` from `@riftydev/io`'s index under the name **`bytesToString`** (`(bytes: Uint8Array, enc: Encoding) => string`; `Encoding` already public). Rewrite `fs.decodeResult`'s encoded branch to `bytesToString(bytes, encoding)`, dropping the `Buffer.from` copy.

The `!encoding` branch is **untouched** — still `Buffer.from(bytes)`, returning an owned, mutable Buffer copy (Node's binary-read contract: callers may mutate the result without affecting the stored file). Only the `encoding != null` branch changes.

Name `bytesToString` (not raw `decode`) makes the call site read as intent and signals "no Buffer needed" at the boundary.

## Alternatives considered

- **A — new io export `bytesToString` (= `decode`).** Chosen. One public symbol; reuses the single source of decode truth; drops the copy.
- **B — keep `Buffer.from(bytes).toString(enc)`.** Rejected: a full-buffer alloc+copy per encoded read for zero benefit.
- **C — decode in `runtime-js` directly (inline the loop).** Rejected: duplicates the codec (utf16 odd-byte truncation, ascii 7-bit mask, base64) across packages — guaranteed drift; violates ADR-0012's single-source rule.

## Consequences

- (+) Encoded text reads skip the throwaway full-buffer copy; decode goes straight through io's zero-copy path. No duplicated codec.
- (+) `io` public surface grows by exactly one symbol (`bytesToString`), `Encoding` already shared; `runtime-js → io` import is forward (top-down, no reverse import, no new circular dep).
- (+) Behaviour identical: `bytesToString === decode`, the same logic `Buffer.prototype.toString` already ran. utf16le odd-trailing-byte truncation, empty input, latin1 high bytes (>= 0x80), ascii 7-bit mask, and hex all handled inside `decode` (single source). Parity: `fs/read-encodings.case.ts` (empty / odd-len utf16le / latin1 high byte / hex) green; `fs/readwrite.case.ts` (utf8) green.
- (−) One more name on io's public surface to keep stable. Low cost — it is a thin, already-stable alias of `decode`.
- Acceptance: parity green; the `!encoding` owned-mutable Buffer branch preserved (binary reads still return a mutable copy).
